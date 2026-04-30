/**
 * Document extractors — turn binary files into plain text.
 *
 * Supported types: .md, .txt, .pdf, .docx. PPTX/XLSX/images are deferred to
 * a later milestone (mammoth handles only docx; pptx needs officeparser).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import type { IntakeSource } from "../core/types.js";

export interface ExtractResult {
  text: string;
  meta: { type: IntakeSource["type"]; bytes: number };
}

export async function extractFile(absPath: string): Promise<ExtractResult> {
  const ext = path.extname(absPath).toLowerCase();
  const buf = readFileSync(absPath);
  switch (ext) {
    case ".md":
    case ".markdown":
      return { text: buf.toString("utf-8"), meta: { type: "md", bytes: buf.length } };
    case ".txt":
      return { text: buf.toString("utf-8"), meta: { type: "txt", bytes: buf.length } };
    case ".pdf":
      return extractPdf(buf);
    case ".docx":
      return extractDocx(buf);
    default:
      // Best-effort: try utf-8 decode for unknown text-like files.
      return {
        text: buf.toString("utf-8"),
        meta: { type: "other", bytes: buf.length },
      };
  }
}

async function extractPdf(buf: Buffer): Promise<ExtractResult> {
  // pdf-parse is CJS — dynamic import keeps ESM happy.
  const mod = await import("pdf-parse");
  const pdfParse = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default;
  const result = await pdfParse(buf);
  return { text: result.text, meta: { type: "pdf", bytes: buf.length } };
}

async function extractDocx(buf: Buffer): Promise<ExtractResult> {
  const result = await mammoth.extractRawText({ buffer: buf });
  return { text: result.value, meta: { type: "docx", bytes: buf.length } };
}

export function isExtractable(absPath: string): boolean {
  const ext = path.extname(absPath).toLowerCase();
  return [".md", ".markdown", ".txt", ".pdf", ".docx"].includes(ext);
}
