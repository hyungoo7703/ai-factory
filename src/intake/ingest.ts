/**
 * Intake pipeline — turns a list of source paths into a searchable snapshot.
 *
 * Output (under `<factoryDir>/intake/<id>/`):
 *   raw/<source>.txt        Plain text per source.
 *   index.jsonl             One IntakeChunk JSON per line (BM25 corpus).
 *   summary.md              LLM-written digest (or fallback heuristic digest).
 *   decisions.md            Extracted "decided" vs "ambiguous" items.
 *   manifest.json           IntakeSnapshot metadata.
 *
 * The summary/decisions steps are optional and only run when an adapter is
 * provided (so `factory intake` can run without LLM cost).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractFile, isExtractable } from "./extract.js";
import { chunkText, tokenize } from "./chunk.js";
import type { BotAdapter } from "../adapters/bot.js";
import type { IntakeChunk, IntakeSnapshot, IntakeSource } from "../core/types.js";

export interface IngestOptions {
  /** Source paths (files or directories — directories are walked recursively). */
  sources: string[];
  /** Snapshot id (default: timestamp-based). */
  id?: string;
  /** Root for `<factoryDir>/intake/`. */
  intakeDir: string;
  /** Optional adapter for summary + decisions extraction. */
  adapter?: BotAdapter;
  /** Per-snapshot working directory cwd hint for the adapter. */
  cwd?: string;
  /** Skip summarize/decisions phase (zero-LLM mode). */
  noLlm?: boolean;
}

export async function ingest(opts: IngestOptions): Promise<IntakeSnapshot> {
  const id = opts.id ?? `intake-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const dir = path.join(opts.intakeDir, id);
  const rawDir = path.join(dir, "raw");
  mkdirSync(rawDir, { recursive: true });

  const sources: IntakeSource[] = [];
  const allChunks: IntakeChunk[] = [];

  const files = expandSources(opts.sources);

  for (const file of files) {
    if (!isExtractable(file)) continue;
    let text: string;
    let meta: { type: IntakeSource["type"]; bytes: number };
    try {
      const result = await extractFile(file);
      text = result.text;
      meta = result.meta;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      writeFileSync(
        path.join(rawDir, sanitize(path.basename(file)) + ".error.txt"),
        `Failed to extract: ${reason}`,
        "utf-8"
      );
      continue;
    }
    const safeName = sanitize(path.basename(file));
    writeFileSync(path.join(rawDir, safeName + ".txt"), text, "utf-8");

    const chunks = chunkText(safeName, text);
    allChunks.push(...chunks);

    sources.push({
      path: file,
      type: meta.type,
      hash: createHash("sha256").update(text).digest("hex").slice(0, 16),
      chunks: chunks.length,
      bytes: meta.bytes,
    });
  }

  const indexPath = path.join(dir, "index.jsonl");
  writeFileSync(
    indexPath,
    allChunks.map((c) => JSON.stringify({ ...c, tokens: c.tokens ?? tokenize(c.text) })).join("\n"),
    "utf-8"
  );

  // Summary + decisions.
  const summaryPath = path.join(dir, "summary.md");
  const decisionsPath = path.join(dir, "decisions.md");
  if (opts.adapter && !opts.noLlm) {
    await summarizeWithAdapter(opts.adapter, allChunks, summaryPath, decisionsPath, opts.cwd ?? dir);
  } else {
    writeFileSync(summaryPath, fallbackSummary(allChunks), "utf-8");
    writeFileSync(decisionsPath, "# Decisions\n\n_LLM not invoked. Run with an adapter to extract decisions and ambiguities._\n", "utf-8");
  }

  const snapshot: IntakeSnapshot = {
    id,
    createdAt: new Date().toISOString(),
    sources,
    summaryPath,
    decisionsPath,
    rawDir,
    indexPath,
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}

function expandSources(sources: string[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if (!existsSync(s)) continue;
    const stat = statSync(s);
    if (stat.isFile()) {
      out.push(path.resolve(s));
    } else if (stat.isDirectory()) {
      walk(s, out);
    }
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && isExtractable(full)) out.push(path.resolve(full));
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function fallbackSummary(chunks: IntakeChunk[]): string {
  const total = chunks.length;
  const sources = new Set(chunks.map((c) => c.source));
  const lines = [
    "# Intake Summary (heuristic, no LLM)",
    "",
    `Total chunks: ${total}`,
    `Source files: ${sources.size}`,
    "",
    "## First chunk preview per source",
    "",
  ];
  for (const src of sources) {
    const first = chunks.find((c) => c.source === src);
    if (first) {
      lines.push(`### ${src}`);
      lines.push("");
      lines.push(first.text.slice(0, 500) + (first.text.length > 500 ? "…" : ""));
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function summarizeWithAdapter(
  adapter: BotAdapter,
  chunks: IntakeChunk[],
  summaryOut: string,
  decisionsOut: string,
  cwd: string
): Promise<void> {
  const corpus = chunks.map((c) => `[${c.source}#${c.id}]\n${c.text}`).join("\n\n---\n\n");
  // Truncate aggressively so we stay within a reasonable token budget.
  const MAX = 80_000;
  const truncated = corpus.length > MAX ? corpus.slice(0, MAX) + "\n\n…(truncated)…" : corpus;

  const prompt = [
    "You are an analyst preparing an executive intake digest from a corpus of project documents.",
    "",
    "Produce TWO markdown files in your response, separated by exactly:",
    "===DECISIONS===",
    "",
    "First section ('summary'): a 1-page max digest covering goals, scope, key requirements, constraints, and stakeholders.",
    "",
    "Second section ('decisions'): two subsections — '## Decided' (items the documents commit to) and '## Ambiguous' (items left underspecified, with the specific question that needs answering for each).",
    "",
    "Be concrete. Cite sources inline using [source#id] tags from the corpus.",
    "",
    "=== CORPUS ===",
    "",
    truncated,
  ].join("\n");

  const result = await adapter.run({
    name: "intake-summarizer",
    cwd,
    prompt,
    timeoutMs: 10 * 60 * 1000,
  });
  const split = result.content.split(/^===DECISIONS===\s*$/m);
  const summary = split[0]?.trim() ?? result.content;
  const decisions = split[1]?.trim() ?? "_(no decisions section produced)_";
  writeFileSync(summaryOut, summary + "\n", "utf-8");
  writeFileSync(decisionsOut, decisions + "\n", "utf-8");
}
