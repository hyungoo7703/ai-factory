/**
 * `factory status [runId]` — show summary of a single run, or the latest.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { findProjectRoot, factoryPaths } from "../utils/paths.js";
import { log } from "../utils/logger.js";

interface IntakeBoundInfo {
  intakeId: string;
  sources: number;
  chunks: number;
}

function parseIntakeBound(tracePath: string): IntakeBoundInfo | null {
  if (!existsSync(tracePath)) return null;
  const raw = readFileSync(tracePath, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as { type?: string; data?: { message?: string; intakeId?: string; sources?: number; chunks?: number } };
      if (evt.type === "log" && evt.data?.message === "intake_bound" && evt.data.intakeId) {
        return {
          intakeId: evt.data.intakeId,
          sources: evt.data.sources ?? 0,
          chunks: evt.data.chunks ?? 0,
        };
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function statusCommand(runId?: string): Promise<void> {
  const projectRoot = findProjectRoot();
  const fp = factoryPaths(projectRoot);
  if (!existsSync(fp.runsDir)) {
    log.warn("No runs found. Run `factory run <line>` first.");
    return;
  }
  const id = runId ?? latestRunId(fp.runsDir);
  if (!id) {
    log.warn("No runs found.");
    return;
  }
  const summaryPath = path.join(fp.runsDir, id, "summary.json");
  if (!existsSync(summaryPath)) {
    log.error(`No summary for run: ${id}`);
    return;
  }
  const s = JSON.parse(readFileSync(summaryPath, "utf-8")) as {
    runId: string;
    line: string;
    status: string;
    startedAt: string;
    completedAt: string;
    error?: string;
    budget: { tokens: number; costUsd: number; durationMin: number; toolCalls: number };
    stations: Array<{
      station: string;
      status: string;
      verdict?: string;
      score?: number;
      costUsd?: number;
      intakeId?: string;
      intakeHits?: number;
      intakeReadsObserved?: number;
    }>;
  };
  const tracePath = path.join(fp.runsDir, id, "trace.jsonl");
  const intakeBound = parseIntakeBound(tracePath);

  log.raw(`${chalk.bold("Run")}      ${s.runId}`);
  log.raw(`${chalk.bold("Line")}     ${s.line}`);
  log.raw(`${chalk.bold("Status")}   ${colorStatus(s.status)}`);
  log.raw(`${chalk.bold("Started")}  ${s.startedAt}`);
  log.raw(`${chalk.bold("Ended")}    ${s.completedAt}`);
  log.raw("");
  log.raw(`${chalk.bold("Budget")}`);
  log.raw(`  tokens     ${s.budget.tokens.toLocaleString()}`);
  log.raw(`  cost       $${s.budget.costUsd.toFixed(4)}`);
  log.raw(`  duration   ${s.budget.durationMin.toFixed(1)} min`);
  log.raw(`  toolCalls  ${s.budget.toolCalls}`);
  if (s.error) {
    log.raw("");
    log.raw(`${chalk.bold("Error")}    ${chalk.red(s.error)}`);
  }
  log.raw("");
  if (intakeBound) {
    log.raw("");
    log.raw(`${chalk.bold("Intake")}   ${intakeBound.intakeId} (${intakeBound.sources} sources, ${intakeBound.chunks} chunks)`);
  }
  log.raw("");
  log.raw(`${chalk.bold("Stations")}`);
  for (const st of s.stations) {
    const verdict = st.verdict ? `${st.verdict}${st.score !== undefined ? ` (${st.score})` : ""}` : "";
    const cost = st.costUsd !== undefined ? ` $${st.costUsd.toFixed(4)}` : "";
    const intakeBits: string[] = [];
    if (st.intakeHits) intakeBits.push(`hits=${st.intakeHits}`);
    if (st.intakeReadsObserved) intakeBits.push(`reads=${st.intakeReadsObserved}`);
    const intake = intakeBits.length > 0 ? chalk.cyan(` [intake ${intakeBits.join(", ")}]`) : "";
    log.raw(`  ${colorStatus(st.status).padEnd(20)} ${chalk.bold(st.station)} ${verdict}${cost}${intake}`);
  }
}

function colorStatus(s: string): string {
  switch (s) {
    case "completed":
      return chalk.green(s);
    case "failed":
      return chalk.red(s);
    case "awaiting_human":
      return chalk.yellow(s);
    case "skipped":
      return chalk.gray(s);
    default:
      return s;
  }
}

function latestRunId(runsDir: string): string | null {
  const entries = readdirSync(runsDir).filter((e) => statSync(path.join(runsDir, e)).isDirectory());
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    const ta = statSync(path.join(runsDir, a)).mtimeMs;
    const tb = statSync(path.join(runsDir, b)).mtimeMs;
    return tb - ta;
  });
  return entries[0];
}
