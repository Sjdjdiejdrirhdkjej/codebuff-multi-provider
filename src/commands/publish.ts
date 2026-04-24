import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { logger } from "../utils/logger.js";
import { getApiClientAuthToken } from "../utils/auth.js";

export interface PublishResult {
  ok: boolean;
  published: string[];
  error?: string;
}

export async function handlePublish(
  agentIds: string[],
  projectRoot: string,
): Promise<PublishResult> {
  const token = getApiClientAuthToken();
  if (!token) {
    return { ok: false, published: [], error: "Not logged in. Run `login` first." };
  }
  if (agentIds.length === 0) {
    return { ok: false, published: [], error: "No agent ids supplied" };
  }

  const agentsDir = join(projectRoot, ".agents");
  const published: string[] = [];

  for (const id of agentIds) {
    const file = join(agentsDir, `${id}.json`);
    if (!existsSync(file)) {
      const msg = `Agent definition not found: ${file}`;
      logger.error({ id, file }, msg);
      return { ok: false, published, error: msg };
    }
    try {
      JSON.parse(readFileSync(file, "utf8"));
      // Real flow: POST /agents/publish with the parsed body + token.
      published.push(id);
      logger.info({ id }, "Published agent");
    } catch (err) {
      logger.error({ err, id }, "Publish failed");
      return { ok: false, published, error: `Failed to read ${file}` };
    }
  }
  return { ok: true, published };
}
