import React, { useEffect, useState } from "react";

import { ChatInput } from "./chat.js";
import { HELP_COMMANDS, renderHelp } from "./commands/help.js";
import { runInit } from "./init/index.js";
import { listAgents } from "./utils/local-agent-registry.js";
import { listSkills } from "./utils/skill-registry.js";
import { logger } from "./utils/logger.js";
import { FireworksError, streamFireworks } from "./utils/fireworks.js";
import { route } from "./utils/router.js";
import { getCliEnv } from "./utils/env.js";

export type AppMode = "LITE" | "NORMAL" | "MAX" | "PLAN";

export interface AppProps {
  projectRoot: string;
  initialPrompt: string | null;
  agentId: string | null;
  initialMode: AppMode;
  conversationId: string | null;
  isFreebuff: boolean;
  version: string;
}

interface Line {
  role: "system" | "user" | "agent";
  text: string;
}

function dispatchSlash(
  raw: string,
  projectRoot: string,
): { reply: string; exit?: boolean } {
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  switch (cmd) {
    case "help":
      return { reply: "Available commands:\n" + renderHelp() };
    case "init": {
      const r = runInit(projectRoot);
      return { reply: r.message };
    }
    case "agents": {
      const agents = listAgents();
      return {
        reply:
          "Agents:\n" +
          agents
            .map((a) => `  ${a.id} (${a.source}) - ${a.description}`)
            .join("\n"),
      };
    }
    case "skills": {
      const skills = listSkills();
      return {
        reply:
          "Skills:\n" + skills.map((s) => `  ${s.id} - ${s.description}`).join("\n"),
      };
    }
    case "clear":
      return { reply: "__CLEAR__" };
    case "exit":
    case "quit":
      return { reply: "Goodbye.", exit: true };
    default:
      return {
        reply: `Unknown command: /${cmd}. Try /help (${HELP_COMMANDS.length} commands).`,
      };
  }
}

async function streamToBackend(
  prompt: string,
  ctx: { projectRoot: string; agentId: string | null; mode: AppMode },
  history: Array<{ role: "user" | "assistant"; content: string }>,
  onHeader: (header: string) => void,
  onToken: (token: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const env = getCliEnv();
  if (!env.FIREWORKS_API_KEY) {
    return {
      ok: false,
      error:
        "FIREWORKS_API_KEY is not set. Add it to your environment to enable the AI backend.",
    };
  }

  const decision = route(prompt, {
    mode: ctx.mode,
    contextChars:
      history.reduce((n, m) => n + m.content.length, 0) + prompt.length,
  });
  logger.info(
    { model: decision.model, reason: decision.reason, mode: ctx.mode },
    "Routed prompt (streaming)",
  );

  const tag = decision.model.endsWith("glm-5p1") ? "GLM-5.1" : "Kimi K2.6";
  onHeader(`[${tag} · ${decision.reason}]`);

  try {
    await streamFireworks(
      {
        model: decision.model,
        messages: [
          { role: "system", content: decision.systemPrompt },
          ...history,
          { role: "user", content: prompt },
        ],
        temperature: decision.temperature,
        max_tokens: decision.maxTokens,
      },
      { onToken },
      env.FIREWORKS_API_KEY,
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof FireworksError) {
      return { ok: false, error: `Fireworks ${err.status ?? ""}: ${err.message}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export function App(props: AppProps): React.ReactElement {
  const banner = props.isFreebuff
    ? `freebuff v${props.version}`
    : `codebuff v${props.version}`;

  const [lines, setLines] = useState<Line[]>(() => [
    { role: "system", text: banner },
    {
      role: "system",
      text: `cwd: ${props.projectRoot}  mode: ${props.initialMode}` +
        (props.agentId ? `  agent: ${props.agentId}` : "") +
        (props.conversationId ? `  continuing: ${props.conversationId}` : ""),
    },
    { role: "system", text: "Type /help for commands, /exit to quit." },
  ]);

  useEffect(() => {
    if (props.initialPrompt) {
      void handleSubmit(props.initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(text: string): Promise<void> {
    if (text.startsWith("/")) {
      const { reply, exit } = dispatchSlash(text, props.projectRoot);
      if (reply === "__CLEAR__") {
        setLines([{ role: "system", text: banner }]);
      } else {
        setLines((prev) => [
          ...prev,
          { role: "user", text },
          { role: "system", text: reply },
        ]);
      }
      if (exit) {
        setTimeout(() => process.exit(0), 50);
      }
      return;
    }

    const history = lines
      .filter((l) => l.role === "user" || l.role === "agent")
      .map((l) => ({
        role: l.role === "user" ? ("user" as const) : ("assistant" as const),
        content: l.text,
      }));

    // Append the user line plus a placeholder agent line; we'll mutate the
    // agent line as tokens arrive.
    let agentIdx = -1;
    setLines((prev) => {
      agentIdx = prev.length + 1;
      return [
        ...prev,
        { role: "user", text },
        { role: "agent", text: "…" },
      ];
    });

    const updateAgent = (next: string): void => {
      setLines((prev) => {
        if (agentIdx < 0 || agentIdx >= prev.length) return prev;
        const copy = prev.slice();
        copy[agentIdx] = { role: "agent", text: next };
        return copy;
      });
    };

    let header = "";
    let body = "";
    const result = await streamToBackend(
      text,
      {
        projectRoot: props.projectRoot,
        agentId: props.agentId,
        mode: props.initialMode,
      },
      history,
      (h) => {
        header = h;
        updateAgent(`${header}\n`);
      },
      (token) => {
        body += token;
        updateAgent(`${header}\n${body}`);
      },
    );

    if (!result.ok) {
      updateAgent(`[error] ${result.error}`);
    } else if (!body) {
      updateAgent(`${header}\n(empty response)`);
    }
  }

  return (
    <box flexDirection="column" padding={1}>
      <box flexDirection="column" flexGrow={1}>
        {lines.map((l, i) => {
          const fg =
            l.role === "user" ? "white" : l.role === "agent" ? "green" : "gray";
          const prefix =
            l.role === "user" ? "> " : l.role === "agent" ? "~ " : "  ";
          return (
            <text key={i} fg={fg}>
              {prefix}
              {l.text}
            </text>
          );
        })}
      </box>
      <ChatInput prompt={">"} onSubmit={handleSubmit} />
    </box>
  );
}
