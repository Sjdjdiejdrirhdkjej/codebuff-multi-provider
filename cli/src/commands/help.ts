export const HELP_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "/help", description: "Show available slash commands" },
  { name: "/init", description: "Scaffold a project agent in .agents/" },
  { name: "/agents", description: "List available agents" },
  { name: "/skills", description: "List built-in skills" },
  { name: "/clear", description: "Clear the chat transcript" },
  { name: "/exit", description: "Exit the CLI" },
];

export function renderHelp(): string {
  const width = Math.max(...HELP_COMMANDS.map((c) => c.name.length));
  return HELP_COMMANDS.map(
    (c) => `  ${c.name.padEnd(width)}  ${c.description}`,
  ).join("\n");
}
