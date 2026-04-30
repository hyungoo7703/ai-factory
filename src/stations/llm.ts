/**
 * "llm" station handler — the workhorse station type.
 *
 * Steps:
 *   1. (Optionally) acquire a worktree for isolation.
 *   2. Build the prompt from: instructions.md + station.input artifacts +
 *      previous-station outputs + auto-matched skills + intake search hints.
 *   3. Invoke the bot adapter (Claude Code).
 *   4. Capture all events into the run trace.
 *   5. If the station has required `outputs`, verify they exist on disk.
 *   6. Commit any worktree changes with a descriptive message.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { BotAdapter, BotEvent } from "../adapters/bot.js";
import type { RunContext, StationDef, StationResult } from "../core/types.js";
import { acquireWorktree, releaseWorktree, type WorktreeHandle } from "../core/worktree.js";
import { autoMatchSkills, listSkills, resolveSkillPaths } from "../skills/loader.js";
import { factoryPaths } from "../utils/paths.js";
import { commitAll } from "../utils/git.js";
import { log } from "../utils/logger.js";
import { buildIndex, search } from "../intake/search.js";
import type { Trace } from "../core/trace.js";
import type { BudgetTracker } from "../core/budget.js";

export interface LlmStationDeps {
  adapter: BotAdapter;
  trace: Trace;
  budget: BudgetTracker;
}

export interface LlmStationOutcome extends StationResult {
  worktree?: WorktreeHandle;
}

export async function runLlmStation(
  ctx: RunContext,
  station: StationDef,
  deps: LlmStationDeps,
  /** Outputs of previously completed stations, keyed by station name. */
  priorOutputs: Map<string, StationResult>
): Promise<LlmStationOutcome> {
  const startedAt = new Date().toISOString();
  const paths = factoryPaths(ctx.projectRoot);

  let worktree: WorktreeHandle | undefined;
  let cwd = ctx.projectRoot;
  if (station.worktree) {
    worktree = await acquireWorktree({
      projectRoot: ctx.projectRoot,
      sandboxDir: paths.sandboxDir,
      branchPrefix: `factory/${ctx.line.name}/${ctx.runId}`,
      suffix: station.name,
    });
    cwd = worktree.path;
    log.info(`[${station.name}] worktree: ${path.relative(ctx.projectRoot, worktree.path)} on ${worktree.branch}`);
  }

  const built = await buildStationPrompt(ctx, station, priorOutputs, cwd);
  const prompt = built.prompt;
  const intakeHits = built.intakeHits;
  if (intakeHits.length > 0) {
    deps.trace.emit({
      station: station.name,
      type: "log",
      data: {
        message: "intake_hits",
        intakeId: ctx.intakeId,
        count: intakeHits.length,
        hits: intakeHits.map((h) => ({ id: h.id, source: h.source, score: h.score })),
      },
    });
    log.info(`[${station.name}] intake hits: ${intakeHits.length} (${intakeHits.map((h) => h.id).join(", ")})`);
  } else if (station.canSearchIntake && !ctx.intakeId) {
    log.info(`[${station.name}] canSearchIntake=true but no intake snapshot bound`);
  }

  // Skills: explicit (from bot.skills) + auto-matched (by trigger).
  const explicitSkills = resolveSkillPaths(ctx.projectRoot, station.bot?.skills);
  const allSkills = listSkills(ctx.projectRoot);
  const autoMatched = autoMatchSkills(allSkills, prompt + "\n" + ctx.input);
  const autoSkillPaths = autoMatched.map((s) => s.path).filter((p) => !explicitSkills.includes(p));
  const skillFiles = [...explicitSkills, ...autoSkillPaths];
  if (skillFiles.length > 0) {
    log.info(`[${station.name}] skills: ${skillFiles.map((p) => path.basename(p)).join(", ")}`);
  }

  deps.trace.emit({
    station: station.name,
    type: "bot_start",
    data: {
      bot: station.bot?.name ?? "main",
      model: station.bot?.model,
      cwd,
      promptLen: prompt.length,
      skills: skillFiles.map((p) => path.basename(p)),
    },
  });

  let intakeReadsObserved = 0;
  const onEvent = (e: BotEvent): void => {
    if (e.type === "tool_use" || e.type === "tool_result" || e.type === "subagent_start" || e.type === "subagent_end") {
      deps.trace.emit({
        station: station.name,
        type: e.type === "tool_use" ? "tool_use"
          : e.type === "tool_result" ? "tool_result"
          : e.type === "subagent_start" ? "subagent_start"
          : "subagent_end",
        data: e.data,
      });
      // Detect reads against the intake snapshot directory.
      if (e.type === "tool_use") {
        const name = (e.data as { name?: string }).name;
        const input = (e.data as { input?: { file_path?: string; pattern?: string } }).input ?? {};
        const target = String(input.file_path ?? input.pattern ?? "");
        if ((name === "Read" || name === "Glob" || name === "Grep") && target.includes(".factory") && target.includes("intake")) {
          intakeReadsObserved += 1;
        }
      }
    }
  };

  let resultText = "";
  let costUsd: number | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let toolCalls = 0;
  let durationMs = 0;
  try {
    const result = await deps.adapter.runStream(
      {
        name: station.bot?.name ?? "main",
        model: station.bot?.model,
        persona: station.bot?.persona,
        prompt,
        cwd,
        skillFiles,
        signal: ctx.signal,
        timeoutMs: 30 * 60 * 1000,
      },
      onEvent
    );
    resultText = result.content;
    costUsd = result.costUsd;
    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
    toolCalls = result.toolCalls;
    durationMs = result.durationMs;

    deps.budget.add({
      tokens: (result.tokensIn ?? 0) + (result.tokensOut ?? 0),
      costUsd: result.costUsd ?? 0,
      toolCalls: result.toolCalls,
    });
  } catch (err) {
    if (worktree) await releaseWorktree(ctx.projectRoot, worktree);
    throw err;
  }

  deps.trace.emit({
    station: station.name,
    type: "bot_end",
    data: { durationMs, costUsd, tokensIn, tokensOut, toolCalls },
  });

  // Persist station output to <runDir>/stations/<name>/output.md
  const stationOutDir = path.join(ctx.runDir, "stations", station.name);
  mkdirSync(stationOutDir, { recursive: true });
  writeFileSync(path.join(stationOutDir, "output.md"), resultText, "utf-8");
  writeFileSync(
    path.join(stationOutDir, "prompt.md"),
    prompt,
    "utf-8"
  );

  // Verify required outputs.
  const artifacts: string[] = [path.join(stationOutDir, "output.md")];
  let missing: string[] = [];
  if (station.outputs) {
    for (const out of station.outputs) {
      const abs = path.isAbsolute(out) ? out : path.join(cwd, out);
      if (existsSync(abs)) artifacts.push(abs);
      else missing.push(out);
    }
  }
  if (missing.length > 0) {
    log.warn(`[${station.name}] missing required outputs: ${missing.join(", ")}`);
  }

  // Commit any work in the worktree so it's recoverable.
  if (worktree) {
    const sha = await commitAll(worktree.path, `[factory] ${ctx.line.name}/${station.name}`);
    if (sha) log.info(`[${station.name}] committed ${sha.slice(0, 8)} on ${worktree.branch}`);
  }

  return {
    station: station.name,
    status: missing.length > 0 ? "completed" : "completed",
    verdict: missing.length > 0 ? "WARN" : "PASS",
    output: resultText,
    artifacts,
    startedAt,
    completedAt: new Date().toISOString(),
    costUsd,
    tokensIn,
    tokensOut,
    toolCalls,
    intakeId: intakeHits.length > 0 || intakeReadsObserved > 0 ? ctx.intakeId : undefined,
    intakeHits: intakeHits.length || undefined,
    intakeReadsObserved: intakeReadsObserved || undefined,
    worktree,
  };
}

interface IntakeHitMeta {
  id: string;
  source: string;
  score: number;
}

async function buildStationPrompt(
  ctx: RunContext,
  station: StationDef,
  priorOutputs: Map<string, StationResult>,
  cwd: string
): Promise<{ prompt: string; intakeHits: IntakeHitMeta[] }> {
  const parts: string[] = [];
  const intakeHits: IntakeHitMeta[] = [];

  parts.push(`# Station: ${station.name}`);
  parts.push("");

  if (station.instructions) {
    const abs = path.isAbsolute(station.instructions)
      ? station.instructions
      : path.join(ctx.projectRoot, station.instructions);
    if (existsSync(abs)) {
      parts.push("## Instructions");
      parts.push("");
      parts.push(readFileSync(abs, "utf-8"));
      parts.push("");
    }
  }

  parts.push("## User Input");
  parts.push("");
  parts.push(ctx.input || "_(no input provided)_");
  parts.push("");

  // Prior station outputs (chained context).
  if (priorOutputs.size > 0) {
    parts.push("## Prior Station Outputs");
    parts.push("");
    for (const [name, result] of priorOutputs) {
      if (!result.output) continue;
      const truncated = result.output.length > 8000 ? result.output.slice(0, 8000) + "\n…(truncated)" : result.output;
      parts.push(`### ${name}`);
      parts.push("");
      parts.push(truncated);
      parts.push("");
    }
  }

  // Intake search hints — surface top BM25 hits for the input.
  if (station.canSearchIntake && ctx.intakeId) {
    const paths = factoryPaths(ctx.projectRoot);
    const indexPath = path.join(paths.intakeDir, ctx.intakeId, "index.jsonl");
    if (existsSync(indexPath)) {
      const idx = buildIndex(loadChunksJsonl(indexPath));
      const hits = search(idx, ctx.input, 5);
      if (hits.length > 0) {
        parts.push(`## Relevant Intake Excerpts (top ${hits.length} by BM25 from snapshot \`${ctx.intakeId}\`)`);
        parts.push("");
        for (const hit of hits) {
          parts.push(`### ${hit.chunk.id} (score=${hit.score.toFixed(2)})`);
          parts.push("");
          parts.push(hit.chunk.text.slice(0, 1500));
          parts.push("");
          intakeHits.push({ id: hit.chunk.id, source: hit.chunk.source, score: hit.score });
        }
      }
      const intakeRoot = path.join(paths.intakeDir, ctx.intakeId);
      parts.push(
        `The full intake corpus is available under \`${path.relative(cwd, intakeRoot)}\` (raw/ for plain text, summary.md for the digest, decisions.md for ambiguities, index.jsonl for chunks). Use the Read tool when you need more than the top-5 hits above.`
      );
      parts.push("");
    }
  }

  parts.push("## Working Directory");
  parts.push("");
  parts.push(`You are running inside: \`${cwd}\``);
  if (station.worktree) {
    parts.push("");
    parts.push(
      "This is an **isolated git worktree**. Edit files freely; the user's main working tree is untouched until they explicitly merge."
    );
  }
  if (station.outputs && station.outputs.length > 0) {
    parts.push("");
    parts.push("## Required Outputs");
    parts.push("");
    parts.push("Create the following files (relative to the working directory):");
    for (const o of station.outputs) parts.push(`- \`${o}\``);
  }

  return { prompt: parts.join("\n"), intakeHits };
}

function loadChunksJsonl(file: string): import("../core/types.js").IntakeChunk[] {
  const out: import("../core/types.js").IntakeChunk[] = [];
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}
