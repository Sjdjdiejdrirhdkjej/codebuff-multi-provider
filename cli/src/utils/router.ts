/**
 * Routes a prompt to the model whose **strengths** best fit the request.
 *
 * Models available (Fireworks AI, latest as of April 2026):
 *
 *   GLM-5.1  — accounts/fireworks/models/glm-5p1
 *     STRENGTHS: agentic engineering, strong code generation, sustained
 *                long-horizon multi-iteration coding (hundreds of rounds),
 *                planning, refactors, multilingual code.
 *     LIMITS:   no function calling, no image input.
 *
 *   Kimi K2.6 — accounts/fireworks/models/kimi-k2p6
 *     STRENGTHS: native multimodal (image input), function/tool calling,
 *                multi-agent / swarm orchestration, proactive autonomous
 *                execution, very long context (262k), research/browsing.
 *     LIMITS:   higher latency, more verbose.
 *
 * Routing rules (only-strengths mapping):
 *   - Image attached / vision asked   → Kimi K2.6   (only one with vision)
 *   - Tool / function-calling needed  → Kimi K2.6   (GLM-5.1 lacks it)
 *   - Multi-agent / orchestration /
 *     research / browse / autonomous  → Kimi K2.6
 *   - Very long context (> 180k char) → Kimi K2.6   (262k > 202k)
 *   - Code edit / refactor / generate
 *     / debug / plan                  → GLM-5.1     (its core strength)
 *   - Default                          → GLM-5.1     (cheaper, faster on code)
 */

export const MODEL_GLM_5_1 = "accounts/fireworks/models/glm-5p1";
export const MODEL_KIMI_K2_6 = "accounts/fireworks/models/kimi-k2p6";

export type AppMode = "LITE" | "NORMAL" | "MAX" | "PLAN";

export interface RouteContext {
  mode: AppMode;
  hasImage?: boolean;
  needsTools?: boolean;
  contextChars?: number;
}

export interface RouteDecision {
  model: string;
  reason: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

const TOOL_KEYWORDS = [
  "tool",
  "function call",
  "call the api",
  "browse",
  "fetch ",
  "search the web",
  "look up",
  "google ",
];

const AGENT_KEYWORDS = [
  "agent",
  "agents",
  "multi-agent",
  "swarm",
  "orchestrate",
  "autonomous",
  "research ",
  "investigate",
  "explore the",
];

const VISION_KEYWORDS = [
  "image",
  "screenshot",
  "picture",
  "diagram",
  "this png",
  "this jpg",
  "look at this",
];

const CODE_KEYWORDS = [
  "refactor",
  "fix",
  "bug",
  "implement",
  "function",
  "class ",
  "method",
  "test",
  "lint",
  "type",
  "typescript",
  "python",
  "rust",
  "golang",
  "compile",
  "build",
  "edit",
  "rewrite",
  "diff",
  "patch",
  "merge",
];

function matchesAny(text: string, list: string[]): boolean {
  return list.some((k) => text.includes(k));
}

const GLM_SYSTEM = `You are Codebuff's coding agent powered by GLM-5.1.
Optimize for: precise file edits, multi-file refactors, sustained
multi-iteration engineering tasks, and clear plans before code.
Constraints: do not invent function-calling syntax — describe steps in prose.
Never produce image output. Prefer minimal diffs and explicit reasoning.`;

const KIMI_SYSTEM = `You are Codebuff's agent powered by Kimi K2.6.
Optimize for: tool/function calls, multi-agent orchestration, autonomous
research, and tasks that depend on images or very long context.
When a tool would help, name it explicitly. Be proactive but cite the
sources or files you draw from.`;

export function route(prompt: string, ctx: RouteContext): RouteDecision {
  const lower = prompt.toLowerCase();
  const longCtx = (ctx.contextChars ?? 0) > 180_000;

  // 1. Hard-strength routes for Kimi K2.6 (only model that can do these).
  if (ctx.hasImage || matchesAny(lower, VISION_KEYWORDS)) {
    return decide(MODEL_KIMI_K2_6, "vision/image input — Kimi-only capability", ctx);
  }
  if (ctx.needsTools || matchesAny(lower, TOOL_KEYWORDS)) {
    return decide(
      MODEL_KIMI_K2_6,
      "tool / function calling — GLM-5.1 does not support it",
      ctx,
    );
  }
  if (matchesAny(lower, AGENT_KEYWORDS)) {
    return decide(
      MODEL_KIMI_K2_6,
      "multi-agent / autonomous orchestration — Kimi K2.6 strength",
      ctx,
    );
  }
  if (longCtx) {
    return decide(
      MODEL_KIMI_K2_6,
      "context exceeds GLM-5.1's 202k window — using Kimi's 262k",
      ctx,
    );
  }

  // 2. Coding / planning → GLM-5.1's core strength.
  if (
    ctx.mode === "PLAN" ||
    ctx.mode === "MAX" ||
    matchesAny(lower, CODE_KEYWORDS)
  ) {
    return decide(MODEL_GLM_5_1, "coding / planning — GLM-5.1 strength", ctx);
  }

  // 3. Default: GLM-5.1 (cheaper, faster on code-shaped chat).
  return decide(MODEL_GLM_5_1, "default route — GLM-5.1 for general coding chat", ctx);
}

function decide(model: string, reason: string, ctx: RouteContext): RouteDecision {
  const isKimi = model === MODEL_KIMI_K2_6;
  const liteFactor = ctx.mode === "LITE" ? 0.5 : 1;
  return {
    model,
    reason,
    systemPrompt: isKimi ? KIMI_SYSTEM : GLM_SYSTEM,
    temperature:
      ctx.mode === "PLAN" ? 0.2 : ctx.mode === "MAX" ? 0.7 : 0.3,
    maxTokens: Math.round(
      (isKimi ? (ctx.mode === "MAX" ? 8192 : 4096) : ctx.mode === "MAX" ? 6144 : 3072) *
        liteFactor,
    ),
  };
}
