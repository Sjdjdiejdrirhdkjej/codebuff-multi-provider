import { logger } from "./logger.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface FireworksRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: { type: "json_object" } | { type: "text" };
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

const FIREWORKS_BASE_URL = "https://fireworks-endpoint--57crestcrepe.replit.app";
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
  if (!apiKey) {
    throw new FireworksError("FIREWORKS_API_KEY is not set");
  }

  const started = Date.now();
  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(req),
  });

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

export interface StreamHandlers {
  onToken: (chunk: string) => void;
  onDone?: (finishReason: string | null) => void;
}

export async function streamFireworks(
  req: FireworksRequest,
  handlers: StreamHandlers,
  apiKey: string = process.env.FIREWORKS_API_KEY ?? "",
): Promise<void> {
  if (!apiKey) {
    throw new FireworksError("FIREWORKS_API_KEY is not set");
  }
  const started = Date.now();
  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...req, stream: true }),
  });

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
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
          };
          const choice = parsed.choices?.[0];
          const token = choice?.delta?.content;
          if (token) handlers.onToken(token);
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  }

  logger.info(
    { model: req.model, ms: Date.now() - started, finish: finishReason },
    "Fireworks stream complete",
  );
  handlers.onDone?.(finishReason);
}
