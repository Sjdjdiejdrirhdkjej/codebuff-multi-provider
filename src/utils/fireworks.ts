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
const FIREWORKS_BASE_URL = `${FIREWORKS_HOST}/api/v1`;
const FIREWORKS_URL = `${FIREWORKS_BASE_URL}/chat/completions`;
export const EXA_SEARCH_URL = `${FIREWORKS_HOST}/api/exa/search`;
export const EXA_ANSWER_URL = `${FIREWORKS_HOST}/api/exa/answer`;
export const EXA_CONTENTS_URL = `${FIREWORKS_HOST}/api/exa/contents`;

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

export async function callFireworks(
  req: FireworksRequest,
): Promise<FireworksResponse> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  let safeReq = prepareRequest(req);
  let res = await secureFetch(FIREWORKS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(safeReq),
  });

  if (res.status === 413) {
    safeReq = prepareRequest({ ...safeReq, messages: aggressivelyTrim(safeReq.messages) });
    res = await secureFetch(FIREWORKS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(safeReq),
    });
  }

  const text = await res.text();
  if (!res.ok) {
    logger.error(
      { status: res.status, body: text.slice(0, 500), model: req.model },
      "Fireworks API error",
    );
    throw new FireworksError(
      `Fireworks API ${res.status}: ${text.slice(0, 200)}`,
      res.status,
      text,
    );
  }

  let parsed: FireworksResponse;
  try {
    parsed = JSON.parse(text) as FireworksResponse;
  } catch (err) {
    throw new FireworksError(`Invalid JSON from Fireworks: ${err}`);
  }

  logger.info(
    {
      model: req.model,
      ms: Date.now() - started,
      usage: parsed.usage,
      finish: parsed.choices?.[0]?.finish_reason,
    },
    "Fireworks call complete",
  );
  return parsed;
}

export type TokenKind = "content" | "reasoning";

export interface StreamHandlers {
  onToken: (chunk: string, kind?: TokenKind) => void;
  onDone?: (finishReason: string | null) => void;
}

export interface StreamResult {
  finishReason: string | null;
  toolCalls: ToolCall[];
}

export async function streamFireworks(
  req: FireworksRequest,
  handlers: StreamHandlers,
): Promise<StreamResult> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  let safeReq = prepareRequest(req);
  let res = await secureFetch(FIREWORKS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...safeReq, stream: true }),
  });

  if (res.status === 413) {
    safeReq = prepareRequest({ ...safeReq, messages: aggressivelyTrim(safeReq.messages) });
    res = await secureFetch(FIREWORKS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...safeReq, stream: true }),
    });
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new FireworksError(
      `Fireworks API ${res.status}: ${text.slice(0, 200)}`,
      res.status,
      text,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finishReason: string | null = null;
  const pendingTools = new Map<number, ToolCall>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Parse SSE: events separated by \n\n, each line "data: <json>" or "data: [DONE]".
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{
                  index?: number;
                  function?: { name?: string | null; arguments?: string | null };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };
          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) handlers.onToken(choice.delta.content, "content");
          if (choice?.delta?.reasoning_content)
            handlers.onToken(choice.delta.reasoning_content, "reasoning");
          if (choice?.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls as Array<{
              index?: number;
              id?: string;
              function?: { name?: string | null; arguments?: string | null };
            }>) {
              const idx = tc.index ?? 0;
              const cur = pendingTools.get(idx) ?? { id: "", name: "", args: "" };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name = tc.function.name;
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              pendingTools.set(idx, cur);
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  }

  const toolCalls = Array.from(pendingTools.values()).filter((t) => t.name);
  logger.info(
    {
      model: req.model,
      ms: Date.now() - started,
      finish: finishReason,
      tools: toolCalls.length,
    },
    "Fireworks stream complete",
  );
  handlers.onDone?.(finishReason);
  return { finishReason, toolCalls };
}
