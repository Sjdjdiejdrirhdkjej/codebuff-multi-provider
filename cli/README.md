# Codebuff CLI

Interactive terminal-based AI coding assistant. Built with TypeScript, React, and
[OpenTUI](https://github.com/) on top of Bun.

## Quick start

```sh
bun install
bun run cli/src/index.tsx --help
bun run cli/src/index.tsx           # launches the TUI
bun run cli/src/index.tsx login     # auth (stub)
bun run cli/src/index.tsx --plan "refactor the auth module"
```

The packaged binary is `codebuff-tui` (see `bin/codebuff-tui`).

## Flags

| Flag | Meaning |
| --- | --- |
| `--agent <id>` | Run a specific agent (skips local overrides) |
| `--clear-logs` | Clear `~/.codebuff/logs/cli.log` before starting |
| `--continue [id]` | Resume a conversation (new id if omitted) |
| `--cwd <dir>` | Change working directory before init |
| `--lite` / `--free` | Start in LITE mode |
| `--max` | Start in MAX mode |
| `--plan` | Start in PLAN mode |
| `login` | Authenticate with the Codebuff backend |
| `publish [ids...]` | Publish one or more local agents |

In **freebuff** mode (`IS_FREEBUFF=true`) the binary is renamed `freebuff` and
only `--continue`, `--cwd`, and `login` are exposed.

## Slash commands inside the TUI

`/help`, `/init`, `/agents`, `/skills`, `/clear`, `/exit`.

## Layout

```
cli/
  bin/codebuff-tui            CLI shim
  src/
    index.tsx                 Entry: arg parsing, login/publish, app init
    app.tsx                   Root TUI (React + OpenTUI)
    chat.tsx                  Chat input
    commands/                 Slash + subcommand implementations
    init/                     `/init` scaffolder
    login/                    Login flow
    utils/
      auth.ts                 Token persistence
      env.ts                  getCliEnv(): loads .env files
      logger.ts               Pino logger + log rotation
      project-picker.ts       Project root detection
      local-agent-registry.ts Loads `.agents/` definitions
      skill-registry.ts       Built-in skill registry
    __tests__/                Unit, e2e, tmux integration
  scripts/
    prebuild-agents.ts        Validates `.agents/*.json`
    build-binary.ts           `bun build --compile` standalone binary
    release.ts                Tag + publish helper
```

## Notes on the AI backend

The real Codebuff CLI streams prompts to the Codebuff web API via
`@codebuff/sdk`. That backend (and the SDK package) is not available in this
environment, so `sendToBackend()` in `app.tsx` returns a clearly-labeled stub
response. Replace that single function with a call to your SDK / LLM provider
to make the assistant live.
