import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InitResult {
  ok: boolean;
  created: string[];
  message: string;
}

const DEFAULT_AGENT = {
  id: "project-agent",
  name: "Project Agent",
  description: "Default agent for this project",
  systemPrompt:
    "You are a helpful coding assistant for this project. Use the available tools to read, edit, and run code.",
  skills: ["read-file", "write-file", "edit-file", "run-shell", "search-code"],
};

export function runInit(projectRoot: string): InitResult {
  const agentsDir = join(projectRoot, ".agents");
  const created: string[] = [];

  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
    created.push(agentsDir);
  }

  const agentFile = join(agentsDir, "project-agent.json");
  if (existsSync(agentFile)) {
    return {
      ok: false,
      created,
      message: `Agent already exists: ${agentFile}`,
    };
  }
  writeFileSync(agentFile, JSON.stringify(DEFAULT_AGENT, null, 2) + "\n");
  created.push(agentFile);

  return {
    ok: true,
    created,
    message: `Scaffolded project agent at ${agentFile}`,
  };
}
