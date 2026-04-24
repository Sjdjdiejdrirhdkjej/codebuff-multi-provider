import type { AgentDef } from "./types.js";

function createFilePicker(mode: "default" | "max"): Omit<AgentDef, "id"> {
  const isMax = mode === "max";
  return {
    displayName: "Fletcher the File Fetcher",
    model: isMax ? "google/gemini-3.1-flash-lite-preview" : "google/gemini-2.5-flash-lite",
    spawnerPrompt: `Spawn to find relevant files in a codebase related to the prompt. Outputs up to ${isMax ? 20 : 12} file paths with short summaries. Cannot do string searches but does a fuzzy search. Unless you know which directories are relevant, omit the directories parameter.`,
    outputMode: "last_message",
    toolNames: ["list_directory", "glob", "code_search", "read_files", "set_output"],
    spawnableAgents: [],
    systemPrompt: `You are an expert at finding relevant files in a codebase.`,
    instructionsPrompt: `Find and report up to ${isMax ? 20 : 12} files most relevant to the user prompt. Use list_directory, glob, and code_search to discover them. Then read a few of the most promising ones with read_files to confirm relevance. Provide a very concise report with the full paths of relevant files (one per line) and a one-line note for each on why it's relevant. Do not perform any edits.`,
  };
}

const filePicker: AgentDef = { ...createFilePicker("default"), id: "file-picker" };
export default filePicker;

export const filePickerMax: AgentDef = { ...createFilePicker("max"), id: "file-picker-max" };

function createFileLister(max: boolean): Omit<AgentDef, "id"> {
  const limit = max ? 20 : 12;
  return {
    displayName: "Liszt the File Lister",
    model: "google/gemini-3.1-flash-lite-preview",
    spawnerPrompt: `Lists up to ${limit} files relevant to the prompt within the given directories. Unless you know which directories are relevant, omit the directories parameter.`,
    outputMode: "last_message",
    toolNames: ["list_directory", "glob", "read_files", "set_output"],
    spawnableAgents: [],
    systemPrompt: `You are an expert at finding relevant files in a codebase and listing them out.`,
    instructionsPrompt: `Instructions:
- List out the full paths of ${limit} files relevant to the prompt, separated by newlines. Each file path is relative to the project root. Don't forget to include all the subdirectories.
- Do not write any introductory commentary.
- Do not write any analysis or any English text at all.
- Use list_directory and glob tools to discover files first.

After exploring, output ONLY the list of file paths, one per line. Nothing else.`,
  };
}

export const fileLister: AgentDef = { ...createFileLister(false), id: "file-lister" };
export const fileListerMax: AgentDef = { ...createFileLister(true), id: "file-lister-max" };

export const codeSearcher: AgentDef = {
  id: "code-searcher",
  displayName: "Code Searcher",
  spawnerPrompt:
    "Mechanically runs multiple code search queries (using ripgrep-style line-oriented search) and returns up to 250 results across all source files, showing each line that matches the search pattern. Excludes git-ignored files. You MUST pass searchQueries in params.",
  model: "anthropic/claude-sonnet-4.5",
  toolNames: ["code_search", "set_output"],
  spawnableAgents: [],
  outputMode: "structured_output",
  systemPrompt: `You are a code search agent. Given one or more search queries, run them with the code_search tool and return the combined results as a concise list of "path:line: matched-text" entries.`,
  instructionsPrompt: `Run the requested search queries one by one using code_search, then return ALL hits as a deduplicated list. Do not analyze the results — just return them.`,
};

export const directoryLister: AgentDef = {
  id: "directory-lister",
  displayName: "Directory Lister",
  spawnerPrompt: "Mechanically lists multiple directories and returns their contents.",
  model: "anthropic/claude-sonnet-4.5",
  toolNames: ["list_directory", "set_output"],
  spawnableAgents: [],
  outputMode: "structured_output",
  systemPrompt: `You are a directory lister agent. Given one or more directory paths, list each one with the list_directory tool and return the combined results.`,
  instructionsPrompt: `Call list_directory once per requested directory and return the combined output. Do not analyze — just list.`,
};

export const globMatcher: AgentDef = {
  id: "glob-matcher",
  displayName: "Glob Matcher",
  spawnerPrompt: "Mechanically runs multiple glob pattern matches and returns all matching files.",
  model: "anthropic/claude-sonnet-4.5",
  toolNames: ["glob", "set_output"],
  spawnableAgents: [],
  outputMode: "structured_output",
  systemPrompt: `You are a glob matcher agent. Given one or more glob patterns, run each with the glob tool and return the combined matching paths.`,
  instructionsPrompt: `Call glob once per requested pattern and return the combined deduplicated list of matched paths.`,
};
