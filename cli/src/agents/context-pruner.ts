import type { AgentDef } from "./types.js";

const contextPruner: AgentDef = {
  id: "context-pruner",
  displayName: "Context Pruner",
  model: "anthropic/claude-sonnet-4.6",
  spawnerPrompt:
    "Spawn this agent between steps to prune context, summarizing the conversation into a condensed format when context exceeds the limit.",
  outputMode: "last_message",
  inheritParentSystemPrompt: true,
  includeMessageHistory: true,
  toolNames: ["set_output"],
  spawnableAgents: [],
  instructionsPrompt: `You are the context-pruner. Look at the conversation so far and produce a concise summary (under 4000 characters) that preserves:
- The user's original request and any follow-up requests.
- Key decisions made.
- Important file paths read or written and what they contain.
- Any open questions or remaining work.
- The final state the conversation should resume from.

Output the summary as plain text — that summary will replace the older messages.`,
};

export default contextPruner;
