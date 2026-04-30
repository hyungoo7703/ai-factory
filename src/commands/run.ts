/**
 * `factory run <line> [input...]` — execute a line.
 *
 * Input may be supplied as positional arguments (joined with spaces) or via
 * --file <path> (read from a markdown file) or --stdin (pipe content).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findProjectRoot, factoryPaths } from "../utils/paths.js";
import { ensureGitRepo } from "../utils/git.js";
import { loadLine } from "../core/line-loader.js";
import { runLine } from "../core/conductor.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { log } from "../utils/logger.js";

export interface RunCommandOptions {
  yes?: boolean;
  file?: string;
  stdin?: boolean;
  intake?: string;
}

export async function runCommand(
  lineName: string,
  inputArgs: string[],
  options: RunCommandOptions
): Promise<void> {
  const projectRoot = findProjectRoot();
  await ensureGitRepo(projectRoot);
  const line = loadLine(projectRoot, lineName);

  let input = inputArgs.join(" ").trim();
  if (options.file) {
    input = readFileSync(options.file, "utf-8");
  } else if (options.stdin) {
    input = await readStdin();
  }
  if (!input) {
    log.warn("No input provided. Use positional args, --file, or --stdin.");
  }

  const adapter = new ClaudeCodeAdapter();
  await adapter.health();

  // Resolve intake binding: explicit --intake wins, else use latest snapshot if any.
  const intakeId = options.intake ?? findLatestIntake(projectRoot);
  if (intakeId) {
    log.info(`Bound intake snapshot: ${intakeId}`);
  }

  const ac = new AbortController();
  const onSig = (): void => ac.abort();
  process.on("SIGINT", onSig);

  try {
    const summary = await runLine({
      projectRoot,
      line,
      input,
      adapter,
      yes: options.yes,
      signal: ac.signal,
      intakeId,
    });
    process.exitCode = summary.status === "completed" ? 0 : summary.status === "failed" ? 1 : 2;
  } finally {
    process.off("SIGINT", onSig);
  }
}

function findLatestIntake(projectRoot: string): string | undefined {
  const fp = factoryPaths(projectRoot);
  if (!existsSync(fp.intakeDir)) return undefined;
  const entries = readdirSync(fp.intakeDir).filter((e) => {
    const full = path.join(fp.intakeDir, e);
    return statSync(full).isDirectory() && existsSync(path.join(full, "manifest.json"));
  });
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => {
    const ta = statSync(path.join(fp.intakeDir, a)).mtimeMs;
    const tb = statSync(path.join(fp.intakeDir, b)).mtimeMs;
    return tb - ta;
  });
  return entries[0];
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}
