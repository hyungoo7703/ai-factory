/**
 * Conductor — top-level orchestrator for a single run.
 *
 * Responsibilities:
 *   - Resolve cwd → project root
 *   - Materialize the run directory and trace
 *   - Walk the line's stations sequentially
 *   - Dispatch each station to the correct handler
 *   - Track budget; on exhaustion, halt and surface awaiting_human
 *   - Record outcomes to memory.jsonl for `factory insights`
 *   - On completion, write a `summary.json` next to trace.jsonl
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BotAdapter } from "../adapters/bot.js";
import type {
  LineDef,
  RunContext,
  StationDef,
  StationResult,
} from "./types.js";
import { factoryPaths, ensureDir, runDir as buildRunDir, newRunId } from "../utils/paths.js";
import { Trace } from "./trace.js";
import { Memory } from "./memory.js";
import { BudgetExhausted, BudgetTracker, DEFAULT_BUDGET, resolveBudget, type BudgetUsage } from "./budget.js";
import { runIngestStation } from "../stations/ingest.js";
import { runLlmStation, type LlmStationOutcome } from "../stations/llm.js";
import { runReviewStation } from "../stations/review.js";
import { runGateStation } from "../stations/gate.js";
import { releaseWorktree, type WorktreeHandle } from "./worktree.js";
import { log } from "../utils/logger.js";

export interface RunOptions {
  /** Project root (must be a git repo). */
  projectRoot: string;
  /** Line definition to run. */
  line: LineDef;
  /** Free-form input from the user. */
  input: string;
  /** BotAdapter to use for all LLM-bearing stations. */
  adapter: BotAdapter;
  /** Auto-approve any human gate station. */
  yes?: boolean;
  /** Resume mode — pick up an existing run id and skip completed stations. */
  resumeRunId?: string;
  /** External AbortSignal. */
  signal?: AbortSignal;
  /** Optional intake snapshot id to bind to this run from the start. */
  intakeId?: string;
}

export interface RunSummary {
  runId: string;
  line: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed" | "awaiting_human" | "cancelled";
  budget: BudgetUsage;
  stations: StationResult[];
  error?: string;
}

export async function runLine(opts: RunOptions): Promise<RunSummary> {
  const paths = factoryPaths(opts.projectRoot);
  ensureDir(paths.factoryDir);
  ensureDir(paths.runsDir);
  ensureDir(paths.sandboxDir);

  const runId = opts.resumeRunId ?? newRunId(opts.line.name);
  const runDir = buildRunDir(paths, runId);
  ensureDir(runDir);

  const trace = new Trace(runDir, runId);
  const memory = new Memory(paths.memoryFile);

  const baseBudget = resolveBudget(DEFAULT_BUDGET, opts.line.budget);
  const budget = new BudgetTracker(baseBudget, (metric, used, limit) => {
    log.warn(`[budget] ${metric} ${used.toFixed(2)} / ${limit} (80% threshold)`);
    trace.emit({ station: "_meta", type: "budget_warn", data: { metric, used, limit } });
  });

  const externalSignal = opts.signal ?? new AbortController().signal;
  const ctx: RunContext = {
    runId,
    projectRoot: opts.projectRoot,
    factoryDir: paths.factoryDir,
    runDir,
    line: opts.line,
    input: opts.input,
    signal: externalSignal,
    resume: !!opts.resumeRunId,
    intakeId: opts.intakeId,
  };

  trace.emit({ station: "_meta", type: "run_start", data: { runId, line: opts.line.name, input: opts.input.slice(0, 500), intakeId: opts.intakeId } });
  log.step(`Run ${runId} (${opts.line.name})`);
  if (opts.intakeId) {
    const manifest = loadIntakeManifest(paths.intakeDir, opts.intakeId);
    trace.emit({
      station: "_meta",
      type: "log",
      data: {
        message: "intake_bound",
        intakeId: opts.intakeId,
        sources: manifest?.sources?.length ?? 0,
        chunks: manifest?.sources?.reduce((sum: number, s: { chunks?: number }) => sum + (s.chunks ?? 0), 0) ?? 0,
      },
    });
  }

  // Try to load prior summary if resuming.
  const summaryPath = path.join(runDir, "summary.json");
  const priorSummary = ctx.resume && existsSync(summaryPath)
    ? (JSON.parse(readFileSync(summaryPath, "utf-8")) as RunSummary)
    : null;
  const completedStations: StationResult[] = priorSummary?.stations.filter((s) => s.status === "completed") ?? [];

  const priorOutputs = new Map<string, StationResult>(completedStations.map((s) => [s.station, s]));
  let pendingWorktree: WorktreeHandle | undefined;

  let summaryStatus: RunSummary["status"] = "completed";
  let summaryError: string | undefined;

  try {
    for (const station of opts.line.stations) {
      if (priorOutputs.has(station.name)) {
        log.info(`[${station.name}] already completed (resume) — skipping`);
        continue;
      }

      log.step(`Station: ${station.name} [${station.kind}]`);
      trace.emit({ station: station.name, type: "station_start", data: { kind: station.kind } });

      const result = await dispatch(ctx, station, opts.adapter, trace, budget, priorOutputs, pendingWorktree, opts.yes);
      priorOutputs.set(station.name, result);

      if ((result as LlmStationOutcome).worktree) {
        if (pendingWorktree) {
          // Release any earlier pending worktree — only the most recent llm
          // station's worktree carries forward to the gate.
          await releaseWorktree(ctx.projectRoot, pendingWorktree);
        }
        pendingWorktree = (result as LlmStationOutcome).worktree;
      }

      memory.record({
        runId,
        line: opts.line.name,
        station: station.name,
        bot: station.bot?.name,
        model: station.bot?.model,
        status: result.status,
        verdict: result.verdict,
        score: result.score,
        durationMs: timeDelta(result.startedAt, result.completedAt),
        costUsd: result.costUsd,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        toolCalls: result.toolCalls,
      });

      trace.emit({
        station: station.name,
        type: "station_end",
        data: { status: result.status, verdict: result.verdict, score: result.score },
      });

      if (result.status === "awaiting_human") {
        summaryStatus = "awaiting_human";
        break;
      }
      if (result.status === "failed") {
        summaryStatus = "failed";
        summaryError = result.error ?? "station failed";
        break;
      }

      log.info(`[budget] ${budget.format()}`);
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) {
      summaryStatus = "awaiting_human";
      summaryError = err.message;
      trace.emit({ station: "_meta", type: "budget_exhaust", data: { metric: err.metric, used: err.used, limit: err.limit } });
      log.error(err.message + " — halting run");
    } else if (externalSignal.aborted) {
      summaryStatus = "cancelled";
      summaryError = "cancelled";
      log.warn("Run cancelled by user");
    } else {
      summaryStatus = "failed";
      summaryError = err instanceof Error ? err.message : String(err);
      log.error(summaryError);
      trace.emit({ station: "_meta", type: "error", data: { message: summaryError } });
    }
    // Cleanup any dangling worktree.
    if (pendingWorktree) {
      await releaseWorktree(ctx.projectRoot, pendingWorktree);
      pendingWorktree = undefined;
    }
  }

  const summary: RunSummary = {
    runId,
    line: opts.line.name,
    startedAt: priorSummary?.startedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: summaryStatus,
    budget: budget.usage,
    stations: Array.from(priorOutputs.values()),
    error: summaryError,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  trace.emit({ station: "_meta", type: "run_end", data: { status: summaryStatus } });
  await trace.close();

  if (summaryStatus === "completed") log.ok(`Run ${runId} completed`);
  else if (summaryStatus === "awaiting_human") log.warn(`Run ${runId} awaiting human input`);
  else if (summaryStatus === "cancelled") log.warn(`Run ${runId} cancelled`);
  else log.error(`Run ${runId} failed`);

  return summary;
}

async function dispatch(
  ctx: RunContext,
  station: StationDef,
  adapter: BotAdapter,
  trace: Trace,
  budget: BudgetTracker,
  priorOutputs: Map<string, StationResult>,
  pendingWorktree: WorktreeHandle | undefined,
  autoApprove: boolean | undefined
): Promise<StationResult> {
  switch (station.kind) {
    case "ingest":
      return runIngestStation(ctx, station, { adapter });
    case "llm":
      return runLlmStation(ctx, station, { adapter, trace, budget }, priorOutputs);
    case "review":
      return runReviewStation(ctx, station, { adapter, trace, budget }, priorOutputs);
    case "gate":
      return runGateStation(ctx, station, priorOutputs, {
        pendingWorktree,
        autoApprove,
      });
    default: {
      const exhaustive: never = station.kind;
      throw new Error(`Unknown station kind: ${exhaustive}`);
    }
  }
}

function timeDelta(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

function loadIntakeManifest(intakeDir: string, id: string): { sources?: { chunks?: number }[] } | null {
  const manifestPath = path.join(intakeDir, id, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

/** Make the data directory exist (used by init command). */
export function ensureFactoryDirs(projectRoot: string): void {
  const p = factoryPaths(projectRoot);
  for (const dir of [p.factoryDir, p.linesDir, p.skillsDir, p.runsDir, p.intakeDir, p.sandboxDir]) {
    mkdirSync(dir, { recursive: true });
  }
}
