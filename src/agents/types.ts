export type AgentOutputMode = "last_message" | "structured_output";

export interface AgentDef {
  id: string;
  displayName: string;
  /** Original Codebuff model string. Mapped to a Fireworks model at runtime. */
  model: string;
  /** Description shown to a parent agent so it knows when to spawn this agent. */
  spawnerPrompt: string;
  /** Tool names this agent is allowed to call. Subset of TOOL_DEFS names. */
  toolNames: string[];
  /** Other agent ids this agent may spawn via spawn_agents / spawn_agent_inline. */
  spawnableAgents: string[];
  /** This agent's system prompt. Replaces the parent's prompt unless inheritParentSystemPrompt is true. */
  systemPrompt?: string;
  /** Appended to the conversation as a user-role message before the agent runs. */
  instructionsPrompt?: string;
  /** Re-injected as a system reminder at the start of every loop iteration to keep behavior on-track. */
  stepPrompt?: string;
  /** When true, the parent's system prompt is used (and systemPrompt is appended). */
  inheritParentSystemPrompt?: boolean;
  /** When true, the parent's full message history is included before the prompt. */
  includeMessageHistory?: boolean;
  outputMode?: AgentOutputMode;
}
