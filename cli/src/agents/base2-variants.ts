import { createBase2 } from "./base2.js";
import type { AgentDef } from "./types.js";

export const base2Max: AgentDef = {
  ...createBase2("max"),
  id: "base2-max",
  displayName: "Buffy the Max Orchestrator",
};

export const base2Lite: AgentDef = {
  ...createBase2("lite"),
  id: "base2-lite",
  displayName: "Buffy the Lite Orchestrator",
};

export const base2Free: AgentDef = {
  ...createBase2("free"),
  id: "base2-free",
  displayName: "Buffy the Free Orchestrator",
};

export const base2Fast: AgentDef = {
  ...createBase2("fast"),
  id: "base2-fast",
  displayName: "Buffy the Fast Orchestrator",
};

export const base2FastNoValidation: AgentDef = {
  ...createBase2("fast", { hasNoValidation: true }),
  id: "base2-fast-no-validation",
  displayName: "Buffy the Fast No Validation Orchestrator",
};

export const base2Plan: AgentDef = {
  ...createBase2("default", { planOnly: true }),
  id: "base2-plan",
  displayName: "Buffy the Plan-Only Orchestrator",
};

export const baseDeep: AgentDef = {
  ...createBase2("default"),
  id: "base-deep",
  model: "openai/gpt-5.4",
  displayName: "Buffy the GPT Orchestrator",
  spawnableAgents: [
    "file-picker",
    "code-searcher",
    "directory-lister",
    "glob-matcher",
    "researcher-web",
    "researcher-docs",
    "basher",
    "thinker-gpt",
    "code-reviewer-gpt",
    "gpt-5-agent",
    "context-pruner",
  ],
};
