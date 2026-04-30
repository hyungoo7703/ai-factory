/**
 * `factory list` — show available lines and skills.
 */
import chalk from "chalk";
import { findProjectRoot } from "../utils/paths.js";
import { listAvailableLines } from "../core/line-loader.js";
import { listSkills } from "../skills/loader.js";
import { log } from "../utils/logger.js";

export async function listCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const lines = listAvailableLines(projectRoot);
  const skills = listSkills(projectRoot);

  log.raw(chalk.bold("Lines:"));
  if (lines.length === 0) {
    log.raw("  (none — run `factory init` to seed defaults)");
  }
  for (const l of lines) {
    log.raw(`  ${chalk.cyan(l.name.padEnd(20))} ${chalk.gray(l.source.padEnd(8))} ${l.path}`);
  }
  log.raw("");
  log.raw(chalk.bold("Skills:"));
  if (skills.length === 0) {
    log.raw("  (none — drop .md files in .factory/skills/)");
  }
  for (const s of skills) {
    const triggers = s.triggers ? ` triggers=[${s.triggers.join(", ")}]` : "";
    log.raw(`  ${chalk.cyan(s.name.padEnd(28))} ${s.path}${chalk.gray(triggers)}`);
  }
}
