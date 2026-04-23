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

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

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
