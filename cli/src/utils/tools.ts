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

export const VISIBLE_TOOLS = new Set<string>([
  "write_file",
  "str_replace",
  "run_terminal_command",
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
            description:
              "Project-relative or absolute paths to files inside the project.",
          },
        },
        required: ["paths"],
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
            description:
              "Project-relative or absolute directory path. Defaults to the project root.",
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
            description:
              "Glob pattern. Supports '*', '**', and '?'. Matched against project-relative paths.",
          },
          path: {
            type: "string",
            description:
              "Optional directory to search in (project-relative or absolute). Defaults to the project root.",
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
          pattern: {
            type: "string",
            description: "JavaScript regular expression source.",
          },
          path: {
            type: "string",
            description:
              "Optional directory to restrict the search to (project-relative or absolute). Defaults to the project root.",
          },
          flags: {
            type: "string",
            description:
              "Optional regex flags (e.g. 'i' for case-insensitive). 'g' is always added.",
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
          path: {
            type: "string",
            description: "Project-relative or absolute path to the file to write.",
          },
          content: {
            type: "string",
            description: "Full UTF-8 content for the file.",
          },
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
        "Edit an existing UTF-8 file by replacing exact occurrences of `old_string` with `new_string`. By default `old_string` must match exactly once; set `replace_all` to true to replace every occurrence. Prefer this over write_file for targeted changes — it is more efficient and gives clearer feedback.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative or absolute path to the file.",
          },
          old_string: { type: "string", description: "Exact text to find." },
          new_string: { type: "string", description: "Replacement text." },
          replace_all: {
            type: "boolean",
            description: "Replace all occurrences (default: false).",
          },
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
        "Run a shell command in the project root and return its combined stdout/stderr. Times out after 60 seconds. Be careful with destructive commands (git push, rm -rf, deploys, global installs, anything touching production).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
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
        "Internal scratchpad for moderately complex reasoning (planning, edge cases, refactor strategy). The thought is recorded but not shown to the user. Use this when you need to work something out before acting.",
      parameters: {
        type: "object",
        properties: {
          thought: {
            type: "string",
            description: "Your private reasoning.",
          },
        },
        required: ["thought"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_turn",
      description:
        "Signal that you are done with the user's current request and have nothing more to do. Call this after you have completed the task and written your final summary.",
      parameters: {
        type: "object",
        properties: {},
      },
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

export function executeTool(
  name: string,
  rawArgs: string,
  projectRoot: string,
): string {
  let args: Record<string, unknown>;
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return `error: invalid arguments JSON: ${rawArgs}`;
  }
  try {
    if (name === "read_files") {
      const raw = args.paths;
      const paths = Array.isArray(raw)
        ? raw.map(String)
        : typeof raw === "string"
        ? [raw]
        : [];
      if (paths.length === 0) return "error: paths is required";
      const parts: string[] = [];
      for (const p of paths) {
        try {
          const abs = safeJoin(projectRoot, p);
          const txt = readFileSync(abs, "utf8");
          const body =
            txt.length > 8000 ? txt.slice(0, 8000) + "\n…[truncated]" : txt;
          parts.push(`===== ${p} =====\n${body}`);
        } catch (err) {
          parts.push(`===== ${p} =====\nerror: ${(err as Error).message}`);
        }
      }
      return parts.join("\n\n");
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
      const base = safeJoin(projectRoot, String(args.path ?? "."));
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
      const base = safeJoin(projectRoot, String(args.path ?? "."));
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
            if (hits.length >= 100) break outer;
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
      try {
        const out = execSync(command, {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60_000,
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
    if (name === "think_deeply") {
      return "(noted)";
    }
    if (name === END_TURN_TOOL) {
      return "(turn ended)";
    }
    return `error: unknown tool ${name}`;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
