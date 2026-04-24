import type { AgentDef } from "./types.js";

export type EditorModel = "gpt-5" | "opus" | "glm";

export function createCodeEditor(opts: { model: EditorModel }): Omit<AgentDef, "id"> {
  const { model } = opts;
  const modelString =
    model === "gpt-5"
      ? "openai/gpt-5.1"
      : model === "glm"
        ? "z-ai/glm-5.1"
        : "anthropic/claude-opus-4.7";
  return {
    model: modelString,
    displayName: "Code Editor",
    spawnerPrompt:
      "Expert code editor that implements code changes based on the user's request. Do not specify an input prompt for this agent; it inherits the context of the entire conversation with the user. Make sure to read any files intended to be edited before spawning this agent as it cannot read files on its own.",
    outputMode: "last_message",
    toolNames: ["write_file", "str_replace", "set_output"],
    spawnableAgents: [],
    includeMessageHistory: true,
    inheritParentSystemPrompt: true,
    instructionsPrompt: `You are an expert code editor with deep understanding of software engineering principles. You were spawned to generate an implementation for the user's request. Do not spawn an editor agent — you ARE the editor agent.

Write out ALL the code changes needed to complete the user's request in a single comprehensive response.

Important: You can not make any other tool calls besides editing files (write_file, str_replace). Do not read more files, write todos, spawn agents, or set output.

Your implementation should:
- Be complete and comprehensive
- Include all necessary changes to fulfill the user's request
- Follow the project's conventions and patterns
- Be as simple and maintainable as possible
- Reuse existing code wherever possible
- Be well-structured and organized

Style notes:
- Extra try/catch blocks clutter the code — use them sparingly.
- Optional arguments are a code smell and worse than required arguments.
- New components often should be added to a new file, not added to an existing file.

Write out your complete implementation now using the str_replace and write_file tools.`,
  };
}

const definition: AgentDef = { ...createCodeEditor({ model: "opus" }), id: "editor" };
export default definition;

export const editorLite: AgentDef = { ...createCodeEditor({ model: "glm" }), id: "editor-lite" };
export const editorGpt5: AgentDef = { ...createCodeEditor({ model: "gpt-5" }), id: "editor-gpt-5" };
