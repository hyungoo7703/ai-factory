/**
 * BM25 search over intake chunks.
 *
 * No embeddings, no external services — fully offline, fully deterministic.
 * Adequate for the volume of documentation a single repo typically holds
 * (hundreds to low-thousands of chunks).
 */
import { readFileSync, existsSync } from "node:fs";
import type { IntakeChunk } from "../core/types.js";
import { tokenize } from "./chunk.js";

export interface SearchHit {
  chunk: IntakeChunk;
  score: number;
}

interface Bm25Index {
  N: number;
  avgDocLen: number;
  docFreq: Map<string, number>;
  chunks: IntakeChunk[];
}

export function buildIndex(chunks: IntakeChunk[]): Bm25Index {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const c of chunks) {
    const tokens = c.tokens ?? tokenize(c.text);
    c.tokens = tokens;
    totalLen += tokens.length;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }
  return {
    N: chunks.length,
    avgDocLen: chunks.length > 0 ? totalLen / chunks.length : 0,
    docFreq,
    chunks,
  };
}

export function loadIndex(indexPath: string): Bm25Index {
  if (!existsSync(indexPath)) {
    return { N: 0, avgDocLen: 0, docFreq: new Map(), chunks: [] };
  }
  const raw = readFileSync(indexPath, "utf-8");
  const chunks: IntakeChunk[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      chunks.push(JSON.parse(line) as IntakeChunk);
    } catch {
      /* skip */
    }
  }
  return buildIndex(chunks);
}

export function search(index: Bm25Index, query: string, topK = 5): SearchHit[] {
  if (index.N === 0) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const k1 = 1.5;
  const b = 0.75;

  const scored: SearchHit[] = [];
  for (const chunk of index.chunks) {
    const tokens = chunk.tokens ?? tokenize(chunk.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const qt of queryTokens) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const df = index.docFreq.get(qt) ?? 0;
      const idf = Math.log((index.N - df + 0.5) / (df + 0.5) + 1);
      const docLen = tokens.length;
      const norm = 1 - b + b * (docLen / Math.max(1, index.avgDocLen));
      score += idf * ((f * (k1 + 1)) / (f + k1 * norm));
    }
    if (score > 0) scored.push({ chunk, score });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, topK);
}
