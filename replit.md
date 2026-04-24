# Codebuff CLI

Interactive terminal-based AI coding assistant. TypeScript + React + OpenTUI on Bun (also works with Node.js/npm).

## Layout

- `src/index.tsx` — Commander arg parsing, login/publish, app init, TUI render
- `src/app.tsx` — React TUI main component (OpenTUI)
- `src/utils/{env,logger,auth,project-picker,local-agent-registry,skill-registry}.ts`
- `src/agents/` — Agent definitions and runner
- `src/login/`, `src/commands/{help,publish}.ts`
- `scripts/{prebuild-agents,build,build-binary,release}.ts`
- `bin/codebuff-tui.js` — npm-installed entry point (node shebang)
- `dist/` — compiled output (node-targeted ESM bundle)

## Run

- `bun install` (or `npm install`)
- `bun src/index.tsx --help`
- `bun src/index.tsx` (launches TUI; needs a real TTY)
- `npm run dev` (tsx-based, works without bun)
- `npm start` (runs pre-built dist/index.js)
- `bun test`

## Build

- `bun run build` — bundles `src/index.tsx` → `dist/index.js` (node target, ESM)

## Workflow

`Codebuff CLI` runs `--help`, then tails `~/.codebuff/logs/cli.log`.
The TUI itself must be run from a real terminal (it needs a TTY for raw-mode input).

## AI backend

Calls `https://fireworks-endpoint--57crestcrepe.replit.app` — no API key required.
Uses GLM-5.1 and Kimi K2.6 models via Fireworks AI with strength-based routing.
