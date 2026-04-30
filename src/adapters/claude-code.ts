/**
 * ClaudeCodeAdapter — invokes the `claude` CLI binary as a subprocess.
 *
 * Strategy:
 *   - We use `claude -p <prompt>` (print mode) with `--output-format stream-json`.
 *   - The prompt is delivered via stdin to bypass Windows arg-length limits and
 *     avoid quoting issues.
 *   - Skills are concatenated into the system prompt (via --append-system-prompt).
 *   - All stdout JSON lines are forwarded to onEvent for trace capture.
 *
 * Observed event shapes (Claude Code stream-json):
 *   { "type": "system", "subtype": "init", ... }
 *   { "type": "assistant", "message": { "content": [{ "type": "text", "text": "..." }, ...] } }
 *   { "type": "user", "message": { "content": [{ "type": "tool_result", ... }] } }
 *   { "type": "result", "subtype": "success", "result": "<final text>", "usage": {...}, "total_cost_usd": ... }
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { BotAdapter, BotEvent, BotInvocation, BotResult } from "./bot.js";

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; name?: string; id?: string; input?: unknown }
      | { type: "tool_result"; tool_use_id?: string; content?: unknown }
      | { type: "thinking"; thinking?: string }
    >;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  is_error?: boolean;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface ClaudeCodeAdapterOptions {
  /** Override the binary name/path (default: "claude" or env CLAUDE_BIN). */
  binary?: string;
  /** Default model used when invocation does not specify one. */
  defaultModel?: string;
}

export class ClaudeCodeAdapter implements BotAdapter {
  readonly id = "claude-code";
  private readonly binary: string;
  private readonly defaultModel: string | undefined;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.binary = options.binary ?? process.env.CLAUDE_BIN ?? "claude";
    this.defaultModel = options.defaultModel;
  }

  async health(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.binary, ["--version"], { shell: true });
      let stderr = "";
      proc.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      proc.on("error", (err) => {
        reject(
          new Error(
            `Claude Code binary not found: '${this.binary}'. ` +
              `Install Claude Code (https://docs.claude.com/claude-code) and ensure it is in PATH. ` +
              `Underlying error: ${err.message}`
          )
        );
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`'${this.binary} --version' exited with code ${code}: ${stderr}`));
      });
    });
  }

  async run(invocation: BotInvocation): Promise<BotResult> {
    return this.runStream(invocation, () => {});
  }

  async runStream(
    invocation: BotInvocation,
    onEvent: (event: BotEvent) => void
  ): Promise<BotResult> {
    const start = Date.now();

    const args: string[] = [];
    args.push("-p");
    args.push("--output-format", "stream-json");
    args.push("--verbose");
    args.push("--input-format", "stream-json");

    const model = invocation.model ?? this.defaultModel;
    if (model) {
      args.push("--model", model);
    }

    if (invocation.allowedTools && invocation.allowedTools.length > 0) {
      args.push("--allowedTools", invocation.allowedTools.join(","));
    }
    // Always block tools that require human-in-the-loop unless explicitly
    // overridden — `claude -p` cannot answer mid-flight prompts.
    const disallow = invocation.disallowedTools ?? ["AskUserQuestion"];
    if (disallow.length > 0) {
      args.push("--disallowedTools", disallow.join(","));
    }
    // In `-p` mode there is no UI to approve tool calls. Without an explicit
    // permission mode, Edit/Write/Bash silently fail — so stations that are
    // supposed to produce code instead emit only narration. The factory runs
    // each code-producing station inside an isolated git worktree, so granting
    // bypassPermissions is safe by default; the gate station is the human
    // checkpoint before anything reaches the user's working tree.
    args.push("--permission-mode", invocation.permissionMode ?? "bypassPermissions");

    const systemPromptParts: string[] = [];
    if (invocation.systemPrompt) systemPromptParts.push(invocation.systemPrompt);
    if (invocation.persona) systemPromptParts.push(`# Persona\n${invocation.persona}`);
    if (invocation.skillFiles && invocation.skillFiles.length > 0) {
      const skillBodies: string[] = [];
      for (const skillPath of invocation.skillFiles) {
        const abs = path.isAbsolute(skillPath)
          ? skillPath
          : path.join(invocation.cwd, skillPath);
        if (existsSync(abs)) {
          skillBodies.push(`## Skill: ${path.basename(abs)}\n${readFileSync(abs, "utf-8")}`);
        }
      }
      if (skillBodies.length > 0) {
        systemPromptParts.push(`# Skills (domain knowledge)\n\n${skillBodies.join("\n\n")}`);
      }
    }
    if (systemPromptParts.length > 0) {
      args.push("--append-system-prompt", systemPromptParts.join("\n\n"));
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.ELECTRON_RUN_AS_NODE;
    if (process.platform === "win32") {
      env.ComSpec = env.ComSpec ?? "C:\\WINDOWS\\system32\\cmd.exe";
      env.SystemRoot = env.SystemRoot ?? "C:\\WINDOWS";
    }
    env.PYTHONUTF8 = "1";
    env.PYTHONIOENCODING = "utf-8";

    return new Promise<BotResult>((resolve, reject) => {
      const proc = spawn(this.binary, args, {
        shell: true,
        cwd: invocation.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      proc.stdout.setEncoding("utf-8");
      proc.stderr.setEncoding("utf-8");

      let settled = false;
      let stdoutBuf = "";
      let stderrBuf = "";
      let finalText = "";
      let finalCost: number | undefined;
      let tokensIn = 0;
      let tokensOut = 0;
      let toolCalls = 0;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (abortListener && invocation.signal) {
          invocation.signal.removeEventListener("abort", abortListener);
        }
        fn();
      };

      const kill = (): void => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 5000);
      };

      let abortListener: (() => void) | null = null;
      if (invocation.signal) {
        if (invocation.signal.aborted) {
          settle(() => {
            kill();
            reject(invocation.signal!.reason ?? new Error("Aborted"));
          });
          return;
        }
        abortListener = (): void => {
          settle(() => {
            kill();
            reject(invocation.signal!.reason ?? new Error("Aborted"));
          });
        };
        invocation.signal.addEventListener("abort", abortListener, { once: true });
      }

      if (invocation.timeoutMs) {
        timeoutHandle = setTimeout(() => {
          settle(() => {
            kill();
            reject(
              new Error(
                `Claude Code invocation timed out after ${Math.round(invocation.timeoutMs! / 1000)}s`
              )
            );
          });
        }, invocation.timeoutMs);
      }

      onEvent({ type: "start", data: { binary: this.binary, model } });

      const consumeJsonLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: ClaudeStreamEvent;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "text") {
              onEvent({ type: "text", data: { text: block.text } });
            } else if (block.type === "tool_use") {
              toolCalls += 1;
              onEvent({
                type: "tool_use",
                data: {
                  name: block.name,
                  id: block.id,
                  input: block.input,
                },
              });
            } else if (block.type === "thinking") {
              onEvent({
                type: "thinking",
                data: { text: block.thinking },
              });
            }
          }
        } else if (evt.type === "user" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "tool_result") {
              onEvent({
                type: "tool_result",
                data: { id: block.tool_use_id, content: block.content },
              });
            }
          }
        } else if (evt.type === "result") {
          if (typeof evt.result === "string") finalText = evt.result;
          if (typeof evt.total_cost_usd === "number") finalCost = evt.total_cost_usd;
          if (evt.usage) {
            tokensIn += evt.usage.input_tokens ?? 0;
            tokensOut += evt.usage.output_tokens ?? 0;
          }
        }
      };

      proc.stdout.on("data", (chunk: string) => {
        stdoutBuf += chunk;
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          consumeJsonLine(line);
        }
      });

      proc.stderr.on("data", (chunk: string) => {
        stderrBuf += chunk;
      });

      proc.on("error", (err) => {
        settle(() => {
          onEvent({ type: "error", data: { message: err.message } });
          reject(new Error(`Failed to spawn '${this.binary}': ${err.message}`));
        });
      });

      proc.on("close", (code) => {
        if (stdoutBuf.trim()) consumeJsonLine(stdoutBuf);
        settle(() => {
          if (code !== 0) {
            onEvent({ type: "error", data: { code, stderr: stderrBuf } });
            reject(
              new Error(
                `'${this.binary}' exited with code ${code}.\nstderr: ${stderrBuf.slice(0, 2000)}`
              )
            );
            return;
          }
          if (!finalText) {
            // Fallback: some prompts produce no result block; use accumulated text.
            finalText = stdoutBuf || "";
          }
          onEvent({
            type: "end",
            data: { durationMs: Date.now() - start, costUsd: finalCost, toolCalls },
          });
          resolve({
            content: finalText,
            durationMs: Date.now() - start,
            tokensIn,
            tokensOut,
            toolCalls,
            costUsd: finalCost,
          });
        });
      });

      // Send the user prompt as a stream-json user message.
      const userMsg = {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: invocation.prompt }],
        },
      };
      try {
        proc.stdin.write(JSON.stringify(userMsg) + "\n");
        proc.stdin.end();
      } catch (err) {
        settle(() => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    });
  }
}
