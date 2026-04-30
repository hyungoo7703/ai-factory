/**
 * Path resolution helpers.
 *
 * The factory works on a "project root" — a directory that contains a `.git`
 * folder. All factory state lives in `<projectRoot>/.factory/`.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const FACTORY_DIRNAME = ".factory";

/** Walk up from cwd until a `.git` folder is found. Returns the directory. */
export function findProjectRoot(start: string = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Not a git repository (or any parent up to ${current}). ` +
          `Run 'git init' first or 'cd' into a project.`
      );
    }
    current = parent;
  }
}

export interface FactoryPaths {
  projectRoot: string;
  factoryDir: string;
  configFile: string;
  linesDir: string;
  skillsDir: string;
  runsDir: string;
  intakeDir: string;
  memoryFile: string;
  sandboxDir: string;
}

export function factoryPaths(projectRoot: string): FactoryPaths {
  const factoryDir = path.join(projectRoot, FACTORY_DIRNAME);
  return {
    projectRoot,
    factoryDir,
    configFile: path.join(factoryDir, "config.yaml"),
    linesDir: path.join(factoryDir, "lines"),
    skillsDir: path.join(factoryDir, "skills"),
    runsDir: path.join(factoryDir, "runs"),
    intakeDir: path.join(factoryDir, "intake"),
    memoryFile: path.join(factoryDir, "memory.jsonl"),
    sandboxDir: path.join(factoryDir, "sandbox"),
  };
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function runDir(paths: FactoryPaths, runId: string): string {
  return path.join(paths.runsDir, runId);
}

export function newRunId(linePrefix: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}-${linePrefix}-${rand}`;
}
