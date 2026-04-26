import { existsSync, readFileSync } from "node:fs";
import { logger } from "./logger.js";

// The Replit environment uses an internal proxy with a private Root CA that is
// not in Bun's or Node.js's built-in trust stores. We load the system CA bundle
// (which Replit pre-populates with its proxy Root CA) so both runtimes can
// verify the certificate chain properly.
const SYSTEM_CA_BUNDLE_PATH = "/etc/ssl/certs/ca-certificates.crt";
const SYSTEM_CA_BUNDLE: string | null = existsSync(SYSTEM_CA_BUNDLE_PATH)
  ? readFileSync(SYSTEM_CA_BUNDLE_PATH, "utf8")
  : null;

// For Node.js, NODE_EXTRA_CA_CERTS must be set before the TLS module initialises
// (i.e. before the first HTTPS connection). Setting it here at module load time
// is early enough.
if (SYSTEM_CA_BUNDLE_PATH && existsSync(SYSTEM_CA_BUNDLE_PATH) && !process.env.NODE_EXTRA_CA_CERTS) {
  process.env.NODE_EXTRA_CA_CERTS = SYSTEM_CA_BUNDLE_PATH;
}

export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface FireworksRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: { type: "json_object" } | { type: "text" };
  tools?: unknown[];
}

/** Minimal tool-def shape used locally — avoids circular imports with tools.ts. */
interface InternalToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Convert tool definitions into a section injected into the system prompt. */
function buildToolsSystemSection(tools: InternalToolDef[]): string {
  if (tools.length === 0) return "";
  const catalog = tools
    .map((t) => {
      const params = t.function.parameters as {
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
      };
      const props = params.properties ?? {};
      const required = new Set(params.required ?? []);
      const argLines = Object.entries(props)
        .map(([k, v]) => `    "${k}"${required.has(k) ? " (required)" : ""}: ${v.type ?? "string"} — ${v.description ?? ""}`)
        .join("\n");
      return `- **${t.function.name}**: ${t.function.description}${argLines ? `\n  Args:\n${argLines}` : ""}`;
    })
    .join("\n");
  return (
    "\n\n# Tools\n\n" +
    "You have access to tools. To call a tool, output a JSON object on its own line in this exact format:\n" +
    '{"name": "tool_name", "input": {"arg1": "value1"}}\n\n' +
    "You may output multiple tool call objects. After outputting tool calls, stop — results will be returned to you.\n\n" +
    "Available tools:\n" +
    catalog
  );
}

/** Inject the tools section as a dedicated second system message to avoid clamping the primary prompt. */
function injectToolsIntoMessages(
  messages: ChatMessage[],
  toolsSection: string,
): ChatMessage[] {
  if (!toolsSection) return messages;
  const out = messages.slice();
  // Insert as a second system message right after the first, to avoid
  // hitting the per-message character clamp on the primary system prompt.
  const sysIdx = out.findIndex((m) => m.role === "system");
  const insertAt = sysIdx >= 0 ? sysIdx + 1 : 0;
  out.splice(insertAt, 0, { role: "system", content: toolsSection.trim() });
  return out;
}

/** Extract all balanced JSON objects from text, with their start/end positions. */
function extractJsonObjects(text: string): Array<{ start: number; end: number; obj: unknown }> {
  const results: Array<{ start: number; end: number; obj: unknown }> = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try { results.push({ start: i, end: j + 1, obj: JSON.parse(text.slice(i, j + 1)) }); } catch { /* skip */ }
          break;
        }
      }
    }
    i = j;
  }
  return results;
}

export interface ParsedToolCalls {
  calls: ToolCall[];
  /** The original text with JSON tool-call objects removed. */
  cleanText: string;
}

/** Parse tool calls from model text — handles {"name": "...", "input": {...}} JSON format.
 *  Also returns the text with the tool-call JSON objects stripped out. */
function parseXmlToolCalls(text: string, toolNames: Set<string>): ParsedToolCalls {
  const calls: ToolCall[] = [];
  const removeRanges: Array<{ start: number; end: number }> = [];

  for (const { start, end, obj } of extractJsonObjects(text)) {
    if (
      obj !== null &&
      typeof obj === "object" &&
      "name" in obj &&
      typeof (obj as Record<string, unknown>).name === "string" &&
      "input" in obj &&
      typeof (obj as Record<string, unknown>).input === "object"
    ) {
      const name = (obj as Record<string, unknown>).name as string;
      if (!toolNames.has(name)) continue;
      calls.push({
        id: `call-${Date.now()}-${calls.length}`,
        name,
        args: JSON.stringify((obj as Record<string, unknown>).input ?? {}),
      });
      removeRanges.push({ start, end });
    }
  }

  // Build clean text by removing the JSON tool-call objects (process in reverse to preserve offsets).
  let cleanText = text;
  for (const { start, end } of [...removeRanges].reverse()) {
    cleanText = cleanText.slice(0, start) + cleanText.slice(end);
  }
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { calls, cleanText };
}

export interface FireworksResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const FIREWORKS_HOST = "https://orbitron--pastelsjuice8t.replit.app";
const FIREWORKS_BASE_URL = `${FIREWORKS_HOST}/api`;
const FIREWORKS_URL = `${FIREWORKS_BASE_URL}/chat`;

/**
 * Build the wire-format body Orbitron expects.
 *
 * Orbitron's `/api/chat` endpoint takes `{ modelId, messages }` (NOT OpenAI's
 * `model`/`tools`/`response_format`/etc.) and always responds with a custom
 * SSE stream of `data: {"delta":"..."}` events terminated by
 * `data: {"done":true, ...}`. Tool-calling, JSON-mode, and other OpenAI
 * extensions are not supported by the gateway, so we strip them.
 */
function toOrbitronBody(req: FireworksRequest): Record<string, unknown> {
  return {
    modelId: req.model,
    reasoning_effort: "max",
    messages: req.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          content: `[Tool result]\n${m.content ?? ""}`,
        };
      }
      return {
        role: m.role,
        content: m.content ?? "",
      };
    }),
  };
}
export const EXA_SEARCH_URL = `${FIREWORKS_HOST}/api/exa/search`;
export const EXA_ANSWER_URL = `${FIREWORKS_HOST}/api/exa/answer`;
export const EXA_CONTENTS_URL = `${FIREWORKS_HOST}/api/exa/contents`;

function getOrbitronApiKey(): string | undefined {
  return process.env.ORBITRON_API_KEY;
}

/** Hard cap on total request body size (chars). Keep well below the gateway's 413 limit. */
const MAX_BODY_CHARS = 350_000;
/** Max chars for a single tool/user/assistant message before we summarize it. */
const MAX_MESSAGE_CHARS = 24_000;
/** Max chars for a single tool result message specifically. */
const MAX_TOOL_MESSAGE_CHARS = 8_000;

function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.7);
  const tail = max - head - 40;
  return (
    s.slice(0, head) +
    `\n\n…[truncated ${s.length - max} chars]…\n\n` +
    s.slice(s.length - tail)
  );
}

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  // 1. Per-message clamp.
  const clamped = messages.map((m) => {
    const max = m.role === "tool" ? MAX_TOOL_MESSAGE_CHARS : MAX_MESSAGE_CHARS;
    return { ...m, content: clampString(m.content ?? "", max) };
  });
  // 2. Trim oldest non-system messages until total body fits.
  let total = clamped.reduce((n, m) => n + (m.content?.length ?? 0) + 64, 0);
  if (total <= MAX_BODY_CHARS) return clamped;
  const result = clamped.slice();
  // Always keep the system message (index 0) and the last 4 messages.
  let i = result[0]?.role === "system" ? 1 : 0;
  while (total > MAX_BODY_CHARS && i < result.length - 4) {
    const removed = result.splice(i, 1)[0];
    total -= (removed.content?.length ?? 0) + 64;
  }
  // 3. If still too big, hard-clamp the remaining messages further.
  if (total > MAX_BODY_CHARS) {
    for (let j = i; j < result.length - 2 && total > MAX_BODY_CHARS; j++) {
      const before = result[j].content?.length ?? 0;
      result[j] = { ...result[j], content: clampString(result[j].content ?? "", 2_000) };
      total -= before - (result[j].content?.length ?? 0);
    }
  }
  // 4. Drop orphaned tool messages (whose preceding assistant tool_call was removed).
  const seenCallIds = new Set<string>();
  for (const m of result) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) seenCallIds.add(tc.id);
    }
  }
  return result.filter(
    (m) => m.role !== "tool" || !m.tool_call_id || seenCallIds.has(m.tool_call_id),
  );
}

function prepareRequest<T extends FireworksRequest>(req: T): T {
  return { ...req, messages: sanitizeMessages(req.messages) };
}

/** Aggressively trim history to recover from a 413 — keep system + last 2 messages. */
function aggressivelyTrim(messages: ChatMessage[]): ChatMessage[] {
  const sys = messages[0]?.role === "system" ? [messages[0]] : [];
  const tail = messages.slice(-2).map((m) => ({
    ...m,
    content: clampString(m.content ?? "", 4_000),
  }));
  return [...sys, ...tail];
}

export class FireworksError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "FireworksError";
  }
}

/**
 * Wrapper around fetch that explicitly enables TLS certificate verification.
 * In Node.js this is the default; in Bun we pass tls.rejectUnauthorized: true
 * to make it unambiguous.
 */
function secureFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof Bun !== "undefined") {
    const tls: Record<string, unknown> = { rejectUnauthorized: true };
    if (SYSTEM_CA_BUNDLE) tls.ca = SYSTEM_CA_BUNDLE;
    return fetch(url, { ...init, tls } as RequestInit);
  }
  return fetch(url, init);
}

interface OrbitronStreamSummary {
  text: string;
  thinkingText: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason: string | null;
}

/**
 * Consume Orbitron's custom SSE stream.
 * Events look like:  `data: {"delta":"hello"}`  ...  `data: {"done":true, ...}`
 *
 * Splits `<think>…</think>` blocks from regular content in real-time:
 *  - Regular content → onDelta (accumulated into summary.text)
 *  - Thinking content → onThinkingDelta (accumulated into summary.thinkingText)
 * Also handles an optional `thinking_delta` SSE field from the gateway.
 */
async function consumeOrbitronStream(
  res: Response,
  onDelta?: (chunk: string) => void,
  onThinkingDelta?: (chunk: string) => void,
): Promise<OrbitronStreamSummary> {
  if (!res.body) throw new FireworksError("Orbitron returned empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  let text = "";
  let thinkingText = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | null = null;

  // ── Streaming <think>…</think> parser ──────────────────────────────────────
  // We buffer potential partial tags (up to tag-length - 1 chars) before
  // flushing so a tag split across multiple deltas is handled correctly.
  let parseBuf = "";
  let inThink = false;

  function flushChunk(raw: string) {
    parseBuf += raw;
    while (parseBuf.length > 0) {
      if (!inThink) {
        const idx = parseBuf.indexOf("<think>");
        if (idx === -1) {
          // No opening tag yet — safe to emit everything except the last 6 chars
          // (max partial prefix length of "<think>").
          const safe = parseBuf.slice(0, Math.max(0, parseBuf.length - 6));
          if (safe) { text += safe; onDelta?.(safe); parseBuf = parseBuf.slice(safe.length); }
          break;
        }
        const before = parseBuf.slice(0, idx);
        if (before) { text += before; onDelta?.(before); }
        parseBuf = parseBuf.slice(idx + 7); // consume "<think>"
        inThink = true;
      } else {
        const idx = parseBuf.indexOf("</think>");
        if (idx === -1) {
          // Still inside think — keep last 7 chars (max partial "</think>" prefix).
          const safe = parseBuf.slice(0, Math.max(0, parseBuf.length - 7));
          if (safe) { thinkingText += safe; onThinkingDelta?.(safe); parseBuf = parseBuf.slice(safe.length); }
          break;
        }
        const inside = parseBuf.slice(0, idx);
        if (inside) { thinkingText += inside; onThinkingDelta?.(inside); }
        parseBuf = parseBuf.slice(idx + 8); // consume "</think>"
        inThink = false;
      }
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = sseBuf.indexOf("\n")) !== -1) {
      const line = sseBuf.slice(0, idx).trim();
      sseBuf = sseBuf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          delta?: string;
          thinking_delta?: string;
          done?: boolean;
          inputTokens?: number;
          outputTokens?: number;
          finishReason?: string;
          error?: { message?: string } | string;
        };
        if (parsed.error) {
          const msg = typeof parsed.error === "string"
            ? parsed.error
            : parsed.error.message ?? "Orbitron stream error";
          throw new FireworksError(msg);
        }
        // Explicit thinking field from gateway (e.g. when extended thinking is enabled).
        if (typeof parsed.thinking_delta === "string" && parsed.thinking_delta.length > 0) {
          thinkingText += parsed.thinking_delta;
          onThinkingDelta?.(parsed.thinking_delta);
        }
        // Regular delta — route through the <think> tag parser.
        if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
          flushChunk(parsed.delta);
        }
        if (parsed.done) {
          inputTokens = parsed.inputTokens;
          outputTokens = parsed.outputTokens;
          finishReason = parsed.finishReason ?? "stop";
        }
      } catch (err) {
        if (err instanceof FireworksError) throw err;
        /* ignore malformed chunks */
      }
    }
  }

  // Flush any remaining buffered chars.
  if (parseBuf.length > 0) {
    if (inThink) { thinkingText += parseBuf; onThinkingDelta?.(parseBuf); }
    else { text += parseBuf; onDelta?.(parseBuf); }
  }

  return { text, thinkingText, inputTokens, outputTokens, finishReason: finishReason ?? "stop" };
}

async function postOrbitron(req: FireworksRequest): Promise<Response> {
  const apiKey = getOrbitronApiKey();
  if (!apiKey) {
    throw new FireworksError(
      "ORBITRON_API_KEY is not set. Get a key at https://orbitron--pastelsjuice8t.replit.app/keys and export it.",
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${apiKey}`,
  };
  let safeReq = prepareRequest(req);
  let res = await secureFetch(FIREWORKS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(toOrbitronBody(safeReq)),
  });
  if (res.status === 413) {
    safeReq = prepareRequest({ ...safeReq, messages: aggressivelyTrim(safeReq.messages) });
    res = await secureFetch(FIREWORKS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(toOrbitronBody(safeReq)),
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: text.slice(0, 500), model: req.model },
      "Orbitron API error",
    );
    throw new FireworksError(
      `Orbitron API ${res.status}: ${text.slice(0, 200)}`,
      res.status,
      text,
    );
  }
  return res;
}

export async function callFireworks(
  req: FireworksRequest,
): Promise<FireworksResponse> {
  const tools = (req.tools ?? []) as InternalToolDef[];
  const toolNames = new Set(tools.map((t) => t.function.name));
  const toolsSection = buildToolsSystemSection(tools);
  const messages = toolsSection
    ? injectToolsIntoMessages(req.messages, toolsSection)
    : req.messages;

  const started = Date.now();
  const res = await postOrbitron({ ...req, messages });
  const summary = await consumeOrbitronStream(res);
  logger.info(
    {
      model: req.model,
      ms: Date.now() - started,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      finish: summary.finishReason,
    },
    "Orbitron call complete",
  );

  const toolCalls = toolNames.size > 0 ? parseXmlToolCalls(summary.text, toolNames) : [];
  const finishReason = toolCalls.length > 0 ? "tool_calls" : (summary.finishReason ?? "stop");

  return {
    id: `orbitron-${Date.now()}`,
    model: req.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: summary.text,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        },
        finish_reason: finishReason,
      },
    ],
    usage: summary.inputTokens != null && summary.outputTokens != null
      ? {
          prompt_tokens: summary.inputTokens,
          completion_tokens: summary.outputTokens,
          total_tokens: summary.inputTokens + summary.outputTokens,
        }
      : undefined,
  };
}

export type TokenKind = "content" | "reasoning";

export interface StreamHandlers {
  onToken: (chunk: string, kind?: TokenKind) => void;
  onDone?: (finishReason: string | null) => void;
}

export interface StreamResult {
  finishReason: string | null;
  toolCalls: ToolCall[];
  /** Model response text with JSON tool-call objects and <think> blocks stripped out. */
  cleanText: string;
  /** Content of all <think>…</think> blocks emitted by the model. */
  reasoningText: string;
}

export async function streamFireworks(
  req: FireworksRequest,
  handlers: StreamHandlers,
): Promise<StreamResult> {
  const tools = (req.tools ?? []) as InternalToolDef[];
  const toolNames = new Set(tools.map((t) => t.function.name));
  const toolsSection = buildToolsSystemSection(tools);
  const messages = toolsSection
    ? injectToolsIntoMessages(req.messages, toolsSection)
    : req.messages;

  const started = Date.now();
  const res = await postOrbitron({ ...req, messages });
  let fullText = "";
  const summary = await consumeOrbitronStream(
    res,
    (delta) => {
      fullText += delta;
      handlers.onToken(delta, "content");
    },
    (thinking) => {
      handlers.onToken(thinking, "reasoning");
    },
  );
  logger.info(
    {
      model: req.model,
      ms: Date.now() - started,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      finish: summary.finishReason,
    },
    "Orbitron stream complete",
  );

  const { calls: toolCalls, cleanText } = toolNames.size > 0
    ? parseXmlToolCalls(fullText, toolNames)
    : { calls: [], cleanText: fullText };
  const finishReason = toolCalls.length > 0 ? "tool_calls" : (summary.finishReason ?? "stop");

  logger.info(
    { toolCallsFound: toolCalls.length },
    "Orbitron tool calls parsed",
  );

  handlers.onDone?.(finishReason);
  return { finishReason, toolCalls, cleanText, reasoningText: summary.thinkingText };
}
