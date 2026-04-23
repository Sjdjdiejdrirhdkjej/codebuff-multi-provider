import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

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
    return `error: unknown tool ${name}`;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
