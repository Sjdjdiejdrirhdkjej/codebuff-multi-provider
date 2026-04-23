# Codebuff CLI

Interactive terminal-based AI coding assistant scaffold built per the
attached spec. TypeScript + React + OpenTUI on Bun.

## Layout
See `cli/README.md` for the full file map. Highlights:
- `cli/src/index.tsx` — Commander arg parsing, login/publish, app init, TUI render
- `cli/src/app.tsx`, `cli/src/chat.tsx` — React TUI components (OpenTUI)
- `cli/src/utils/{env,logger,auth,project-picker,local-agent-registry,skill-registry}.ts`
- `cli/src/login`, `cli/src/init`, `cli/src/commands/{help,publish}.ts`
- `cli/scripts/{prebuild-agents,build-binary,release}.ts`
- `cli/src/__tests__/` — unit, e2e, tmux integration

## Run
- `cd cli && bun install`
- `bun src/index.tsx --help`
- `bun src/index.tsx` (launches TUI; needs a real TTY)
- `bun test`

## Workflow
`Codebuff CLI` runs `--help`, then tails `~/.codebuff/logs/cli.log`.
The TUI itself must be run from a real terminal (it needs a TTY for raw-mode input).

## AI backend
The real Codebuff backend / `@codebuff/sdk` is not available here.
`sendToBackend()` in `cli/src/app.tsx` is a clearly-marked stub —
swap it for an SDK / LLM call to make the assistant live.
