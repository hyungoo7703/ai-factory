/**
 * `factory init` — bootstrap `.factory/` in the current project.
 *
 * Copies bundled config + line + skill templates into `.factory/`, but only
 * if those files don't already exist (idempotent).
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

  // Make sure the project's root .gitignore covers node_modules/ at minimum.
  // Without this, the implement station's auto-commit captures node_modules/
  // into the worktree branch, and the gate's fast-forward merge fails when the
  // user's working tree has its own untracked node_modules/.
  ensureProjectGitignore(projectRoot);

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
  log.raw("  factory list                       # list available lines");
  log.raw("  factory intake docs/spec.pdf       # (optional) ingest a requirements doc");
  log.raw("  factory run feature \"...\"          # run a line — code lands in an isolated worktree");
  log.raw("  factory run feature \"...\" --yes    # same, but auto-approve the human gate");
  log.raw("  factory status                     # inspect the latest run");
  log.raw("  factory insights                   # cumulative cost / pass-rate / defect stats");
  log.raw("");
  log.raw("Tip: commit .factory/config.yaml, .factory/lines/, .factory/skills/ to share");
  log.raw("     factory definitions with your team. The bundled .factory/.gitignore");
  log.raw("     already excludes runs/, sandbox/, intake/, and memory.jsonl.");
}

function ensureProjectGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const factoryBlock = [
    "# Dependencies",
    "node_modules/",
    "",
    "# Build output",
    "dist/",
    "build/",
    ".next/",
    "",
    "# Environment / secrets",
    ".env",
    ".env.local",
    ".env.*.local",
    "",
    "# Editor / OS",
    ".vscode/",
    ".idea/",
    ".DS_Store",
    "Thumbs.db",
    "",
    "# Logs",
    "*.log",
    "",
  ].join("\n");

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, factoryBlock, "utf-8");
    log.ok(`Created .gitignore (covers node_modules/, dist/, .env, ...)`);
    return;
  }

  const current = readFileSync(gitignorePath, "utf-8");
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  const hasNodeModules = lines.some(
    (l) => l === "node_modules" || l === "node_modules/" || l === "/node_modules" || l === "/node_modules/"
  );
  if (hasNodeModules) {
    log.info(`.gitignore already covers node_modules/ — leaving alone`);
    return;
  }

  const trailingNewline = current.endsWith("\n") ? "" : "\n";
  const addition =
    trailingNewline +
    "\n# added by `factory init` — without these, the implement station's\n" +
    "# auto-commit may capture dependency directories into the worktree branch,\n" +
    "# breaking the gate's fast-forward merge.\n" +
    "node_modules/\n";
  appendFileSync(gitignorePath, addition, "utf-8");
  log.ok(`Appended node_modules/ to existing .gitignore`);
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
