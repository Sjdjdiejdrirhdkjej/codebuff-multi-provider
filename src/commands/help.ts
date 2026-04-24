export const HELP_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "/help", description: "Show available slash commands (alias: /h, /?)" },
  { name: "/init", description: "Scaffold a project agent in .agents/" },
  { name: "/agents", description: "List available agents" },
  { name: "/skills", description: "List built-in skills" },
  { name: "/think", description: "Toggle the model's thinking panel" },
  { name: "/new", description: "Start a fresh chat (alias: /n, /clear, /c, /reset)" },
  { name: "/bash <cmd>", description: "Run a shell command (alias: /! <cmd>)" },
  { name: "/mode:normal", description: "Switch to NORMAL mode" },
  { name: "/mode:max", description: "Switch to MAX mode" },
  { name: "/mode:lite", description: "Switch to LITE mode" },
  { name: "/mode:plan", description: "Switch to PLAN mode" },
  { name: "/plan [prompt]", description: "Switch to PLAN mode (and optionally send a prompt)" },
  { name: "/review", description: "Ask the agent to review the recent changes" },
  { name: "/login", description: "Show login info (no-op in this build)" },
  { name: "/logout", description: "Show logout info (no-op in this build)" },
  { name: "/exit", description: "Exit the CLI (alias: /quit, /q)" },
];

export function renderHelp(): string {
  const width = Math.max(...HELP_COMMANDS.map((c) => c.name.length));
  return HELP_COMMANDS.map(
    (c) => `  ${c.name.padEnd(width)}  ${c.description}`,
  ).join("\n");
}
