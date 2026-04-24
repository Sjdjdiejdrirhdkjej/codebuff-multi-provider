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
  "edit_file",
  "bash",
]);

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
      name: "read_file",
      description:
        "Read a UTF-8 text file inside the project. Returns up to 8000 characters.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative or absolute path to a file inside the project.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List entries (files and directories) in a project directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative or absolute directory path. Defaults to project root.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing one with the given UTF-8 content. Creates parent directories as needed.",
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
      name: "edit_file",
      description:
        "Edit an existing UTF-8 file by replacing exact occurrences of `old_string` with `new_string`. Set `replace_all` to true to replace every occurrence; otherwise `old_string` must match exactly once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative or absolute path to the file." },
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
      name: "bash",
      description:
        "Run a shell command in the project root and return its combined stdout/stderr. Times out after 60 seconds.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
        },
        required: ["command"],
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
    if (name === "read_file") {
      const p = safeJoin(projectRoot, String(args.path ?? ""));
      const txt = readFileSync(p, "utf8");
      return txt.length > 8000 ? txt.slice(0, 8000) + "\n…[truncated]" : txt;
    }
    if (name === "list_dir") {
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
    if (name === "write_file") {
      const p = safeJoin(projectRoot, String(args.path ?? ""));
      const content = String(args.content ?? "");
      const existed = existsSync(p);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
      const rel = relative(projectRoot, p) || p;
      return `${existed ? "wrote" : "created"} ${rel} (${content.length} bytes)`;
    }
    if (name === "edit_file") {
      const p = safeJoin(projectRoot, String(args.path ?? ""));
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      const replaceAll = Boolean(args.replace_all);
      if (!oldStr) return "error: old_string is required and must be non-empty";
      const original = readFileSync(p, "utf8");
      let updated: string;
      let count: number;
      if (replaceAll) {
        const parts = original.split(oldStr);
        count = parts.length - 1;
        updated = parts.join(newStr);
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
    if (name === "bash") {
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
    return `error: unknown tool ${name}`;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
