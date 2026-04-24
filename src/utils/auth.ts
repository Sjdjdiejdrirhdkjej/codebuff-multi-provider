import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ensureParentDir } from "./logger.js";
import { getCliEnv } from "./env.js";

export interface AuthData {
  token: string;
  email?: string;
  savedAt: string;
}

export function getAuthToken(): string | null {
  const file = getCliEnv().CODEBUFF_AUTH_FILE;
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as AuthData;
    return data.token ?? null;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string, email?: string): void {
  const file = getCliEnv().CODEBUFF_AUTH_FILE;
  ensureParentDir(file);
  const data: AuthData = { token, email, savedAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(data, null, 2));
}

let apiToken: string | null = null;
export function setApiClientAuthToken(token: string | null): void {
  apiToken = token;
}
export function getApiClientAuthToken(): string | null {
  return apiToken;
}
