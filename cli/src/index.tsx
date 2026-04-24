import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { App, type AppMode } from "./app.js";
import { handlePublish } from "./commands/publish.js";
import { runPlainLogin } from "./login/index.js";
import {
  getAuthToken,
  setApiClientAuthToken,
} from "./utils/auth.js";
import { getCliEnv } from "./utils/env.js";
import {
  clearLogFile,
  logFilePath,
  logger,
} from "./utils/logger.js";
import { initializeAgentRegistry } from "./utils/local-agent-registry.js";
import { initializeSkillRegistry } from "./utils/skill-registry.js";
import { pickProject } from "./utils/project-picker.js";

export interface ParsedArgs {
  initialPrompt: string | null;
  agent: string | null;
  clearLogs: boolean;
  continue: boolean;
  continueId: string | null;
  cwd: string;
  initialMode: AppMode;
  command: "login" | "publish" | null;
  publishAgentIds: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const env = getCliEnv();
  const isFreebuff = env.IS_FREEBUFF;

  const program = new Command();
  program
    .name(isFreebuff ? "freebuff" : "codebuff")
    .description("Codebuff terminal AI coding assistant")
    .version(env.CODEBUFF_CLI_VERSION)
    .option("--continue [conversation-id]", "Continue a previous conversation")
    .option("--cwd <directory>", "Working directory")
    .allowExcessArguments(true)
    .enablePositionalOptions()
    .argument("[prompt...]", "Initial prompt")
    .action(() => {
      // Empty action so Commander does not auto-print help on no args.
    });

  if (!isFreebuff) {
    program
      .option("--agent <agent-id>", "Run a specific agent (skips local overrides)")
      .option("--clear-logs", "Clear the local log file before starting")
      .option("--lite", "Run in LITE mode")
      .option("--free", "Alias for --lite")
      .option("--max", "Run in MAX mode")
      .option("--plan", "Run in PLAN mode");
  }

  let command: "login" | "publish" | null = null;
  let publishAgentIds: string[] = [];

  program
    .command("login")
    .description("Authenticate with the Codebuff backend")
    .action(() => {
      command = "login";
    });

  if (!isFreebuff) {
    program
      .command("publish [agentIds...]")
      .description("Publish one or more agents to the registry")
      .action((ids: string[]) => {
        command = "publish";
        publishAgentIds = ids ?? [];
      });
  }

  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    continue?: boolean | string;
    cwd?: string;
    agent?: string;
    clearLogs?: boolean;
    lite?: boolean;
    free?: boolean;
    max?: boolean;
    plan?: boolean;
  }>();
  const positional = program.args ?? [];

  let initialMode: AppMode = "NORMAL";
  if (opts.lite || opts.free) initialMode = "LITE";
  else if (opts.max) initialMode = "MAX";
  else if (opts.plan) initialMode = "PLAN";

  let cont = false;
  let continueId: string | null = null;
  if (opts.continue !== undefined) {
    cont = true;
    if (typeof opts.continue === "string") continueId = opts.continue;
  }

  // Strip out subcommand names from positional args.
  const promptParts = positional.filter(
    (p) => p !== "login" && p !== "publish",
  );

  return {
    initialPrompt: promptParts.length > 0 ? promptParts.join(" ") : null,
    agent: opts.agent ?? null,
    clearLogs: Boolean(opts.clearLogs),
    continue: cont,
    continueId,
    cwd: opts.cwd ?? process.cwd(),
    initialMode,
    command,
    publishAgentIds,
  };
}

function installEarlyFatalHandlers(): void {
  const earlyFatalHandler = (err: unknown): void => {
    try {
      if (process.stdin.isTTY && (process.stdin as any).setRawMode) {
        (process.stdin as any).setRawMode(false);
      }
      // Reset terminal: show cursor, exit alt screen, reset attrs.
      process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[0m\n");
    } catch {
      /* swallow */
    }
    // eslint-disable-next-line no-console
    console.error("[codebuff] fatal:", err);
    process.exit(1);
  };
  process.on("uncaughtException", earlyFatalHandler);
  process.on("unhandledRejection", earlyFatalHandler);
}

export async function main(rawArgv: string[] = process.argv.slice(2)): Promise<void> {
  installEarlyFatalHandlers();

  const env = getCliEnv();
  const args = parseArgs(rawArgv);

  if (args.clearLogs) clearLogFile();
  logger.info({ args, version: env.CODEBUFF_CLI_VERSION }, "CLI starting");

  // --cwd takes effect before initialization.
  if (args.cwd && resolve(args.cwd) !== process.cwd()) {
    if (!existsSync(args.cwd) || !statSync(args.cwd).isDirectory()) {
      // eslint-disable-next-line no-console
      console.error(`--cwd not a directory: ${args.cwd}`);
      process.exit(1);
    }
    process.chdir(args.cwd);
  }

  // Subcommands short-circuit.
  if (args.command === "login") {
    const r = await runPlainLogin();
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error("Login failed:", r.error);
      process.exit(1);
    }
    process.exit(0);
  }

  // Initialize app: auth, project, registries.
  const token = getAuthToken();
  setApiClientAuthToken(token);

  const { root: projectRoot } = pickProject(process.cwd());
  initializeAgentRegistry(projectRoot);
  initializeSkillRegistry();

  if (args.command === "publish") {
    const r = await handlePublish(args.publishAgentIds, projectRoot);
    if (r.ok) {
      // eslint-disable-next-line no-console
      console.log(`✅ Successfully published: ${r.published.join(", ")}`);
      process.exit(0);
    } else {
      // eslint-disable-next-line no-console
      console.error(`❌ Publish failed: ${r.error ?? "unknown error"}`);
      process.exit(1);
    }
  }

  const conversationId =
    args.continue && args.continueId ? args.continueId : args.continue ? randomUUID() : null;

  // Render TUI. We import @opentui/react lazily so that --help and tests
  // that only call parseArgs don't pull in the renderer.
  let createRoot: (renderer: unknown) => {
    render: (el: React.ReactElement) => unknown;
  };
  let createCliRenderer: (opts?: unknown) => Promise<unknown> | unknown;
  try {
    ({ createRoot } = await import("@opentui/react"));
    ({ createCliRenderer } = await import("@opentui/core"));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "Failed to load TUI renderer. Logs at:",
      logFilePath(),
      "\n",
      err,
    );
    process.exit(1);
  }

  const renderer = await Promise.resolve(createCliRenderer());
  const root = createRoot(renderer);
  root.render(
    <App
      projectRoot={projectRoot}
      initialPrompt={args.initialPrompt}
      agentId={args.agent}
      initialMode={args.initialMode}
      conversationId={conversationId}
      isFreebuff={env.IS_FREEBUFF}
      version={env.CODEBUFF_CLI_VERSION}
    />,
  );
}

// Only auto-run when executed as the entry point.
let invokedAsMain = false;
if (typeof Bun !== "undefined") {
  invokedAsMain = Bun.main === import.meta.path;
} else {
  try {
    invokedAsMain = process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    invokedAsMain = false;
  }
}
if (invokedAsMain) {
  void main();
}
