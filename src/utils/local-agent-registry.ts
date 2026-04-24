import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { logger } from "./logger.js";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  source: "local" | "builtin";
  filePath?: string;
}

let registry: Map<string, AgentDefinition> = new Map();

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: "base",
    name: "Base",
    description: "Default coding agent",
    source: "builtin",
  },
  {
    id: "planner",
    name: "Planner",
    description: "Produces high-level plans before editing",
    source: "builtin",
  },
  {
    id: "editor",
    name: "Editor",
    description: "Applies file edits",
    source: "builtin",
  },
];

function loadAgentsDir(dir: string): AgentDefinition[] {
  const found: AgentDefinition[] = [];
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && /\.(json|jsonc)$/.test(name)) {
      try {
        const text = readFileSync(full, "utf8");
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.id === "string") {
          found.push({
            id: parsed.id,
            name: parsed.name ?? parsed.id,
            description: parsed.description ?? "",
            source: "local",
            filePath: full,
          });
        }
      } catch (err) {
        logger.warn({ err, full }, "Failed to load agent file");
      }
    }
  }
  return found;
}

export function initializeAgentRegistry(projectRoot: string): void {
  registry = new Map();
  for (const a of BUILTIN_AGENTS) registry.set(a.id, a);
  const localDir = join(projectRoot, ".agents");
  for (const a of loadAgentsDir(localDir)) registry.set(a.id, a);
  logger.info(
    { count: registry.size, projectRoot },
    "Initialized agent registry",
  );
}

export function listAgents(): AgentDefinition[] {
  return Array.from(registry.values());
}

export function getAgent(id: string): AgentDefinition | undefined {
  return registry.get(id);
}
