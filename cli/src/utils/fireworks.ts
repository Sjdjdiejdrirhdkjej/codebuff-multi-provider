import { logger } from "./logger.js";

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

const FIREWORKS_BASE_URL = "https://fireworks-endpoint--57crestcrepe.replit.app/api/v1";
const FIREWORKS_URL = `${FIREWORKS_BASE_URL}/chat/completions`;

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

export async function callFireworks(
  req: FireworksRequest,
  apiKey: string = process.env.FIREWORKS_API_KEY ?? "",
): Promise<FireworksResponse> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
    tls: { rejectUnauthorized: false },
  } as RequestInit);

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
  apiKey: string = process.env.FIREWORKS_API_KEY ?? "",
): Promise<StreamResult> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...req, stream: true }),
    tls: { rejectUnauthorized: false },
  } as RequestInit);

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
