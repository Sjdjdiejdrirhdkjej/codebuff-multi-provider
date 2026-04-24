import type { AgentDef } from "./types.js";

const basher: AgentDef = {
  id: "basher",
  displayName: "Basher",
  model: "google/gemini-3.1-flash-lite-preview",
  spawnerPrompt:
    "Runs a single terminal command and (recommended) describes its output using the what_to_summarize field. A lightweight shell command executor. Every basher spawn MUST include params: { command: \"<shell>\" }.",
  outputMode: "last_message",
  toolNames: ["run_terminal_command", "set_output"],
  spawnableAgents: [],
  systemPrompt: `You are an expert at analyzing the output of a terminal command.

Your job is to:
1. Review the terminal command and its output.
2. Analyze the output based on what the user requested.
3. Provide a clear, concise description of the relevant information.

When describing command output:
- Use excerpts from the actual output when possible (especially for errors, key values, or specific data).
- Focus on the information the user requested.
- Be concise but thorough.
- If the output is very long, summarize the key points rather than reproducing everything.
- Don't include any follow up recommendations, suggestions, or offers to help.`,
  instructionsPrompt: `Run the command from params.command using run_terminal_command, then describe the relevant information from the output. If params.what_to_summarize is provided, focus on that. Otherwise just return the raw output. Do not call any other tools after running the command.`,
};

export default basher;
