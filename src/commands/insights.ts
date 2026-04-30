/**
 * `factory insights` — aggregate stats over .factory/memory.jsonl.
 *
 * Shows per-station pass rate, avg cost, avg duration, and most common
 * defect labels. This is the foundation for v2 self-improvement.
 */
import chalk from "chalk";
import { findProjectRoot, factoryPaths } from "../utils/paths.js";
import { Memory } from "../core/memory.js";
import { log } from "../utils/logger.js";

export async function insightsCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const fp = factoryPaths(projectRoot);
  const memory = new Memory(fp.memoryFile);
  const ins = memory.insights();

  log.raw(chalk.bold("Factory Insights"));
  log.raw("───────────────────────────────────");
  log.raw(`Total runs:    ${ins.totalRuns}`);
  log.raw(`Total records: ${ins.totalRecords}`);
  log.raw(`Total cost:    $${ins.totalCostUsd.toFixed(4)}`);
  log.raw("");

  if (ins.stations.length === 0) {
    log.info("No station records yet. Complete a run to populate insights.");
    return;
  }

  log.raw(chalk.bold("Per-station stats"));
  log.raw("───────────────────────────────────");
  for (const s of ins.stations.sort((a, b) => b.invocations - a.invocations)) {
    log.raw(`${chalk.cyan(s.line)}::${chalk.cyan(s.station)}`);
    log.raw(
      `  invocations=${s.invocations}  pass=${s.passes} fail=${s.fails} warn=${s.warns}  rate=${(s.passRate * 100).toFixed(0)}%`
    );
    log.raw(
      `  avg duration=${(s.avgDurationMs / 1000).toFixed(1)}s  avg cost=$${s.avgCostUsd.toFixed(4)}`
    );
    if (s.defectCounts.size > 0) {
      const top = Array.from(s.defectCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      log.raw(`  top defects: ${top.map(([k, v]) => `${k}×${v}`).join(", ")}`);
    }
    log.raw("");
  }
}
