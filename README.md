# codebuff-tui

Interactive terminal AI coding assistant. Built with TypeScript, React, and
[OpenTUI](https://github.com/anomalyco/opentui), running on
[Bun](https://bun.sh). Calls **Claude Opus 4.7** — the same model
[codebuff.com's CLI uses in Default mode](https://www.codebuff.com/docs/tips/modes) —
via the Orbitron gateway.

## Install

Requires **Bun ≥ 1.3** (OpenTUI uses Bun's FFI; this package will not run on
Node).

```sh
# Globally
bun add -g codebuff-tui

# Or per-project
bun add codebuff-tui
```

Get an Orbitron API key at [orbitron's keys page](https://orbitron--pastelsjuice8t.replit.app/keys) and export it:

```sh
export ORBITRON_API_KEY=sk-sb-v1-…
```

## Run

```sh
codebuff-tui                           # launch the interactive TUI
codebuff-tui "fix the bug in api.ts"   # launch with an initial prompt
codebuff-tui --plan                    # start in PLAN mode
codebuff-tui login                     # authenticate (writes ~/.codebuff/auth.json)
codebuff-tui publish my-agent          # publish a local .agents/ definition
```

## Flags

| Flag | Meaning |
| --- | --- |
| `--agent <id>` | Run a specific agent (skips local overrides) |
| `--clear-logs` | Clear `~/.codebuff/logs/cli.log` before starting |
| `--continue [id]` | Resume a conversation (new id if omitted) |
| `--cwd <dir>` | Change working directory before init |
| `--lite` / `--free` | LITE mode (smaller responses) |
| `--max` | MAX mode (longer responses, higher temperature) |
| `--plan` | PLAN mode (low-temperature planning) |

In **freebuff** mode (`IS_FREEBUFF=true`) the binary is renamed `freebuff` and
only `--continue`, `--cwd`, and `login` are exposed.

## Slash commands inside the TUI

`/help`, `/init`, `/agents`, `/skills`, `/clear`, `/exit`.

## Model routing

The router maps each prompt to whichever model's **strengths** apply.

| Trigger | Model | Why |
|---|---|---|
| Any prompt | **Claude Opus 4.7** | Codebuff's Default-mode model — strong agentic coding, vision, and tools |

Responses stream live token-by-token via the backend's SSE endpoint.

## Configuration

```sh
CODEBUFF_API_URL=https://orbitron--pastelsjuice8t.replit.app  # default
ORBITRON_API_KEY=sk-sb-v1-...                                 # required
FIREWORKS_MODEL_GLM=claude-opus-4.7                           # default
FIREWORKS_MODEL_KIMI=claude-opus-4.7                          # default
LOG_LEVEL=info
```

`.env`, `.env.local`, and `.env.development.local` in the working directory are
auto-loaded. Auth tokens are persisted to `$HOME/.codebuff/auth.json`.

## Layout

```
codebuff-tui/
  bin/codebuff-tui.js          npm-installed entry point (Bun shebang)
  dist/index.js                bundled source (built on prepublish)
  src/
    index.tsx                  Entry: arg parsing, login/publish, app init
    app.tsx                    Root TUI (React + OpenTUI), streaming
    chat.tsx                   Chat input
    commands/                  Slash + subcommand implementations
    init/                      `/init` scaffolder
    login/                     Login flow
    utils/
      auth.ts                  Token persistence
      env.ts                   getCliEnv()
      logger.ts                Pino logger
      project-picker.ts        Project root detection
      local-agent-registry.ts  Loads `.agents/`
      skill-registry.ts        Built-in skills
      fireworks.ts             Fireworks chat + SSE streaming client
      router.ts                Strength-based model router
    __tests__/                 Unit, e2e, tmux integration, router
  scripts/
    build.ts                   Bundle src/ -> dist/ (used by prepublishOnly)
    build-binary.ts            `bun build --compile` standalone executable
    prebuild-agents.ts         Validates `.agents/*.json`
    release.ts                 Tag + publish helper
```

## Development

```sh
bun install
bun run dev          # run from source with --hot agents
bun test             # 24 unit / e2e / router tests
bun run build        # produce dist/index.js for npm
bun run build:binary # produce a standalone single-file executable
```
