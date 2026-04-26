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

Calls the **Orbitron** gateway at `https://orbitron--pastelsjuice8t.replit.app/api/chat`.

- Auth: `Bearer ${ORBITRON_API_KEY}` (key format `sk-sb-v1-…`, stored as Replit secret).
- Wire format: `POST { modelId, messages }`; response is always a custom SSE
  stream of `data: {"delta":"…"}` events terminated by `data: {"done":true,…}`.
  The client (`src/utils/fireworks.ts`) translates this to/from the OpenAI-shaped
  interface the rest of the codebase expects.
- Model: **`claude-opus-4.7`** — the same model
  [codebuff.com's CLI uses in Default mode](https://www.codebuff.com/docs/tips/modes).
  Both router buckets (`MODEL_GLM_5_1`, `MODEL_KIMI_K2_6`) resolve to it.
- Tool/function calling and JSON mode are not supported by the gateway and are
  stripped from outbound requests.
