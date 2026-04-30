/**
 * `factory init` — bootstrap `.factory/` in the current project.
 *
 * Copies bundled config + line + skill templates into `.factory/`, but only
 * if those files don't already exist (idempotent).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, factoryPaths } from "../utils/paths.js";
import { ensureFactoryDirs } from "../core/conductor.js";
import { ensureGitRepo } from "../utils/git.js";
import { log } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function templateRoot(): string {
  const candidates = [
    path.join(__dirname, "..", "templates"),
    path.join(__dirname, "..", "..", "src", "templates"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("Bundled templates not found.");
}

export async function initCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  await ensureGitRepo(projectRoot);
  ensureFactoryDirs(projectRoot);

  const paths = factoryPaths(projectRoot);
  const tmpl = templateRoot();

  // config.yaml
  if (!existsSync(paths.configFile)) {
    copyFileSync(path.join(tmpl, "config.yaml"), paths.configFile);
    log.ok(`Created .factory/config.yaml`);
  } else {
    log.info(`.factory/config.yaml already exists — leaving alone`);
  }

  // lines/
  copyDir(path.join(tmpl, "lines"), paths.linesDir, "  Created");

  // skills/
  copyDir(path.join(tmpl, "skills"), paths.skillsDir, "  Created");

  // .gitignore for runs/sandbox (those are ephemeral)
  const ignorePath = path.join(paths.factoryDir, ".gitignore");
  if (!existsSync(ignorePath)) {
    writeFileSync(
      ignorePath,
      [
        "# factory runtime artifacts — exclude from version control",
        "runs/",
        "sandbox/",
        "intake/",
        "memory.jsonl",
        "",
        "# keep these:",
        "!config.yaml",
        "!lines/",
        "!skills/",
      ].join("\n") + "\n",
      "utf-8"
    );
    log.ok(`Created .factory/.gitignore`);
  }

  log.ok(`Initialized factory in ${projectRoot}`);
  log.raw("");
  log.raw("Next steps:");
  log.raw("  factory list                    # list available lines");
  log.raw("  factory intake docs/spec.pdf    # ingest a requirements doc");
  log.raw("  factory run feature \"...\"       # run a line");
}

function copyDir(src: string, dst: string, prefix: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dst, entry);
    if (existsSync(d)) continue;
    copyFileSync(s, d);
    log.ok(`${prefix} .factory/${path.relative(path.dirname(dst), d)}`);
  }
}
