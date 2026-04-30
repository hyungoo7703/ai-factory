/**
 * Line loader — parses `.factory/lines/*.yaml` and bundled defaults.
 *
 * A line is a simple sequence of stations. Order matters; each station can
 * read the artifacts produced by previous stations.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { LineDef, StationDef, Budget } from "./types.js";
import { factoryPaths } from "../utils/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Bundled lines that ship with the binary. */
function bundledLineDir(): string {
  // dist/core/line-loader.js -> ../../src/templates/lines (in dev)
  // dist/core/line-loader.js -> ../templates/lines       (in prod)
  const candidates = [
    path.join(__dirname, "..", "templates", "lines"),
    path.join(__dirname, "..", "..", "src", "templates", "lines"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function listAvailableLines(projectRoot: string): { name: string; source: "user" | "bundled"; path: string }[] {
  const out: { name: string; source: "user" | "bundled"; path: string }[] = [];
  const userDir = factoryPaths(projectRoot).linesDir;
  if (existsSync(userDir)) {
    for (const f of readdirSync(userDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        out.push({
          name: path.basename(f, path.extname(f)),
          source: "user",
          path: path.join(userDir, f),
        });
      }
    }
  }
  const bundled = bundledLineDir();
  if (existsSync(bundled)) {
    for (const f of readdirSync(bundled)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        const name = path.basename(f, path.extname(f));
        if (!out.some((x) => x.name === name)) {
          out.push({ name, source: "bundled", path: path.join(bundled, f) });
        }
      }
    }
  }
  return out;
}

export function loadLine(projectRoot: string, lineName: string): LineDef {
  const all = listAvailableLines(projectRoot);
  const found = all.find((l) => l.name === lineName);
  if (!found) {
    throw new Error(
      `Line not found: '${lineName}'. Available: ${all.map((l) => l.name).join(", ") || "<none>"}`
    );
  }
  const raw = readFileSync(found.path, "utf-8");
  const parsed = parseYaml(raw) as Partial<LineDef> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid line YAML: ${found.path}`);
  }
  if (!parsed.stations || !Array.isArray(parsed.stations)) {
    throw new Error(`Line '${lineName}' is missing required 'stations' array.`);
  }
  return validateLine({ name: lineName, ...parsed } as LineDef);
}

function validateLine(line: LineDef): LineDef {
  if (!line.name) throw new Error("line.name is required");
  if (!line.stations.length) throw new Error("line must have at least one station");

  const seen = new Set<string>();
  for (const s of line.stations) {
    if (!s.name) throw new Error("station.name is required");
    if (seen.has(s.name)) throw new Error(`Duplicate station name: ${s.name}`);
    seen.add(s.name);
    validateStation(s);
  }

  // Cross-references: review stations must point at an existing station.
  for (const s of line.stations) {
    if (s.kind === "review" && s.reviewOf) {
      if (!seen.has(s.reviewOf)) {
        throw new Error(
          `Station '${s.name}' references unknown station '${s.reviewOf}' in reviewOf.`
        );
      }
    }
  }

  return line;
}

function validateStation(s: StationDef): void {
  const validKinds: StationDef["kind"][] = ["ingest", "llm", "review", "gate"];
  if (!validKinds.includes(s.kind)) {
    throw new Error(`Invalid station.kind '${s.kind}' (must be one of ${validKinds.join(", ")})`);
  }
  if (s.kind === "review" && !s.reviewOf) {
    throw new Error(`Review station '${s.name}' must specify 'reviewOf'.`);
  }
  if (s.passThreshold !== undefined && (s.passThreshold < 0 || s.passThreshold > 100)) {
    throw new Error(`Station '${s.name}': passThreshold must be 0-100`);
  }
}

export function defaultBudget(line: LineDef, fallback: Budget): Budget {
  return { ...fallback, ...(line.budget ?? {}) };
}
