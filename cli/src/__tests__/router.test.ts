import { describe, expect, it } from "bun:test";

import { MODEL_GLM_5_1, MODEL_KIMI_K2_6, route } from "../utils/router.js";

const ctx = (m: "LITE" | "NORMAL" | "MAX" | "PLAN" = "NORMAL") => ({ mode: m });

describe("router", () => {
  it("routes pure code edits to GLM-5.1", () => {
    expect(route("refactor this function to use async/await", ctx()).model).toBe(
      MODEL_GLM_5_1,
    );
    expect(route("fix the typescript bug in src/api.ts", ctx()).model).toBe(
      MODEL_GLM_5_1,
    );
    expect(route("implement a new method on the User class", ctx()).model).toBe(
      MODEL_GLM_5_1,
    );
  });

  it("routes vision/image prompts to Kimi K2.6", () => {
    expect(route("look at this screenshot and tell me what's wrong", ctx()).model).toBe(
      MODEL_KIMI_K2_6,
    );
    expect(route("anything", { ...ctx(), hasImage: true }).model).toBe(MODEL_KIMI_K2_6);
  });

  it("routes tool / function-calling prompts to Kimi K2.6", () => {
    expect(route("call the api and fetch the data", ctx()).model).toBe(MODEL_KIMI_K2_6);
    expect(route("anything", { ...ctx(), needsTools: true }).model).toBe(MODEL_KIMI_K2_6);
  });

  it("routes multi-agent / autonomous prompts to Kimi K2.6", () => {
    expect(route("orchestrate three agents to solve this", ctx()).model).toBe(
      MODEL_KIMI_K2_6,
    );
    expect(route("explore the repo autonomously", ctx()).model).toBe(MODEL_KIMI_K2_6);
  });

  it("routes very long context to Kimi K2.6", () => {
    expect(
      route("summarize", { mode: "NORMAL", contextChars: 200_000 }).model,
    ).toBe(MODEL_KIMI_K2_6);
  });

  it("PLAN mode defaults to GLM-5.1", () => {
    expect(route("hello", ctx("PLAN")).model).toBe(MODEL_GLM_5_1);
    expect(route("hello", ctx("PLAN")).temperature).toBe(0.2);
  });

  it("default route is GLM-5.1", () => {
    expect(route("hi", ctx()).model).toBe(MODEL_GLM_5_1);
  });

  it("attaches a non-empty system prompt", () => {
    expect(route("hi", ctx()).systemPrompt.length).toBeGreaterThan(50);
  });
});
