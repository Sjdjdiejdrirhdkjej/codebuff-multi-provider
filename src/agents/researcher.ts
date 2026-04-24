import type { AgentDef } from "./types.js";

export const researcherWeb: AgentDef = {
  id: "researcher-web",
  displayName: "Weeb",
  model: "google/gemini-3.1-flash-lite-preview",
  spawnerPrompt: "Browses the web to find relevant information.",
  outputMode: "last_message",
  toolNames: ["web_search", "set_output"],
  spawnableAgents: [],
  systemPrompt: `You are an expert researcher who can search the web to find relevant information. Your goal is to provide comprehensive research on the topic requested. Use web_search to find current information.`,
  instructionsPrompt: `Provide concise but comprehensive research on the user's prompt. Use web_search as many times as needed to gather all the relevant information, then write up a brief report with the key findings. Cite sources where helpful.`,
};

export const researcherDocs: AgentDef = {
  id: "researcher-docs",
  displayName: "Doc",
  model: "google/gemini-3.1-flash-lite-preview",
  spawnerPrompt:
    "Expert at reading technical documentation of major public libraries and frameworks (React, MongoDB, Postgres, etc.) to find relevant information.",
  outputMode: "last_message",
  toolNames: ["read_docs", "set_output"],
  spawnableAgents: [],
  systemPrompt: `You are an expert researcher who can read documentation to find relevant information. Use read_docs to get detailed documentation.`,
  instructionsPrompt: `Use read_docs once to get detailed documentation relevant to the user's question, then write an ultra-concise report answering the question.`,
};
