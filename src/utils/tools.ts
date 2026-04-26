import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { buildCodeIndex, formatCompactTree, indexStats } from "./code-index.js";
import {
  callFireworks,
  EXA_ANSWER_URL,
  EXA_CONTENTS_URL,
  EXA_SEARCH_URL,
  type ChatMessage,
} from "./fireworks.js";
import { MODEL_GLM_5_1, MODEL_KIMI_K2_6 } from "./router.js";

export const VISIBLE_TOOLS = new Set<string>([
  "write_file",
  "str_replace",
  "run_terminal_command",
  "spawn_agents",
]);

export const END_TURN_TOOL = "end_turn";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_files",
      description:
        "Read one or more UTF-8 text files from the project. Returns the contents of each, separated by file headers. Each file is truncated at 8000 characters.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Project-relative or absolute paths to files inside the project.",
          },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_subtree",
      description:
        "Read every text file in a subtree of the project. Returns up to 60 files concatenated, each truncated at 4000 characters. Useful for getting an overview of a small package or directory.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Directory paths to recursively read. Defaults to project root if empty.",
          },
          maxTokens: {
            type: "number",
            description: "Approximate max chars to return (default 200000).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List entries (files and directories) in a project directory. Directories are suffixed with '/'.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative or absolute directory path. Defaults to the project root.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Find files in the project matching a glob pattern (e.g. 'src/**/*.ts'). Returns up to 200 matching paths, sorted.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern. Supports '*', '**', and '?'. Matched against project-relative paths.",
          },
          cwd: {
            type: "string",
            description: "Optional directory to search in (project-relative or absolute). Defaults to the project root.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_search",
      description:
        "Search the project's text files for a regular expression. Returns up to 100 matching lines as 'path:line: text'.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript regular expression source." },
          cwd: {
            type: "string",
            description: "Optional directory to restrict the search to (project-relative or absolute). Defaults to the project root.",
          },
          flags: {
            type: "string",
            description: "Optional regex flags (e.g. 'i' for case-insensitive). 'g' is always added.",
          },
          maxResults: {
            type: "number",
            description: "Maximum total results to return (default 100, hard cap 250).",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing one with the given UTF-8 content. Creates parent directories as needed. Prefer str_replace for targeted edits to existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative or absolute path to the file to write." },
          content: { type: "string", description: "Full UTF-8 content for the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "str_replace",
      description:
        "Edit an existing UTF-8 file by replacing exact occurrences of `old_string` with `new_string`. By default `old_string` must match exactly once; set `replace_all` to true to replace every occurrence.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative or absolute path to the file." },
          old_string: { type: "string", description: "Exact text to find." },
          new_string: { type: "string", description: "Replacement text." },
          replace_all: { type: "boolean", description: "Replace all occurrences (default: false)." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_terminal_command",
      description:
        "Run a shell command in the project root and return its combined stdout/stderr. Times out after 60 seconds by default. Be careful with destructive commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
          timeout_seconds: { type: "number", description: "Override timeout in seconds. -1 disables." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "think_deeply",
      description:
        "Internal scratchpad for moderately complex reasoning (planning, edge cases, refactor strategy). The thought is recorded but not shown to the user.",
      parameters: {
        type: "object",
        properties: { thought: { type: "string", description: "Your private reasoning." } },
        required: ["thought"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_agents",
      description:
        "PRIMARY TOOL: Spawn one or more specialized sub-agents in parallel to do work for you. This is the main way an orchestrator agent gets things done — strongly prefer it over doing work inline. Each entry in the agents array runs its own LLM loop in parallel with its restricted tool set and returns a result. Always batch independent work into a single spawn_agents call (e.g. 3 file-pickers + 2 code-searchers + 1 web-researcher in one call) instead of multiple sequential calls. Typical uses: context gathering (file-picker, code-searcher, researcher-web, researcher-docs), editing (editor / editor-gpt-5), review (code-reviewer / code-reviewer-lite), validation (basher for typecheck and tests in parallel), deep thinking (thinker). When in doubt, spawn.",
      parameters: {
        type: "object",
        properties: {
          agents: {
            type: "array",
            description: "List of agents to spawn in parallel.",
            items: {
              type: "object",
              properties: {
                agent_type: { type: "string", description: "The agent id (e.g. 'file-picker', 'code-reviewer')." },
                prompt: { type: "string", description: "The prompt to give the spawned agent. Optional for some agents." },
                params: { type: "object", description: "Optional structured parameters passed to the agent." },
              },
              required: ["agent_type"],
            },
          },
        },
        required: ["agents"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_agent_inline",
      description:
        "Spawn a single sub-agent inline (synchronously) and return its result. Same semantics as spawn_agents with one entry.",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
          params: { type: "object" },
        },
        required: ["agent_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_relevant_files",
      description:
        "FAST CODEBASE DISCOVERY. Builds (or refreshes) a structural index of the project — all source files plus the functions, classes, and types they declare — then asks a fast model to pick up to N files most relevant to the query, and a second model to summarize each pick in one sentence. Returns a ranked list of {path, summary, symbols}. Use this BEFORE read_files or code_search whenever you need to figure out which parts of an unfamiliar codebase matter for a request. Much cheaper and faster than greppng around blindly.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural-language description of what you're trying to find or change (e.g. 'where is auth handled', 'files that talk to the Fireworks API').",
          },
          max_files: {
            type: "integer",
            description: "Maximum number of files to return. Default 12, max 20.",
          },
          summarize: {
            type: "boolean",
            description:
              "If true (default), each picked file is also summarized in one sentence. Set false for an even faster pick-only response.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_output",
      description:
        "Used by sub-agents to record their final structured output for the parent agent. Pass the structured object that matches the agent's outputSchema, or { message: '...' } / { output: '...' } for free-form text.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_message",
      description:
        "Append an additional message to the current sub-agent's working conversation (used internally by orchestrating handlers). Pass { role, content }.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["user", "assistant", "system"] },
          content: { type: "string" },
        },
        required: ["role", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for the given query and return up to ~8 result snippets. May be unavailable in this environment; if so it returns a clear error message.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          depth: { type: "string", enum: ["standard", "deep"] },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_docs",
      description:
        "Look up technical documentation for a major public library or framework. May be unavailable; if so returns a clear error message.",
      parameters: {
        type: "object",
        properties: {
          library: { type: "string", description: "Library or framework name (e.g. 'react', 'postgres')." },
          query: { type: "string", description: "What to look up about the library." },
        },
        required: ["library", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user a clarifying question and pause for their reply. In this CLI the question is shown to the user and the agent should call end_turn afterward so the user can respond on the next turn.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_todos",
      description:
        "Record a TODO checklist for tracking multi-step work. The list is shown to the user and remembered for this session.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_followups",
      description: "Suggest 1-3 short follow-up actions the user might want next.",
      parameters: {
        type: "object",
        properties: {
          followups: { type: "array", items: { type: "string" } },
        },
        required: ["followups"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_str_replace",
      description: "Propose a str_replace edit for the user to review before applying. Same args as str_replace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_write_file",
      description: "Propose a write_file edit for the user to review before applying. Same args as write_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill",
      description:
        "Invoke a named project skill from the local skill registry. Pass { name, args }. Returns the skill's output or an error if not found.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          args: { type: "object" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_turn",
      description:
        "Signal that you are done with the user's current request and have nothing more to do. Call this after you have completed the task and written your final summary.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function safeJoin(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`path escapes project: ${p}`);
  }
  return abs;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  "coverage",
]);

function walk(root: string, dir: string, out: string[], cap: number): void {
  if (out.length >= cap) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= cap) return;
    if (IGNORED_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(root, full, out, cap);
    } else if (s.isFile()) {
      out.push(relative(root, full));
    }
  }
}

function globToRegex(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (".+^$()|{}[]\\".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += "$";
  return new RegExp(re);
}

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".txt", ".yml", ".yaml", ".toml",
  ".css", ".scss", ".html", ".sh", ".py", ".rs",
  ".go", ".java", ".rb", ".php", ".c", ".h", ".cpp",
  ".hpp", ".sql", ".env",
]);

function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTS.has(path.slice(dot).toLowerCase());
}

export interface ExecuteToolContext {
  parentMessages?: ChatMessage[];
  parentSystemPrompt?: string;
  depth?: number;
  /** Optional live-streaming callback threaded to sub-agents and inline agents. */
  onToken?: (chunk: string) => void;
}

export async function executeTool(
  name: string,
  rawArgs: string,
  projectRoot: string,
  ctx: ExecuteToolContext = {},
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return `error: invalid arguments JSON: ${rawArgs}`;
  }
  try {
    if (name === "read_files") {
      const raw = args.paths;
      const paths = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
      if (paths.length === 0) return "error: paths is required";
      const parts: string[] = [];
      for (const p of paths) {
        try {
          const abs = safeJoin(projectRoot, p);
          const txt = readFileSync(abs, "utf8");
          const body = txt.length > 8000 ? txt.slice(0, 8000) + "\n…[truncated]" : txt;
          parts.push(`===== ${p} =====\n${body}`);
        } catch (err) {
          parts.push(`===== ${p} =====\nerror: ${(err as Error).message}`);
        }
      }
      return parts.join("\n\n");
    }
    if (name === "read_subtree") {
      const rawPaths = args.paths;
      const paths = Array.isArray(rawPaths) && rawPaths.length > 0 ? rawPaths.map(String) : ["."];
      const cap = Math.min(Number(args.maxTokens) || 200_000, 400_000);
      const parts: string[] = [];
      let total = 0;
      let count = 0;
      outer: for (const dirPath of paths) {
        const base = safeJoin(projectRoot, dirPath);
        const files: string[] = [];
        walk(projectRoot, base, files, 1000);
        for (const f of files) {
          if (!isTextFile(f)) continue;
          if (count >= 60 || total >= cap) break outer;
          try {
            const txt = readFileSync(join(projectRoot, f), "utf8");
            const body = txt.length > 4000 ? txt.slice(0, 4000) + "\n…[truncated]" : txt;
            parts.push(`===== ${f} =====\n${body}`);
            total += body.length;
            count += 1;
          } catch {
            /* skip */
          }
        }
      }
      return parts.length ? parts.join("\n\n") : "(no files)";
    }
    if (name === "list_directory") {
      const p = safeJoin(projectRoot, String(args.path ?? "."));
      const items = readdirSync(p).map((n) => {
        try {
          return statSync(join(p, n)).isDirectory() ? `${n}/` : n;
        } catch {
          return n;
        }
      });
      return items.sort().join("\n") || "(empty)";
    }
    if (name === "glob") {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return "error: pattern is required";
      const base = safeJoin(projectRoot, String(args.cwd ?? args.path ?? "."));
      const re = globToRegex(pattern);
      const all: string[] = [];
      walk(projectRoot, base, all, 5000);
      const baseRel = relative(projectRoot, base);
      const matches = all
        .filter((p) => {
          const rel = baseRel ? relative(baseRel, p) : p;
          return re.test(rel) || re.test(p);
        })
        .sort()
        .slice(0, 200);
      return matches.length ? matches.join("\n") : "(no matches)";
    }
    if (name === "code_search") {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return "error: pattern is required";
      const flags = String(args.flags ?? "");
      const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      const base = safeJoin(projectRoot, String(args.cwd ?? args.path ?? "."));
      const cap = Math.min(Number(args.maxResults) || 100, 250);
      const files: string[] = [];
      walk(projectRoot, base, files, 5000);
      const hits: string[] = [];
      outer: for (const f of files) {
        if (!isTextFile(f)) continue;
        let body: string;
        try {
          body = readFileSync(join(projectRoot, f), "utf8");
        } catch {
          continue;
        }
        const lines = body.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push(`${f}:${i + 1}: ${lines[i].slice(0, 240)}`);
            if (hits.length >= cap) break outer;
          }
          re.lastIndex = 0;
        }
      }
      return hits.length ? hits.join("\n") : "(no matches)";
    }
    if (name === "write_file") {
      const p = safeJoin(projectRoot, String(args.path ?? ""));
      const content = String(args.content ?? "");
      const existed = existsSync(p);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
      const rel = relative(projectRoot, p) || p;
      return `${existed ? "wrote" : "created"} ${rel} (${content.length} bytes)`;
    }
    if (name === "str_replace") {
      const p = safeJoin(projectRoot, String(args.path ?? ""));
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      const replaceAll = Boolean(args.replace_all);
      if (!oldStr) return "error: old_string is required and must be non-empty";
      const original = readFileSync(p, "utf8");
      let updated: string;
      let count: number;
      if (replaceAll) {
        const split = original.split(oldStr);
        count = split.length - 1;
        updated = split.join(newStr);
      } else {
        const first = original.indexOf(oldStr);
        if (first === -1) return `error: old_string not found in ${args.path}`;
        if (original.indexOf(oldStr, first + oldStr.length) !== -1) {
          return `error: old_string is not unique in ${args.path}; pass replace_all=true or add more context`;
        }
        count = 1;
        updated = original.slice(0, first) + newStr + original.slice(first + oldStr.length);
      }
      if (count === 0) return `error: old_string not found in ${args.path}`;
      writeFileSync(p, updated, "utf8");
      const rel = relative(projectRoot, p) || p;
      return `edited ${rel} (${count} replacement${count === 1 ? "" : "s"})`;
    }
    if (name === "run_terminal_command") {
      const command = String(args.command ?? "");
      if (!command) return "error: command is required";
      const t = Number(args.timeout_seconds);
      const timeout = t === -1 ? 0 : t > 0 ? t * 1000 : 60_000;
      try {
        const out = execSync(command, {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout,
          maxBuffer: 1024 * 1024,
        });
        return out.length > 8000 ? out.slice(0, 8000) + "\n…[truncated]" : out || "(no output)";
      } catch (err) {
        const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number; message: string };
        const stdout = e.stdout?.toString() ?? "";
        const stderr = e.stderr?.toString() ?? "";
        const combined = `${stdout}${stderr}`.trim() || e.message;
        const status = e.status ?? "?";
        const body = combined.length > 8000 ? combined.slice(0, 8000) + "\n…[truncated]" : combined;
        return `exit ${status}\n${body}`;
      }
    }
    if (name === "think_deeply") return "(noted)";
    if (name === "set_output") return JSON.stringify(args);
    if (name === "add_message") {
      // Best-effort: append into the parent's message array if available.
      if (ctx.parentMessages && args.role && args.content) {
        ctx.parentMessages.push({
          role: args.role as ChatMessage["role"],
          content: String(args.content),
        });
      }
      return "(message appended)";
    }
    if (name === "web_search") {
      const query = String(args.query ?? "").trim();
      const depth = String(args.depth ?? "standard");
      if (!query) return `error: web_search requires a non-empty 'query' argument`;
      const numResults = depth === "deep" ? 10 : 6;
      try {
        const res = await fetch(EXA_SEARCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            numResults,
            type: depth === "deep" ? "neural" : "auto",
            contents: { text: { maxCharacters: 1200 } },
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          return `error: web_search HTTP ${res.status}: ${text.slice(0, 300)}`;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          return `error: web_search returned non-JSON: ${text.slice(0, 300)}`;
        }
        const results: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
        if (results.length === 0) return `No results for "${query}".`;
        const lines: string[] = [`Search results for "${query}" (${results.length}):`, ""];
        results.forEach((r, i) => {
          const title = String(r.title ?? r.id ?? "(untitled)").trim();
          const url = String(r.url ?? r.id ?? "").trim();
          const snippet = String(r.text ?? r.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
          const date = r.publishedDate ? ` (${String(r.publishedDate).slice(0, 10)})` : "";
          lines.push(`${i + 1}. ${title}${date}`);
          if (url) lines.push(`   ${url}`);
          if (snippet) lines.push(`   ${snippet}`);
          lines.push("");
        });
        return lines.join("\n").trim();
      } catch (err) {
        return `error: web_search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (name === "read_docs") {
      const library = String(args.library ?? "").trim();
      const query = String(args.query ?? "").trim();
      if (!library || !query)
        return `error: read_docs requires both 'library' and 'query' arguments`;
      const fullQuery = `${library} documentation: ${query}`;
      try {
        const ansRes = await fetch(EXA_ANSWER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: fullQuery, text: true }),
        });
        const ansText = await ansRes.text();
        if (!ansRes.ok) {
          return `error: read_docs HTTP ${ansRes.status}: ${ansText.slice(0, 300)}`;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(ansText);
        } catch {
          return `error: read_docs returned non-JSON: ${ansText.slice(0, 300)}`;
        }
        const answer = String(parsed?.answer ?? "").trim();
        const citations: any[] = Array.isArray(parsed?.citations) ? parsed.citations : [];
        const out: string[] = [`# ${library} — ${query}`, ""];
        if (answer) out.push(answer, "");
        if (citations.length > 0) {
          out.push("## Sources");
          citations.slice(0, 8).forEach((c, i) => {
            const title = String(c.title ?? c.id ?? "(source)").trim();
            const url = String(c.url ?? c.id ?? "").trim();
            out.push(`${i + 1}. ${title}${url ? ` — ${url}` : ""}`);
          });
        }
        const result = out.join("\n").trim();
        return result || `No documentation answer found for ${library}: ${query}`;
      } catch (err) {
        return `error: read_docs failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (name === "fetch_url_contents") {
      const url = String(args.url ?? "").trim();
      if (!url) return `error: fetch_url_contents requires a 'url' argument`;
      try {
        const res = await fetch(EXA_CONTENTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: [url], text: { maxCharacters: 8000 } }),
        });
        const text = await res.text();
        if (!res.ok) return `error: fetch_url_contents HTTP ${res.status}: ${text.slice(0, 300)}`;
        return text;
      } catch (err) {
        return `error: fetch_url_contents failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (name === "ask_user") {
      const q = String(args.question ?? "(no question)");
      return `[asked user] ${q}\n(Now call end_turn so the user can answer on the next turn.)`;
    }
    if (name === "write_todos") {
      const todos = Array.isArray(args.todos) ? args.todos.map(String) : [];
      return `recorded ${todos.length} todo(s):\n${todos.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}`;
    }
    if (name === "suggest_followups") {
      const fs = Array.isArray(args.followups) ? args.followups.map(String) : [];
      return `followups: ${fs.join(" | ")}`;
    }
    if (name === "propose_str_replace") {
      // For now, treat as direct str_replace.
      return await executeTool(
        "str_replace",
        JSON.stringify(args),
        projectRoot,
        ctx,
      );
    }
    if (name === "propose_write_file") {
      return await executeTool(
        "write_file",
        JSON.stringify(args),
        projectRoot,
        ctx,
      );
    }
    if (name === "skill") {
      return `error: the named-skill runtime is not implemented in this build. Use the underlying tools directly.`;
    }
    if (name === "spawn_agents") {
      const list = Array.isArray(args.agents) ? args.agents : [];
      if (list.length === 0) return "error: agents array is required and non-empty";
      const { runAgent } = await import("../agents/runner.js");
      const results = await Promise.all(
        list.map(async (a) => {
          const spec = a as { agent_type?: string; prompt?: string; params?: Record<string, unknown> };
          if (!spec.agent_type) return { agent_type: "?", error: "missing agent_type" };
          // Emit a labeled header so the user knows which agent is streaming.
          ctx.onToken?.(`\n[${spec.agent_type}] `);
          try {
            const out = await runAgent({
              agentId: spec.agent_type,
              prompt: spec.prompt,
              params: spec.params,
              projectRoot,
              parentMessages: ctx.parentMessages,
              parentSystemPrompt: ctx.parentSystemPrompt,
              depth: ctx.depth ?? 0,
              onToken: (chunk) => ctx.onToken?.(chunk),
            });
            ctx.onToken?.(`\n`);
            return { agent_type: spec.agent_type, output: out };
          } catch (err) {
            ctx.onToken?.(`\n`);
            return { agent_type: spec.agent_type, error: (err as Error).message };
          }
        }),
      );
      return JSON.stringify(results, null, 2);
    }
    if (name === "spawn_agent_inline") {
      const spec = args as { agent_type?: string; prompt?: string; params?: Record<string, unknown> };
      if (!spec.agent_type) return "error: agent_type is required";
      const { runAgent } = await import("../agents/runner.js");
      ctx.onToken?.(`\n[${spec.agent_type}] `);
      try {
        const out = await runAgent({
          agentId: spec.agent_type,
          prompt: spec.prompt,
          params: spec.params,
          projectRoot,
          parentMessages: ctx.parentMessages,
          parentSystemPrompt: ctx.parentSystemPrompt,
          depth: ctx.depth ?? 0,
          onToken: (chunk) => ctx.onToken?.(chunk),
        });
        ctx.onToken?.(`\n`);
        return out;
      } catch (err) {
        ctx.onToken?.(`\n`);
        return `error: ${(err as Error).message}`;
      }
    }
    if (name === "find_relevant_files") {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query.trim()) return "error: query is required";
      const maxFiles = Math.min(Math.max(Number(args.max_files) || 12, 1), 20);
      const summarize = args.summarize !== false;
      return await findRelevantFiles(projectRoot, query, maxFiles, summarize);
    }
    if (name === END_TURN_TOOL) return "(turn ended)";
    return `error: unknown tool ${name}`;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// find_relevant_files implementation
// ─────────────────────────────────────────────────────────────────────────────

interface PickedFile {
  path: string;
  reason?: string;
}

async function pickFilesWithLLM(
  query: string,
  tree: string,
  maxFiles: number,
): Promise<PickedFile[]> {
  const system =
    "You are a code-search assistant. Given a user query and a compact tree of a project (each file annotated with its top-level functions, classes, and types), pick the files most likely to be relevant to the query. Return ONLY a JSON object of the form {\"files\":[{\"path\":\"<relative-path>\",\"reason\":\"<one short clause>\"}]}. Pick at most the requested number. Prefer fewer, highly-relevant files over many marginally-relevant ones. Do not invent paths — only use paths that appear in the tree.";
  const user = `Query: ${query}\nMax files: ${maxFiles}\n\nProject tree:\n${tree}`;
  const res = await callFireworks({
    model: MODEL_KIMI_K2_6,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1,
    max_tokens: 1024,
    response_format: { type: "json_object" },
  });
  const raw = res.choices?.[0]?.message?.content ?? "";
  let parsed: { files?: Array<{ path?: string; reason?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: PickedFile[] = [];
  for (const f of parsed.files ?? []) {
    if (typeof f?.path === "string" && f.path.trim()) {
      out.push({ path: f.path.trim(), reason: typeof f.reason === "string" ? f.reason : undefined });
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

async function summarizeFile(
  projectRoot: string,
  relPath: string,
): Promise<string> {
  let abs: string;
  try {
    abs = safeJoin(projectRoot, relPath);
  } catch {
    return "(unreadable path)";
  }
  let source: string;
  try {
    source = readFileSync(abs, "utf8");
  } catch {
    return "(file unreadable)";
  }
  // 6k chars is enough for a faithful one-sentence summary on most files.
  const excerpt = source.length > 6000 ? source.slice(0, 6000) + "\n…[truncated]" : source;
  const res = await callFireworks({
    model: MODEL_GLM_5_1,
    messages: [
      {
        role: "system",
        content:
          "Summarize the given source file in ONE sentence (<= 30 words) describing its purpose and the main exports. Output only the sentence.",
      },
      { role: "user", content: `File: ${relPath}\n\n${excerpt}` },
    ],
    temperature: 0.2,
    max_tokens: 120,
  });
  return (res.choices?.[0]?.message?.content ?? "").trim().replace(/\s+/g, " ");
}

async function findRelevantFiles(
  projectRoot: string,
  query: string,
  maxFiles: number,
  summarize: boolean,
): Promise<string> {
  const t0 = Date.now();
  const idx = await buildCodeIndex(projectRoot);
  const stats = indexStats(idx);
  const tIndex = Date.now() - t0;
  if (stats.files === 0) {
    return JSON.stringify({
      error: "no source files found in project",
      stats,
    });
  }
  const tree = formatCompactTree(idx);
  const picked = await pickFilesWithLLM(query, tree, maxFiles);
  const tPick = Date.now() - t0 - tIndex;
  const valid = picked.filter((p) => idx.files[p.path]);

  let summaries: string[] = [];
  if (summarize && valid.length > 0) {
    summaries = await Promise.all(valid.map((p) => summarizeFile(projectRoot, p.path)));
  }
  const tSummary = Date.now() - t0 - tIndex - tPick;

  const results = valid.map((p, i) => ({
    path: p.path,
    reason: p.reason,
    summary: summarize ? summaries[i] : undefined,
    symbols: idx.files[p.path].symbols.slice(0, 12).map((s) => `${s.kind}:${s.name}`),
  }));

  return JSON.stringify(
    {
      query,
      stats: {
        indexed_files: stats.files,
        indexed_symbols: stats.symbols,
        by_lang: stats.byLang,
        index_ms: tIndex,
        pick_ms: tPick,
        summary_ms: tSummary,
      },
      files: results,
      ...(picked.length > valid.length
        ? { warning: `dropped ${picked.length - valid.length} hallucinated paths` }
        : {}),
    },
    null,
    2,
  );
}
