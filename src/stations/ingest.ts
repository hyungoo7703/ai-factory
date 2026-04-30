/**
 * "ingest" station handler — runs the intake pipeline on user-supplied paths.
 *
 * Inputs come from `RunContext.input` if it lists file paths, plus any
 * sources the user attached at run time. The first ingest station in a line
 * binds its snapshot id to the run so subsequent stations can search it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ingest } from "../intake/ingest.js";
import { factoryPaths } from "../utils/paths.js";
import type { BotAdapter } from "../adapters/bot.js";
import type { RunContext, StationDef, StationResult } from "../core/types.js";
import { log } from "../utils/logger.js";

export interface IngestStationDeps {
  adapter: BotAdapter;
}

export async function runIngestStation(
  ctx: RunContext,
  station: StationDef,
  deps: IngestStationDeps
): Promise<StationResult> {
  const startedAt = new Date().toISOString();
  const paths = factoryPaths(ctx.projectRoot);

  // Sources are collected from:
  //   1. ctx.input — line by line, treated as path candidates
  //   2. station.inputs — fixed paths in the line definition
  const sources: string[] = [];
  if (ctx.input) {
    for (const line of ctx.input.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const abs = path.isAbsolute(trimmed) ? trimmed : path.join(ctx.projectRoot, trimmed);
      if (existsSync(abs)) sources.push(abs);
    }
  }
  if (station.inputs) {
    for (const ref of station.inputs) {
      const abs = path.isAbsolute(ref) ? ref : path.join(ctx.projectRoot, ref);
      if (existsSync(abs)) sources.push(abs);
    }
  }

  if (sources.length === 0) {
    log.warn(`[${station.name}] no extractable sources found — skipping ingest station`);
    return {
      station: station.name,
      status: "skipped",
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  log.step(`[${station.name}] ingesting ${sources.length} source(s)`);
  const snapshot = await ingest({
    sources,
    intakeDir: paths.intakeDir,
    adapter: deps.adapter,
    cwd: ctx.runDir,
  });
  ctx.intakeId = snapshot.id;

  const summary = readFileSync(snapshot.summaryPath, "utf-8");

  return {
    station: station.name,
    status: "completed",
    verdict: "PASS",
    output: summary,
    artifacts: [snapshot.summaryPath, snapshot.decisionsPath, snapshot.indexPath],
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
