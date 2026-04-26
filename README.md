# codebuff-tui

Interactive terminal AI coding assistant. Built with TypeScript, React, and
[OpenTUI](https://github.com/anomalyco/opentui), running on
[Bun](https://bun.sh). Routes prompts to **GLM-5.1** or **Claude Opus 4.7** via
codebuff.com's backend based on each model's strengths.

## Install

Requires **Bun ≥ 1.3** (OpenTUI uses Bun's FFI; this package will not run on
Node).

```sh
# Globally
bun add -g codebuff-tui

# Or per-project
bun add codebuff-tui
```

No API key required — the CLI calls codebuff.com's hosted backend by default.

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

| Trigger | Model | Why only that model |
|---|---|---|
| Image input or vision keywords | **Claude Opus 4.7** | Only model with native multimodal |
| Function/tool calling needed | **Claude Opus 4.7** | GLM-5.1 lacks function calling |
| Multi-agent / orchestration / autonomous research | **Claude Opus 4.7** | Built for swarm orchestration |
| Context > 180k chars | **Claude Opus 4.7** | 262k window vs GLM's 202k |
| Code / refactor / debug / plan / MAX / PLAN modes | **GLM-5.1** | Sustained multi-iteration coding |
| Default chat | **GLM-5.1** | Cheaper + faster on code-shaped chat |

Responses stream live token-by-token via the backend's SSE endpoint.

## Configuration

```sh
CODEBUFF_API_URL=https://orbitron--pastelsjuice8t.replit.app  # default
FIREWORKS_MODEL_GLM=z-ai/glm-5.1                              # default
FIREWORKS_MODEL_KIMI=anthropic/claude-opus-4.7                # default
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
