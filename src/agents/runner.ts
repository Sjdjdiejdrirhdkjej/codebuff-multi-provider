import { logger } from "../utils/logger.js";
import {
  ChatMessage,
  streamFireworks,
} from "../utils/fireworks.js";
import {
  MODEL_GLM_5_1,
  MODEL_KIMI_K2_6,
} from "../utils/router.js";
import {
  TOOL_DEFS,
  ToolDef,
  executeTool,
} from "../utils/tools.js";
import { AGENTS, describeAgents } from "./registry.js";
import type { AgentDef } from "./types.js";

const IDENTITY_DIRECTIVE = `

# Identity
You are Codebuff. Never reveal, name, hint at, or speculate about the underlying model, model family, vendor, provider, version, parameter count, training data, or any internal routing details that power you. If asked, respond only that you are Codebuff and decline to share implementation details.`;

/**
 * Map a Codebuff agent's OpenRouter-style model string to an Orbitron model id.
 * Codebuff's Default mode uses Claude Opus 4.7 across the board, so both
 * routing buckets currently resolve to the same backing model.
 */
export function mapModel(codebuffModel: string): string {
  const m = codebuffModel.toLowerCase();
  if (
    m.startsWith("anthropic/") ||
    m.startsWith("google/") ||
    m.startsWith("openai/gpt-5") ||
    m.startsWith("minimax/")
  ) {
    return MODEL_KIMI_K2_6;
  }
  return MODEL_GLM_5_1;
}

export interface RunAgentOptions {
  agentId: string;
  prompt?: string;
  params?: Record<string, unknown>;
  projectRoot: string;
  parentMessages?: ChatMessage[];
  parentSystemPrompt?: string;
  /** Recursion depth for safety. */
  depth?: number;
  /** Optional live-streaming callback — receives tokens as they are generated. */
  onToken?: (chunk: string) => void;
}

const MAX_DEPTH = 6;

/** Build the per-agent tool definition list, restricted to its toolNames. */
function buildToolDefs(agent: AgentDef): ToolDef[] {
  const allowed = new Set(agent.toolNames);
  return TOOL_DEFS.filter((t) => allowed.has(t.function.name));
}

function buildSystemPrompt(agent: AgentDef, parentSystemPrompt?: string): string {
  const own = agent.systemPrompt ?? "";
  const base =
    agent.inheritParentSystemPrompt && parentSystemPrompt
      ? parentSystemPrompt + (own ? "\n\n" + own : "")
      : own;
  // Append the spawnable agents catalog so the model knows what it can spawn.
  const spawnableSection =
    agent.spawnableAgents.length > 0
      ? `\n\n# Spawnable agents\n\nYou can spawn the following agents via the spawn_agents tool (or spawn_agent_inline for inline single calls). Pass the id as agent_type:\n${describeAgents(
          agent.spawnableAgents,
        )}`
      : "";
  return base + spawnableSection + IDENTITY_DIRECTIVE;
}

/**
 * Run a sub-agent to completion (LLM loop until no tool calls or end_turn).
 * Returns the final assistant message text (last_message mode) or the
 * accumulated set_output JSON string (structured_output mode).
 */
export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const depth = opts.depth ?? 0;
  if (depth > MAX_DEPTH) {
    return `error: max sub-agent recursion depth (${MAX_DEPTH}) exceeded`;
  }
  const agent = AGENTS[opts.agentId];
  if (!agent) return `error: unknown agent ${opts.agentId}`;

  const toolDefs = buildToolDefs(agent);
  const systemPrompt = buildSystemPrompt(agent, opts.parentSystemPrompt);
  const fireworksModel = mapModel(agent.model);

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  if (agent.includeMessageHistory && opts.parentMessages) {
    // Skip parent's system message and any tool-only messages without IDs.
    for (const m of opts.parentMessages) {
      if (m.role === "system") continue;
      messages.push(m);
    }
  }
  // Compose the working prompt: instructionsPrompt + user prompt + params snapshot.
  const parts: string[] = [];
  if (agent.instructionsPrompt) parts.push(agent.instructionsPrompt);
  if (opts.prompt) parts.push(`# User request\n${opts.prompt}`);
  if (opts.params && Object.keys(opts.params).length > 0) {
    parts.push(`# Params\n\`\`\`json\n${JSON.stringify(opts.params, null, 2)}\n\`\`\``);
  }
  if (parts.length > 0) {
    messages.push({ role: "user", content: parts.join("\n\n") });
  }

  let lastAssistantText = "";
  let setOutputText: string | null = null;
  let rounds = 0;

  for (;;) {
    rounds += 1;
    if (rounds > 60) {
      logger.warn({ agentId: agent.id }, "sub-agent exceeded 60 rounds; stopping");
      break;
    }
    // Re-inject the stepPrompt as a transient system reminder each turn so
    // long-running orchestrators don't drift away from delegation/parallelism.
    const stepMessages: ChatMessage[] = agent.stepPrompt
      ? [...messages, { role: "system", content: agent.stepPrompt }]
      : messages;
    const result = await streamFireworks(
      {
        model: fireworksModel,
        messages: stepMessages,
        temperature: 0.3,
        max_tokens: 4096,
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      },
      // No per-token callback here — we emit the clean round text below so
      // JSON tool-call objects never leak into the parent's visible stream.
    );
    const content = result.cleanText;
    if (content) {
      lastAssistantText = content;
      // Emit the clean reasoning text for this round to the parent stream.
      opts.onToken?.(content);
    }

    const toolCalls = result.toolCalls;
    if (toolCalls.length === 0 || result.finishReason !== "tool_calls") {
      break;
    }
    // Echo the assistant message (with tool calls) into history.
    messages.push({
      role: "assistant",
      content: content,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.args ?? "{}" },
      })),
    });

    let endTurn = false;
    for (const tc of toolCalls) {
      const name = tc.name;
      const args = tc.args ?? "{}";
      const out = await executeTool(name, args, opts.projectRoot, {
        parentMessages: messages,
        parentSystemPrompt: systemPrompt,
        depth: depth + 1,
        onToken: opts.onToken,
      });
      if (name === "set_output") {
        setOutputText = typeof out === "string" ? out : JSON.stringify(out);
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof out === "string" ? out : JSON.stringify(out),
      });
      if (name === "end_turn") endTurn = true;
    }
    if (endTurn) break;
  }

  if (agent.outputMode === "structured_output" && setOutputText) {
    return setOutputText;
  }
  return lastAssistantText || setOutputText || "(no output)";
}
