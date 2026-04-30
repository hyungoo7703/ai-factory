/**
 * `factory resume <runId>` — pick up an existing run from where it stopped.
 *
 * Useful for runs that paused at a human gate or hit a budget cap.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findProjectRoot, factoryPaths, runDir as buildRunDir } from "../utils/paths.js";
import { ensureGitRepo } from "../utils/git.js";
import { loadLine } from "../core/line-loader.js";
import { runLine } from "../core/conductor.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { log } from "../utils/logger.js";

export async function resumeCommand(runId: string, options: { yes?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  await ensureGitRepo(projectRoot);
  const fp = factoryPaths(projectRoot);
  const runDir = buildRunDir(fp, runId);
  if (!existsSync(runDir)) {
    log.error(`Run not found: ${runId}`);
    process.exit(1);
  }
  const summaryPath = path.join(runDir, "summary.json");
  if (!existsSync(summaryPath)) {
    log.error(`Run summary missing for ${runId} — cannot resume.`);
    process.exit(1);
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as { line: string };
  const line = loadLine(projectRoot, summary.line);

  const adapter = new ClaudeCodeAdapter();
  await adapter.health();

  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());

  await runLine({
    projectRoot,
    line,
    input: "",
    adapter,
    yes: options.yes,
    resumeRunId: runId,
    signal: ac.signal,
  });
}
