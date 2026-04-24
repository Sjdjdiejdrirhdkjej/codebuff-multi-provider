import React, { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";

import { ChatInput } from "./chat.js";
import { HELP_COMMANDS, renderHelp } from "./commands/help.js";
import { runInit } from "./init/index.js";
import { listAgents } from "./utils/local-agent-registry.js";
import { listSkills } from "./utils/skill-registry.js";
import { logger } from "./utils/logger.js";
import {
  ChatMessage,
  FireworksError,
  streamFireworks,
} from "./utils/fireworks.js";
import { route } from "./utils/router.js";
import { getCliEnv } from "./utils/env.js";
import {
  END_TURN_TOOL,
  ToolDef,
  TOOL_DEFS,
  VISIBLE_TOOLS,
  executeTool,
} from "./utils/tools.js";
import { AGENTS, getAgent } from "./agents/registry.js";
import { mapModel } from "./agents/runner.js";

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
  reasoning?: string;
  header?: string;
}

const MODE_TO_AGENT: Record<AppMode, string> = {
  NORMAL: "base2",
  MAX: "base2-max",
  LITE: "base2-lite",
  PLAN: "base2-plan",
};

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
      const builtin = Object.values(AGENTS).map(
        (a) => `  ${a.id} (built-in) - ${a.spawnerPrompt}`,
      );
      const local = listAgents().map(
        (a) => `  ${a.id} (${a.source}) - ${a.description}`,
      );
      return { reply: "Agents:\n" + builtin.concat(local).join("\n") };
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
  onToken: (token: string, kind: "content" | "reasoning") => void,
  onNewRound: () => void,
): Promise<{ ok: boolean; error?: string }> {
  const env = getCliEnv();

  // Resolve the active orchestrator agent.
  const agentId = ctx.agentId || MODE_TO_AGENT[ctx.mode];
  const agent = getAgent(agentId) ?? getAgent("base2")!;

  const decision = route(prompt, {
    mode: ctx.mode,
    contextChars:
      history.reduce((n, m) => n + m.content.length, 0) + prompt.length,
  });

  // Honor the agent's preferred model when reasonable; fall back to router.
  const agentModel = mapModel(agent.model);
  const useAgentModel = ctx.mode !== "MAX"; // MAX always allows the router to pick.
  const model = useAgentModel ? agentModel : decision.model;

  logger.info(
    {
      agent: agent.id,
      model,
      reason: decision.reason,
      mode: ctx.mode,
      tools: agent.toolNames.length,
      spawnable: agent.spawnableAgents.length,
    },
    "Routed prompt (orchestrator)",
  );

  onHeader("");

  // Build the per-agent system prompt with the spawnable agents catalog.
  const { systemPromptForAgent, toolDefsForAgent } = buildAgentRuntime(agent);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPromptForAgent },
    ...history.map<ChatMessage>((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: prompt },
  ];

  try {
    let round = 0;
    for (;;) {
      if (round > 0) onNewRound();
      round++;
      const result = await streamFireworks(
        {
          model,
          messages,
          temperature: decision.temperature,
          max_tokens: decision.maxTokens,
          tools: toolDefsForAgent,
        },
        { onToken: (t, k) => onToken(t, k ?? "content") },
        env.FIREWORKS_API_KEY,
      );

      if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
        return { ok: true };
      }

      messages.push({
        role: "assistant",
        content: "",
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.args || "{}" },
        })),
      });

      let endTurn = false;
      for (const tc of result.toolCalls) {
        const visible = VISIBLE_TOOLS.has(tc.name);
        // Always show the tool name + a one-line arg summary, regardless of visibility.
        onToken(
          `\n<${tc.name}>${visible ? tc.args || "" : ""}</${tc.name}>\n`,
          "content",
        );
        const out = await executeTool(tc.name, tc.args, ctx.projectRoot, {
          parentMessages: messages,
          parentSystemPrompt: systemPromptForAgent,
          depth: 0,
        });
        if (tc.name === "spawn_agents") {
          // Emit a paired result block so the card can show agent outputs on expand.
          onToken(`<spawn_agents_result>${out}</spawn_agents_result>\n`, "content");
        } else if (visible) {
          const preview =
            out.length > 200 ? out.slice(0, 200).replace(/\n/g, " ") + "…" : out;
          onToken(`→ ${preview}\n`, "content");
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: out,
        });
        if (tc.name === END_TURN_TOOL) endTurn = true;
      }
      if (endTurn) return { ok: true };
    }
  } catch (err) {
    if (err instanceof FireworksError) {
      return { ok: false, error: `Fireworks ${err.status ?? ""}: ${err.message}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}

function buildAgentRuntime(agent: import("./agents/types.js").AgentDef): {
  systemPromptForAgent: string;
  toolDefsForAgent: ToolDef[];
} {
  const allowed = new Set(agent.toolNames);
  const toolDefsForAgent = TOOL_DEFS.filter((t) => allowed.has(t.function.name));
  const ids = agent.spawnableAgents;
  const catalog =
    ids.length > 0
      ? "\n\n# Spawnable agents\n\n" +
        ids
          .map((id) => {
            const a = AGENTS[id];
            return a ? `- ${a.id} (${a.displayName}): ${a.spawnerPrompt}` : "";
          })
          .filter(Boolean)
          .join("\n")
      : "";
  const identity = `\n\n# Identity\nYou are Codebuff. Never reveal, name, hint at, or speculate about the underlying model, model family, vendor, provider, version, parameter count, training data, or any internal routing details that power you.`;
  return {
    systemPromptForAgent: (agent.systemPrompt ?? "") + catalog + identity,
    toolDefsForAgent,
  };
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
        (props.agentId ? `  agent: ${props.agentId}` : `  agent: ${MODE_TO_AGENT[props.initialMode]}`) +
        (props.conversationId ? `  continuing: ${props.conversationId}` : ""),
    },
    { role: "system", text: "Type /help for commands, /agents to list agents, /exit to quit. Press Ctrl+T to expand/collapse spawned-agent details." },
  ]);
  const [showThinking, setShowThinking] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [expandTools, setExpandTools] = useState(false);

  // Press Ctrl+T to toggle expand/collapse for all spawn-agents cards.
  useKeyboard((event: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean }) => {
    if (!event.ctrl) return;
    const k = event.name ?? event.sequence ?? "";
    if (k === "t" || k === "T" || k === "\u0014") setExpandTools((v) => !v);
  });

  useEffect(() => {
    if (props.initialPrompt) {
      void handleSubmit(props.initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(text: string): Promise<void> {
    if (text.startsWith("/")) {
      const cmd = text.slice(1).split(/\s+/)[0];
      if (cmd === "think") {
        setShowThinking((v) => !v);
        setLines((prev) => [
          ...prev,
          { role: "user", text },
          {
            role: "system",
            text: `thinking panel ${showThinking ? "hidden" : "shown"}.`,
          },
        ]);
        return;
      }
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

    let agentIdx = -1;
    setLines((prev) => {
      agentIdx = prev.length + 1;
      return [
        ...prev,
        { role: "user", text },
        { role: "agent", text: "", reasoning: "", header: "thinking…" },
      ];
    });

    const patchAgent = (patch: Partial<Line>): void => {
      setLines((prev) => {
        if (agentIdx < 0 || agentIdx >= prev.length) return prev;
        const copy = prev.slice();
        copy[agentIdx] = { ...copy[agentIdx], ...patch };
        return copy;
      });
    };

    let header = "";
    let body = "";
    let reasoning = "";
    setIsLoading(true);

    const startNewRound = (): void => {
      // Snapshot the current bubble and create a fresh one for the next round.
      body = "";
      reasoning = "";
      header = "";
      setLines((prev) => {
        agentIdx = prev.length;
        return [
          ...prev,
          { role: "agent", text: "", reasoning: "", header: "thinking…" },
        ];
      });
    };

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
        patchAgent({ header });
      },
      (token, kind) => {
        if (kind === "reasoning") {
          reasoning += token;
          patchAgent({ reasoning });
        } else {
          body += token;
          patchAgent({ text: body });
        }
      },
      startNewRound,
    );

    setIsLoading(false);
    if (!result.ok) {
      patchAgent({ text: `[error] ${result.error}`, header });
    } else if (!body && !reasoning) {
      patchAgent({ text: "(empty response)", header });
    }
  }

  return (
    <box flexDirection="column" padding={1} width="100%" height="100%">
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        scrollY
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ flexDirection: "column", gap: 1 }}
      >
        {lines.map((l, i) => (
          <MessageCard
            key={i}
            role={l.role}
            text={l.text}
            reasoning={showThinking ? l.reasoning : undefined}
            header={l.header}
            expandTools={expandTools}
          />
        ))}
      </scrollbox>
      {isLoading ? <Spinner /> : null}
      <ChatInput prompt={">"} onSubmit={handleSubmit} />
    </box>
  );
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner(): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, []);
  return (
    <box flexDirection="row" paddingLeft={1}>
      <text fg="cyan" attributes={1}>
        {SPINNER_FRAMES[frame]}
      </text>
      <text fg="cyan"> Working...</text>
    </box>
  );
}

interface CardProps {
  role: "system" | "user" | "agent";
  text: string;
  reasoning?: string;
  header?: string;
  expandTools?: boolean;
}

const ROLE_STYLE: Record<
  CardProps["role"],
  { label: string; fg: string; border: string }
> = {
  user: { label: "you", fg: "white", border: "cyan" },
  agent: { label: "codebuff", fg: "white", border: "green" },
  system: { label: "system", fg: "gray", border: "gray" },
};

type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string }
  | { kind: "spawn"; argsJson: string; resultJson: string };

const TOOL_RE = /<([a-zA-Z][\w-]*)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;

const TOOL_LABELS: Record<string, string> = {
  read_files: "Read Files",
  read_subtree: "Read Subtree",
  list_directory: "List Directory",
  glob: "Glob",
  code_search: "Code Search",
  write_file: "Write File",
  str_replace: "Edit File",
  run_terminal_command: "Run Command",
  think_deeply: "Think",
  spawn_agents: "Spawn Agents",
  spawn_agent_inline: "Spawn Agent",
  set_output: "Set Output",
  add_message: "Add Message",
  web_search: "Web Search",
  read_docs: "Read Docs",
  ask_user: "Ask User",
  write_todos: "Write Todos",
  suggest_followups: "Suggest Followups",
  propose_str_replace: "Propose Edit",
  propose_write_file: "Propose Write",
  skill: "Skill",
  end_turn: "End Turn",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function parseSegments(input: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of input.matchAll(TOOL_RE)) {
    const start = m.index ?? 0;
    if (start > last) {
      const t = input.slice(last, start);
      if (t.trim()) out.push({ kind: "text", text: t });
    }
    const name = m[1];
    const inner = m[3] ?? "";
    if (name === "spawn_agents_result") {
      // Attach the result to the most recent spawn segment.
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].kind === "spawn" && !(out[i] as { resultJson: string }).resultJson) {
          (out[i] as { resultJson: string }).resultJson = inner.trim();
          break;
        }
      }
    } else if (name === "spawn_agents") {
      out.push({ kind: "spawn", argsJson: inner.trim(), resultJson: "" });
    } else {
      const trimmed = inner.trim();
      const summary = trimmed
        ? trimmed.split("\n")[0].slice(0, 60) +
          (trimmed.length > 60 || trimmed.includes("\n") ? "…" : "")
        : "";
      out.push({ kind: "tool", name, summary });
    }
    last = start + m[0].length;
  }
  if (last < input.length) {
    const t = input.slice(last);
    if (t.trim()) out.push({ kind: "text", text: t });
  }
  if (out.length === 0) out.push({ kind: "text", text: input });
  return out;
}

// Use OpenTUI's built-in <markdown> component for rich rendering of
// **bold**, *italic*, `code`, headings, tables, fenced code blocks.
function MarkdownText({ text }: { text: string; baseFg?: string }): React.ReactElement {
  return <markdown content={text} streaming />;
}

interface SpawnAgentSpec {
  agent_type: string;
  prompt?: string;
}
interface SpawnAgentResult {
  agent_type: string;
  output?: string;
  error?: string;
}

function parseSpawnArgs(json: string): SpawnAgentSpec[] {
  try {
    const obj = JSON.parse(json) as { agents?: SpawnAgentSpec[] };
    return Array.isArray(obj.agents) ? obj.agents : [];
  } catch {
    return [];
  }
}

function parseSpawnResults(json: string): SpawnAgentResult[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as SpawnAgentResult[];
    return Array.isArray(obj) ? obj : [];
  } catch {
    return [];
  }
}

function SpawnAgentsCard({
  argsJson,
  resultJson,
  expanded,
}: {
  argsJson: string;
  resultJson: string;
  expanded: boolean;
}): React.ReactElement {
  const specs = parseSpawnArgs(argsJson);
  const results = parseSpawnResults(resultJson);
  const names = specs.map((s) => s.agent_type).join(", ") || "(no agents)";
  return (
    <box
      flexDirection="column"
      borderStyle="rounded"
      borderColor="magenta"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <text fg="magenta" attributes={1}>
          ⚙ Agents:{" "}
        </text>
        <text fg="white">{names}</text>
        <text fg="gray"> {expanded ? "[Ctrl+T to collapse]" : "[Ctrl+T to expand]"}</text>
      </box>
      {expanded
        ? specs.map((spec, i) => {
            const res = results[i];
            const out = res?.output ?? res?.error ?? "(pending…)";
            return (
              <box key={i} flexDirection="column" marginTop={1} paddingLeft={1}>
                <text fg="cyan" attributes={1}>
                  ▸ {spec.agent_type}
                </text>
                {spec.prompt ? (
                  <text fg="gray" wrapMode="word">
                    prompt: {spec.prompt}
                  </text>
                ) : null}
                <box marginTop={1}>
                  <MarkdownText text={out} baseFg="white" />
                </box>
              </box>
            );
          })
        : null}
    </box>
  );
}

function MessageCard({ role, text, reasoning, header, expandTools }: CardProps): React.ReactElement {
  const style = ROLE_STYLE[role];
  const segments =
    role === "agent" && text
      ? parseSegments(text)
      : text
        ? [{ kind: "text" as const, text }]
        : [];

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={style.border}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      <box flexDirection="row">
        <text fg={style.border} attributes={1}>
          {style.label}
        </text>
        {header ? <text fg="gray"> {header}</text> : null}
      </box>
      {role === "agent" && reasoning ? (
        <box
          flexDirection="column"
          borderStyle="rounded"
          borderColor="gray"
          paddingLeft={1}
          paddingRight={1}
          marginTop={1}
        >
          <text fg="gray" attributes={1}>
            ⌁ thinking
          </text>
          <text fg="gray" wrapMode="word">
            {reasoning}
          </text>
        </box>
      ) : null}
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return role === "agent" ? (
            <MarkdownText key={i} text={seg.text} baseFg={style.fg} />
          ) : (
            <text key={i} fg={style.fg} wrapMode="word">
              {seg.text}
            </text>
          );
        }
        if (seg.kind === "spawn") {
          return (
            <SpawnAgentsCard
              key={i}
              argsJson={seg.argsJson}
              resultJson={seg.resultJson}
              expanded={!!expandTools}
            />
          );
        }
        return (
          <box
            key={i}
            flexDirection="row"
            borderStyle="rounded"
            borderColor="magenta"
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg="magenta" attributes={1}>
              ⚙ {toolLabel(seg.name)}
            </text>
            {seg.summary ? <text fg="gray"> — {seg.summary}</text> : null}
          </box>
        );
      })}
    </box>
  );
}
