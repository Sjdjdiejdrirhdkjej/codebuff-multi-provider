# Tests

Three categories, all run via `bun test` from the `cli/` directory:

- **Unit** — `cli-args.test.ts` exercises argument parsing in isolation.
- **End-to-end** — `e2e-cli.test.ts` spawns the CLI as a subprocess and asserts on
  `--help`, `--version`, and the `login` subcommand.
- **Integration (tmux)** — `integration-tmux.test.ts` requires `tmux` on PATH and
  is automatically skipped otherwise. Install:
  - macOS: `brew install tmux`
  - Linux: `apt-get install tmux` / `dnf install tmux`
  - Windows: install inside WSL (`apt-get install tmux`)

Run a single suite:

```sh
bun test src/__tests__/cli-args.test.ts
```
