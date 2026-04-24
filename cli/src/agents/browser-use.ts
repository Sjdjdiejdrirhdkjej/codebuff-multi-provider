import type { AgentDef } from "./types.js";

const browserUse: AgentDef = {
  id: "browser-use",
  displayName: "Browser Use Agent",
  model: "google/gemini-3.1-flash-lite-preview",
  spawnerPrompt: `Browser automation agent that uses Chrome DevTools to interact with web pages.

Use cases:
- Verify that code changes render correctly in the browser.
- Test web application functionality (click buttons, fill forms, check results).
- Navigate websites and extract information.
- Check for console errors, broken layouts, or missing elements.
- Validate responsive design and accessibility.

Requirements: Chrome must be installed. If Chrome is not available in this environment, this agent will report a failure — inform the user that browser automation requires a local Chrome/Chromium install.`,
  outputMode: "structured_output",
  toolNames: ["run_terminal_command", "set_output"],
  spawnableAgents: [],
  systemPrompt: `You are a browser automation agent. In the Codebuff CLI environment, you do not have a connected Chrome DevTools server. When asked to perform browser automation, run a terminal check (e.g. \`which google-chrome chromium chrome\`) to confirm whether Chrome is available; if not, set_output with overallStatus="failure" and a clear summary saying browser automation is unavailable in this environment. If it is available, you may use \`run_terminal_command\` to drive a headless browser via a CLI such as \`chrome --headless --dump-dom <url>\` and report what you observed.`,
  instructionsPrompt: `Inspect whether a usable Chrome/Chromium is available, then either perform the requested browser interaction (using headless command-line invocations) or report failure. Always finish with set_output following the structured output schema (overallStatus, summary, finalUrl, finalPageTitle, results, consoleErrors, lessons).`,
};

export default browserUse;
