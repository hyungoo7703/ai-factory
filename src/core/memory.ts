/**
 * Memory store — append-only JSONL of station outcomes.
 *
 * Used by `factory insights` to compute aggregates: cost, success rate,
 * defect frequency. SQLite would be nicer but JSONL is zero-dependency and
 * fast enough for the volumes any single developer will produce.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface MemoryRecord {
  ts: string;
  runId: string;
  line: string;
  station: string;
  bot?: string;
  model?: string;
  status: "completed" | "failed" | "skipped" | "awaiting_human";
  verdict?: "PASS" | "FAIL" | "WARN";
  score?: number;
  durationMs?: number;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  toolCalls?: number;
  defects?: string[];
  inputHash?: string;
  outputHash?: string;
  skillsApplied?: string[];
}

export class Memory {
  private readonly file: string;

  constructor(memoryFile: string) {
    this.file = memoryFile;
    mkdirSync(path.dirname(memoryFile), { recursive: true });
  }

  record(rec: Omit<MemoryRecord, "ts">): void {
    const full: MemoryRecord = { ts: new Date().toISOString(), ...rec };
    appendFileSync(this.file, JSON.stringify(full) + "\n", "utf-8");
  }

  readAll(): MemoryRecord[] {
    if (!existsSync(this.file)) return [];
    const raw = readFileSync(this.file, "utf-8");
    const out: MemoryRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as MemoryRecord);
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  /** Aggregate stats across all records. */
  insights(): MemoryInsights {
    const records = this.readAll();
    const byStation = new Map<string, StationStats>();
    let totalCost = 0;
    let totalRuns = new Set<string>();

    for (const r of records) {
      totalRuns.add(r.runId);
      if (typeof r.costUsd === "number") totalCost += r.costUsd;

      const key = `${r.line}::${r.station}`;
      const cur = byStation.get(key) ?? {
        line: r.line,
        station: r.station,
        invocations: 0,
        avgDurationMs: 0,
        avgCostUsd: 0,
        passRate: 0,
        passes: 0,
        fails: 0,
        warns: 0,
        defectCounts: new Map<string, number>(),
      };
      cur.invocations += 1;
      cur.avgDurationMs =
        (cur.avgDurationMs * (cur.invocations - 1) + (r.durationMs ?? 0)) / cur.invocations;
      cur.avgCostUsd =
        (cur.avgCostUsd * (cur.invocations - 1) + (r.costUsd ?? 0)) / cur.invocations;
      if (r.verdict === "PASS") cur.passes += 1;
      else if (r.verdict === "FAIL") cur.fails += 1;
      else if (r.verdict === "WARN") cur.warns += 1;
      cur.passRate =
        cur.invocations > 0 ? cur.passes / cur.invocations : 0;
      if (r.defects) {
        for (const d of r.defects) {
          cur.defectCounts.set(d, (cur.defectCounts.get(d) ?? 0) + 1);
        }
      }
      byStation.set(key, cur);
    }

    return {
      totalRuns: totalRuns.size,
      totalRecords: records.length,
      totalCostUsd: totalCost,
      stations: Array.from(byStation.values()),
    };
  }
}

export interface StationStats {
  line: string;
  station: string;
  invocations: number;
  avgDurationMs: number;
  avgCostUsd: number;
  passRate: number;
  passes: number;
  fails: number;
  warns: number;
  defectCounts: Map<string, number>;
}

export interface MemoryInsights {
  totalRuns: number;
  totalRecords: number;
  totalCostUsd: number;
  stations: StationStats[];
}
