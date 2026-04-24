import type { AgentDef } from "./types.js";

const baseInstructions = `You are a thinker agent. Use <think> tags to think deeply about the user request.

When satisfied, write out a brief response to the user's request. The parent agent will see your response — no need to call any tools.`;

export const thinker: AgentDef = {
  id: "thinker",
  displayName: "Theo the Theorizer",
  model: "anthropic/claude-opus-4.7",
  spawnerPrompt:
    "Does deep thinking given the current conversation history and a specific prompt to focus on. Use this to help solve a specific problem. Gather any relevant context before spawning this agent because the thinker has no access to tools. The prompt can be very short — the thinker can see the entire conversation history.",
  outputMode: "last_message",
  inheritParentSystemPrompt: true,
  includeMessageHistory: true,
  spawnableAgents: [],
  toolNames: [],
  instructionsPrompt: baseInstructions,
};
export default thinker;

export const thinkerGpt: AgentDef = {
  ...thinker,
  id: "thinker-gpt",
  model: "openai/gpt-5.4",
  inheritParentSystemPrompt: false,
  systemPrompt: `You are the thinker-gpt agent. Think deeply about the user request and write out your response.`,
  instructionsPrompt:
    "Think deeply about the request. When satisfied, write your response. The parent agent will see your response. Do NOT call any tools.",
};

export const thinkerGemini: AgentDef = {
  ...thinker,
  id: "thinker-gemini",
  model: "google/gemini-3.1-pro-preview",
  inheritParentSystemPrompt: false,
  systemPrompt: `You are the thinker-gemini agent. Think about the user request and write a very concise response that captures the most important points.`,
  instructionsPrompt:
    "Think about the request. Write the absolute minimum response needed to answer correctly. Do NOT call any tools.",
};

export const thinkerWithFilesGemini: AgentDef = {
  id: "thinker-with-files-gemini",
  displayName: "Theo the Theorizer with Files (Gemini)",
  model: "google/gemini-3.1-pro-preview",
  spawnerPrompt:
    "Does deep thinking given the prompt and provided files using Gemini. This agent has no context on the conversation history; provide all relevant context via the prompt or filePaths.",
  outputMode: "last_message",
  spawnableAgents: [],
  toolNames: ["read_files"],
  systemPrompt: `You are the thinker-with-files-gemini agent. Read the provided files first, then think deeply and produce a very concise response.`,
  instructionsPrompt: `If filePaths were provided, call read_files on them once to load context. Then think and write a concise final answer. Say the absolute minimum needed to answer correctly. Do not call any other tools after reading.`,
};
