import { randomBytes } from "node:crypto";

import { logger } from "../utils/logger.js";
import { setAuthToken } from "../utils/auth.js";
import { getCliEnv } from "../utils/env.js";

export interface LoginResult {
  ok: boolean;
  email?: string;
  error?: string;
}

/**
 * Plain (non-interactive) login. In a real build this would open a browser
 * to the OAuth flow on the Codebuff web app. Without that backend we mint a
 * local development token so the rest of the CLI can proceed.
 */
export async function runPlainLogin(): Promise<LoginResult> {
  const env = getCliEnv();
  const apiUrl = env.CODEBUFF_API_URL;
  logger.info({ apiUrl }, "Starting plain login flow");

  process.stdout.write(`Logging in via ${apiUrl}...\n`);

  // Real flow:
  //   1. POST /auth/cli/start -> { code, verifyUrl }
  //   2. open(verifyUrl) and poll /auth/cli/poll?code=...
  //   3. Receive { token, email }
  // The Codebuff backend is not reachable from this environment, so we
  // fall back to a locally-generated dev token.
  const token = `dev-${randomBytes(16).toString("hex")}`;
  const email = "dev@local";
  setAuthToken(token, email);

  process.stdout.write(`Logged in as ${email} (local dev token)\n`);
  return { ok: true, email };
}
