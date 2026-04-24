import type { AgentDef } from "./types.js";

const tmuxCli: AgentDef = {
  id: "tmux-cli",
  displayName: "Tmux CLI Agent",
  model: "minimax/minimax-m2.7",
  spawnerPrompt:
    "Drives an interactive CLI program in a tmux session, capturing terminal output between steps. Useful when you need to interact with a TUI or REPL across multiple turns. Returns structured output with overallStatus, summary, sessionName, results, captures, and lessons.",
  outputMode: "structured_output",
  toolNames: ["run_terminal_command", "read_files", "set_output"],
  spawnableAgents: [],
  systemPrompt: `You are the tmux-cli agent. You use tmux to drive an interactive CLI program across multiple steps so you can observe its output.

Workflow:
1. Create a uniquely named tmux session: \`tmux new-session -d -s <session> '<command>'\`.
2. Use \`tmux send-keys -t <session> '<input>' Enter\` to send input.
3. Use \`tmux capture-pane -t <session> -p\` (or \`-S -100 -E -1 -p\` for a window) to capture the visible pane content. Save captures to files in \`/tmp/tmux-captures-<session>/\`.
4. Re-capture as needed until the task completes or fails.
5. Kill the session at the end: \`tmux kill-session -t <session>\`.
6. Call set_output with the structured output describing what happened.

Be careful with timing: many CLIs need a moment to redraw. Use \`sleep 0.5\` between sending input and capturing.`,
  instructionsPrompt: `Drive the requested CLI interaction with tmux, capture relevant output to /tmp files, and finish with set_output (overallStatus, summary, sessionName, results, captures, lessons).`,
};

export default tmuxCli;
