import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import {
  detectLang,
  extractSymbols,
  summarizeSymbols,
  Symbol,
} from "./symbol-extractor.js";

const INDEX_VERSION = 1;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  "coverage",
  ".codebuff",
  ".venv",
  "venv",
  "__pycache__",
  "target", // rust
  ".gradle",
  "vendor",
  ".pnpm-store",
]);

const MAX_FILE_BYTES = 1_000_000; // skip files > 1 MB
const MAX_FILES = 5_000;
const MAX_SYMBOLS_PER_FILE = 200;

export interface FileEntry {
  mtime: number;
  size: number;
  lang: string | null;
  symbols: Symbol[];
}

export interface CodeIndex {
  version: number;
  builtAt: number;
  root: string;
  files: Record<string, FileEntry>;
}

interface BuildOptions {
  /** Maximum number of files to include in the index. */
  maxFiles?: number;
  /** Force a rebuild from scratch instead of loading the cache. */
  force?: boolean;
}

function indexPath(root: string): string {
  return join(root, ".codebuff", "index.json");
}

function loadCachedIndex(root: string): CodeIndex | null {
  const p = indexPath(root);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as CodeIndex;
    if (data.version !== INDEX_VERSION) return null;
    if (data.root !== root) return null;
    return data;
  } catch {
    return null;
  }
}

function saveIndex(idx: CodeIndex): void {
  const p = indexPath(idx.root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(idx));
}

function walk(root: string, dir: string, out: string[], cap: number): void {
  if (out.length >= cap) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= cap) return;
    if (name.startsWith(".") && IGNORED_DIRS.has(name)) continue;
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

/**
 * Build (or refresh) the code index for `root`. Re-uses the on-disk cache
 * for files whose mtime+size haven't changed. Typical incremental refresh
 * for a thousand-file repo runs in tens of milliseconds.
 */
export async function buildCodeIndex(
  root: string,
  opts: BuildOptions = {},
): Promise<CodeIndex> {
  const cap = opts.maxFiles ?? MAX_FILES;
  const cached = opts.force ? null : loadCachedIndex(root);
  const previous = cached?.files ?? {};

  const paths: string[] = [];
  walk(root, root, paths, cap);

  const next: Record<string, FileEntry> = {};
  for (const rel of paths) {
    const lang = detectLang(rel);
    if (!lang) continue;
    const full = join(root, rel);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.size > MAX_FILE_BYTES) continue;
    const mtime = Math.floor(s.mtimeMs);
    const prior = previous[rel];
    if (prior && prior.mtime === mtime && prior.size === s.size) {
      next[rel] = prior;
      continue;
    }
    let source: string;
    try {
      source = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const symbols = extractSymbols(source, lang, MAX_SYMBOLS_PER_FILE);
    next[rel] = { mtime, size: s.size, lang, symbols };
  }

  const idx: CodeIndex = {
    version: INDEX_VERSION,
    builtAt: Date.now(),
    root,
    files: next,
  };
  try {
    saveIndex(idx);
  } catch {
    // Non-fatal — index still works in-memory.
  }
  return idx;
}

/**
 * Render the index as a compact textual tree for use in LLM prompts.
 * Format:
 *   src/
 *     utils/
 *       fireworks.ts [funcs:callFireworks,streamFireworks; class:FireworksError]
 *       router.ts [vars:MODEL_GLM_5_1,MODEL_KIMI_K2_6; type:AppMode; funcs:route]
 *
 * Files with no extracted symbols still appear (without a tag) so the
 * picker model knows they exist.
 */
export function formatCompactTree(idx: CodeIndex, maxChars = 20_000): string {
  const paths = Object.keys(idx.files).sort();
  type Node = { name: string; children: Map<string, Node>; entry?: FileEntry };
  const root: Node = { name: "", children: new Map() };
  for (const p of paths) {
    const parts = p.split(sep);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let child = cur.children.get(part);
      if (!child) {
        child = { name: part, children: new Map() };
        cur.children.set(part, child);
      }
      if (i === parts.length - 1) child.entry = idx.files[p];
      cur = child;
    }
  }

  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;

  function emit(node: Node, depth: number): void {
    if (truncated) return;
    const indent = "  ".repeat(depth);
    if (node.entry) {
      const summary = summarizeSymbols(node.entry.symbols);
      const tag = summary ? ` [${summary}]` : "";
      const line = `${indent}${node.name}${tag}`;
      bytes += line.length + 1;
      if (bytes > maxChars) {
        truncated = true;
        lines.push(`${indent}…(truncated: index too large for prompt)`);
        return;
      }
      lines.push(line);
      return;
    }
    if (node.name) {
      const line = `${indent}${node.name}/`;
      bytes += line.length + 1;
      lines.push(line);
    }
    const children = Array.from(node.children.values()).sort((a, b) => {
      const aDir = a.entry ? 1 : 0;
      const bDir = b.entry ? 1 : 0;
      if (aDir !== bDir) return aDir - bDir; // directories first
      return a.name.localeCompare(b.name);
    });
    for (const c of children) emit(c, node.name ? depth + 1 : 0);
  }

  emit(root, 0);
  return lines.join("\n");
}

export function indexStats(idx: CodeIndex): {
  files: number;
  symbols: number;
  byLang: Record<string, number>;
} {
  let symbols = 0;
  const byLang: Record<string, number> = {};
  for (const f of Object.values(idx.files)) {
    symbols += f.symbols.length;
    if (f.lang) byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;
  }
  return { files: Object.keys(idx.files).length, symbols, byLang };
}
