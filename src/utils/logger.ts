import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = (process.env.FACTORY_LOG_LEVEL as LogLevel) ?? "info";

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[currentLevel];
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  debug(message: string): void {
    if (shouldLog("debug")) {
      // eslint-disable-next-line no-console
      console.log(chalk.gray(`[${ts()}] ${message}`));
    }
  },
  info(message: string): void {
    if (shouldLog("info")) {
      // eslint-disable-next-line no-console
      console.log(`${chalk.gray(`[${ts()}]`)} ${message}`);
    }
  },
  step(message: string): void {
    if (shouldLog("info")) {
      // eslint-disable-next-line no-console
      console.log(`${chalk.cyan("▶")} ${chalk.bold(message)}`);
    }
  },
  ok(message: string): void {
    if (shouldLog("info")) {
      // eslint-disable-next-line no-console
      console.log(`${chalk.green("✓")} ${message}`);
    }
  },
  warn(message: string): void {
    if (shouldLog("warn")) {
      // eslint-disable-next-line no-console
      console.warn(`${chalk.yellow("⚠")} ${message}`);
    }
  },
  error(message: string): void {
    if (shouldLog("error")) {
      // eslint-disable-next-line no-console
      console.error(`${chalk.red("✗")} ${message}`);
    }
  },
  raw(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  },
};
