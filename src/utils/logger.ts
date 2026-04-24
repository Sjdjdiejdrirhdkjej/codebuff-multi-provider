import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pino from "pino";

import { getCliEnv } from "./env.js";

const env = getCliEnv();

const LOG_DIR = join(process.env.HOME ?? "/tmp", ".codebuff", "logs");
const LOG_FILE = join(LOG_DIR, "cli.log");

function ensureLogDir(): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* swallow */
  }
}

ensureLogDir();

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { pid: process.pid, app: "codebuff-cli" },
  },
  pino.destination({ dest: LOG_FILE, sync: true, mkdir: true }),
);

export function clearLogFile(): void {
  ensureLogDir();
  try {
    writeFileSync(LOG_FILE, "");
  } catch {
    /* swallow */
  }
}

export function logFilePath(): string {
  return LOG_FILE;
}

export function ensureParentDir(file: string): void {
  const d = dirname(file);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
