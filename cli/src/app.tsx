import React, { useEffect, useState } from "react";

import { ChatInput } from "./chat.js";
import { HELP_COMMANDS, renderHelp } from "./commands/help.js";
import { runInit } from "./init/index.js";
import { listAgents } from "./utils/local-agent-registry.js";
import { listSkills } from "./utils/skill-registry.js";
import { logger } from "./utils/logger.js";

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

async function sendToBackend(
  prompt: string,
  ctx: { projectRoot: string; agentId: string | null; mode: AppMode },
): Promise<string> {
  // Real flow: call the Codebuff web API via @codebuff/sdk and stream the
  // agent's actions and code edits. That backend is not available in this
  // environment, so we surface a clear placeholder response.
  logger.info({ prompt, ctx }, "Would send prompt to Codebuff backend");
  return [
    `[stub] Would dispatch to ${ctx.agentId ?? "default"} agent in ${ctx.mode} mode.`,
    `Project root: ${ctx.projectRoot}`,
    `Prompt: ${prompt}`,
  ].join("\n");
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

    setLines((prev) => [...prev, { role: "user", text }]);
    const reply = await sendToBackend(text, {
      projectRoot: props.projectRoot,
      agentId: props.agentId,
      mode: props.initialMode,
    });
    setLines((prev) => [...prev, { role: "agent", text: reply }]);
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
