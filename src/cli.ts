#!/usr/bin/env node
/**
 * `factory` CLI entry point.
 *
 * Subcommands:
 *   init                  Bootstrap .factory/ in the current git project
 *   intake [paths...]     Ingest documents into a searchable snapshot
 *   run <line> [input]    Run a line on the current project
 *   resume <runId>        Resume a paused/failed run
 *   status [runId]        Show summary of a run (default: latest)
 *   list                  List available lines and skills
 *   insights              Aggregate stats over memory.jsonl
 */
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { intakeCommand } from "./commands/intake.js";
import { runCommand } from "./commands/run.js";
import { resumeCommand } from "./commands/resume.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { insightsCommand } from "./commands/insights.js";
import { setLogLevel, log } from "./utils/logger.js";

const program = new Command();

program
  .name("factory")
  .description("Local AI development factory — git-native, worktree-isolated")
  .version("0.1.0")
  .option("-q, --quiet", "log warnings and errors only")
  .option("-v, --verbose", "log debug-level details")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts<{ quiet?: boolean; verbose?: boolean }>();
    if (opts.verbose) setLogLevel("debug");
    else if (opts.quiet) setLogLevel("warn");
  });

program
  .command("init")
  .description("bootstrap .factory/ in the current git project")
  .action(async () => {
    try {
      await initCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("intake [paths...]")
  .description("ingest documents (PDF/DOCX/MD/TXT) into a searchable snapshot")
  .option("--no-llm", "skip the LLM summary step (zero-cost ingest)")
  .option("--id <id>", "explicit snapshot id")
  .action(async (paths: string[], options: { llm: boolean; id?: string }) => {
    try {
      await intakeCommand(paths, { noLlm: !options.llm, id: options.id });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("run <line> [input...]")
  .description("execute a line — input may be positional, --file, or --stdin")
  .option("-y, --yes", "auto-approve human gates")
  .option("-f, --file <path>", "read input from a file")
  .option("--stdin", "read input from stdin")
  .option("--intake <id>", "bind run to a prior intake snapshot")
  .action(async (line: string, input: string[], options: Parameters<typeof runCommand>[2]) => {
    try {
      await runCommand(line, input, options);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("resume <runId>")
  .description("resume a paused or failed run")
  .option("-y, --yes", "auto-approve human gates")
  .action(async (runId: string, options: { yes?: boolean }) => {
    try {
      await resumeCommand(runId, options);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("status [runId]")
  .description("show summary of a run (default: latest)")
  .action(async (runId?: string) => {
    try {
      await statusCommand(runId);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("list")
  .description("list available lines and skills")
  .action(async () => {
    try {
      await listCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("insights")
  .description("aggregate stats over .factory/memory.jsonl")
  .action(async () => {
    try {
      await insightsCommand();
    } catch (err) {
      handleError(err);
    }
  });

function handleError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  log.error(msg);
  if (process.env.FACTORY_LOG_LEVEL === "debug" && err instanceof Error && err.stack) {
    log.raw(err.stack);
  }
  process.exit(1);
}

program.parseAsync(process.argv).catch(handleError);
