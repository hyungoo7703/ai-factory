/**
 * `factory intake [paths...]` — run the intake pipeline on user files.
 *
 * Without --no-llm, an LLM is invoked to produce summary.md and decisions.md.
 * The resulting snapshot id is printed; lines can reference it via
 * `factory run <line> --intake <id>`.
 */
import { findProjectRoot, factoryPaths } from "../utils/paths.js";
import { ensureGitRepo } from "../utils/git.js";
import { ingest } from "../intake/ingest.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { log } from "../utils/logger.js";

export interface IntakeCommandOptions {
  noLlm?: boolean;
  id?: string;
}

export async function intakeCommand(paths: string[], options: IntakeCommandOptions): Promise<void> {
  if (paths.length === 0) {
    log.error("Usage: factory intake <path> [<path>...]");
    process.exit(1);
  }
  const projectRoot = findProjectRoot();
  await ensureGitRepo(projectRoot);
  const fp = factoryPaths(projectRoot);

  const adapter = new ClaudeCodeAdapter();
  if (!options.noLlm) {
    try {
      await adapter.health();
    } catch (err) {
      log.warn(
        `Claude Code not reachable — falling back to --no-llm mode. (${err instanceof Error ? err.message : String(err)})`
      );
      options.noLlm = true;
    }
  }

  log.step(`Ingesting ${paths.length} source(s)`);
  const snapshot = await ingest({
    sources: paths,
    intakeDir: fp.intakeDir,
    adapter: options.noLlm ? undefined : adapter,
    cwd: projectRoot,
    id: options.id,
    noLlm: options.noLlm,
  });

  log.ok(`Snapshot: ${snapshot.id}`);
  log.raw(`  raw      ${snapshot.rawDir}`);
  log.raw(`  index    ${snapshot.indexPath}`);
  log.raw(`  summary  ${snapshot.summaryPath}`);
  log.raw(`  decision ${snapshot.decisionsPath}`);
  log.raw("");
  log.raw(`Sources: ${snapshot.sources.length}`);
  for (const s of snapshot.sources) {
    log.raw(`  • ${s.path}  (${s.type}, ${s.chunks} chunks, ${formatBytes(s.bytes)})`);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
