/**
 * Text chunker — splits extracted text into searchable units.
 *
 * Strategy:
 *   1. If the text has markdown headings, split on H1/H2 boundaries.
 *   2. Otherwise, sliding-window over paragraphs with target size.
 *
 * Each chunk gets a stable id (`<source>#<idx>`) and an optional locator
 * (page=N for PDFs, slide=N for PPTX in the future).
 */
import type { IntakeChunk } from "../core/types.js";

const TARGET_CHUNK_CHARS = 2000;
const MIN_CHUNK_CHARS = 400;

export function chunkText(source: string, text: string): IntakeChunk[] {
  if (!text.trim()) return [];

  // First pass: split on headings.
  const headingChunks = splitOnHeadings(text);
  if (headingChunks.length > 1) {
    const filtered = headingChunks
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (filtered.length > 0) {
      return filtered.map((c, idx) => ({
        id: `${source}#h${idx}`,
        source,
        text: c,
        tokens: tokenize(c),
      }));
    }
  }

  // Fallback: paragraph window.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: IntakeChunk[] = [];
  let buf = "";
  let idx = 0;
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > TARGET_CHUNK_CHARS && buf.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        id: `${source}#p${idx++}`,
        source,
        text: buf.trim(),
        tokens: tokenize(buf),
      });
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf.trim()) {
    chunks.push({
      id: `${source}#p${idx}`,
      source,
      text: buf.trim(),
      tokens: tokenize(buf),
    });
  }
  // If everything was tiny, return a single whole-doc chunk so search still works.
  if (chunks.length === 0) {
    chunks.push({
      id: `${source}#p0`,
      source,
      text: text.trim(),
      tokens: tokenize(text),
    });
  }
  return chunks;
}

function splitOnHeadings(text: string): string[] {
  // Match ATX headings of level 1 or 2 at start of line.
  const lines = text.split("\n");
  const chunks: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (/^#{1,2}\s+\S/.test(line) && buf.length > 0) {
      chunks.push(buf.join("\n"));
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) chunks.push(buf.join("\n"));
  return chunks;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "as", "this", "that", "these",
  "those", "it", "its", "if", "then", "than", "so", "not", "no", "do", "does", "did",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}
