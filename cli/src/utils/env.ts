import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CliEnv {
  CODEBUFF_CLI_VERSION: string;
  CODEBUFF_API_URL: string;
  CODEBUFF_AUTH_FILE: string;
  IS_FREEBUFF: boolean;
  LOG_LEVEL: string;
  FIREWORKS_API_KEY: string;
  FIREWORKS_MODEL_GLM: string;
  FIREWORKS_MODEL_KIMI: string;
}

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let cached: CliEnv | null = null;

export function getCliEnv(cwd: string = process.cwd()): CliEnv {
  if (cached) return cached;

  for (const f of [
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ]) {
    loadDotEnv(join(cwd, f));
  }

  cached = {
    CODEBUFF_CLI_VERSION: process.env.CODEBUFF_CLI_VERSION ?? "0.1.0-dev",
    CODEBUFF_API_URL:
      process.env.CODEBUFF_API_URL ?? "https://api.fireworks.ai/inference/v1",
    CODEBUFF_AUTH_FILE:
      process.env.CODEBUFF_AUTH_FILE ??
      join(process.env.HOME ?? "/tmp", ".codebuff", "auth.json"),
    IS_FREEBUFF:
      (process.env.IS_FREEBUFF ?? "").toLowerCase() === "true" ||
      process.env.IS_FREEBUFF === "1",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
    FIREWORKS_API_KEY: process.env.FIREWORKS_API_KEY ?? "",
    FIREWORKS_MODEL_GLM:
      process.env.FIREWORKS_MODEL_GLM ?? "accounts/fireworks/models/glm-5p1",
    FIREWORKS_MODEL_KIMI:
      process.env.FIREWORKS_MODEL_KIMI ??
      "accounts/fireworks/models/kimi-k2p6",
  };
  return cached;
}

export function resetCliEnvCache(): void {
  cached = null;
}
