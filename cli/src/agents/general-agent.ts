import type { AgentDef } from "./types.js";

function createGeneralAgent(opts: { model: "gpt-5" | "opus" }): Omit<AgentDef, "id"> {
  const isGpt5 = opts.model === "gpt-5";
  return {
    model: isGpt5 ? "openai/gpt-5.4" : "anthropic/claude-opus-4.7",
    displayName: isGpt5 ? "GPT-5 Agent" : "Opus Agent",
    spawnerPrompt: isGpt5
      ? "A general-purpose, deep-thinking (and slow) agent that can solve a wide range of problems requiring extended reasoning. This agent has no context on the conversation history; provide all relevant context via the prompt or filePaths."
      : "A general-purpose capable agent that can solve a wide range of problems. This agent has no context on the conversation history; provide all relevant context via the prompt or filePaths.",
    outputMode: "last_message",
    spawnableAgents: [
      "researcher-web",
      "researcher-docs",
      ...(!isGpt5 ? ["file-picker"] : []),
      "code-searcher",
      "directory-lister",
      "glob-matcher",
      "basher",
      "context-pruner",
    ],
    toolNames: ["spawn_agents", "read_files", "read_subtree", "str_replace", "write_file", "set_output"],
    instructionsPrompt: [
      "Use the spawn_agents tool to spawn agents to help you complete the user request.",
      !isGpt5
        ? "If you need to find more information in the codebase, file-picker is really good at finding relevant files. Spawn multiple agents in parallel when possible (e.g., 3 file-pickers + 1 code-searcher + 1 researcher-web in one spawn_agents call)."
        : "",
      "If filePaths were provided in params, read them first with read_files.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export const gpt5Agent: AgentDef = { ...createGeneralAgent({ model: "gpt-5" }), id: "gpt-5-agent" };
export const opusAgent: AgentDef = { ...createGeneralAgent({ model: "opus" }), id: "opus-agent" };
