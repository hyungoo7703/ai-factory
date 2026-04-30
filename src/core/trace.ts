/**
 * Trace logger — appends every interesting event to `<run>/trace.jsonl`.
 *
 * One file per run. Append-only. Used for replay, debugging, and as the
 * source of truth for memory aggregation.
 */
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";
import type { TraceEvent } from "./types.js";

export class Trace {
  private stream: WriteStream;
  private readonly runId: string;

  constructor(runDir: string, runId: string) {
    if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
    this.stream = createWriteStream(path.join(runDir, "trace.jsonl"), {
      flags: "a",
      encoding: "utf-8",
    });
    this.runId = runId;
  }

  emit(event: Omit<TraceEvent, "ts" | "runId">): void {
    const full: TraceEvent = {
      ts: new Date().toISOString(),
      runId: this.runId,
      ...event,
    };
    this.stream.write(JSON.stringify(full) + "\n");
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(resolve);
    });
  }
}
