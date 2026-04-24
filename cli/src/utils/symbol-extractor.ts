export type SymbolKind =
  | "func"
  | "class"
  | "type"
  | "var"
  | "component"
  | "method"
  | "enum"
  | "import";

export interface Symbol {
  kind: SymbolKind;
  name: string;
  line: number;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  py: "py",
  go: "go",
  rs: "rs",
  java: "java",
  kt: "java",
  rb: "rb",
  php: "php",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "c",
  cc: "c",
  hpp: "c",
};

export function detectLang(path: string): string | null {
  const i = path.lastIndexOf(".");
  if (i < 0) return null;
  return LANG_BY_EXT[path.slice(i + 1).toLowerCase()] ?? null;
}

interface Pattern {
  re: RegExp;
  kind: SymbolKind;
  group?: number;
}

const TS_PATTERNS: Pattern[] = [
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, kind: "func" },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, kind: "class" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm, kind: "type" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm, kind: "type" },
  { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/gm, kind: "enum" },
  { re: /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=/gm, kind: "var" }, // SHOUTY_CASE constants
  {
    re: /^\s*(?:export\s+)?const\s+([A-Z][A-Za-z0-9]*)\s*[:=]\s*(?:React\.)?(?:FC|FunctionComponent|memo|forwardRef|\([^)]*\)\s*=>|function)/gm,
    kind: "component",
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([a-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/gm,
    kind: "func",
  },
];

const PY_PATTERNS: Pattern[] = [
  { re: /^\s*def\s+([A-Za-z_][\w]*)/gm, kind: "func" },
  { re: /^\s*async\s+def\s+([A-Za-z_][\w]*)/gm, kind: "func" },
  { re: /^\s*class\s+([A-Za-z_][\w]*)/gm, kind: "class" },
];

const GO_PATTERNS: Pattern[] = [
  { re: /^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/gm, kind: "func" },
  { re: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/gm, kind: "type" },
  { re: /^\s*type\s+([A-Za-z_][\w]*)\s+/gm, kind: "type" },
];

const RS_PATTERNS: Pattern[] = [
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm, kind: "func" },
  { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/gm, kind: "type" },
  { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/gm, kind: "enum" },
  { re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/gm, kind: "type" },
  { re: /^\s*impl(?:<[^>]+>)?\s+(?:[A-Za-z_][\w:<>,\s]*\s+for\s+)?([A-Za-z_][\w]*)/gm, kind: "class" },
];

const JAVA_PATTERNS: Pattern[] = [
  {
    re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([A-Za-z_][\w]*)/gm,
    kind: "class",
  },
  {
    re: /^\s*(?:public|private|protected)?\s*interface\s+([A-Za-z_][\w]*)/gm,
    kind: "type",
  },
  {
    re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[A-Za-z_<>[\],\s]+\s+([A-Za-z_][\w]*)\s*\(/gm,
    kind: "method",
  },
];

const PATTERNS_BY_LANG: Record<string, Pattern[]> = {
  ts: TS_PATTERNS,
  js: TS_PATTERNS,
  py: PY_PATTERNS,
  go: GO_PATTERNS,
  rs: RS_PATTERNS,
  java: JAVA_PATTERNS,
};

const COMMON_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "do",
  "return",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "this",
  "super",
  "typeof",
  "instanceof",
  "void",
  "in",
  "of",
  "as",
  "is",
  "from",
  "import",
  "export",
]);

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Extract a high-signal list of symbols from source code. Regex-based and
 * intentionally lossy — we want speed (sub-millisecond per file) and a
 * compact symbol inventory, not a complete AST.
 */
export function extractSymbols(source: string, lang: string, cap = 200): Symbol[] {
  const patterns = PATTERNS_BY_LANG[lang];
  if (!patterns) return [];
  const seen = new Set<string>();
  const out: Symbol[] = [];
  // Strip block comments cheaply (good enough — keeps regex from catching
  // `function foo` inside a doc comment as a real symbol).
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  for (const { re, kind } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null && out.length < cap) {
      const name = m[1];
      if (!name || COMMON_KEYWORDS.has(name)) continue;
      const key = `${kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, name, line: lineOf(cleaned, m.index) });
    }
  }
  return out;
}

/**
 * Compact one-line description for the code-tree, e.g.:
 *   `funcs:foo,bar; class:Baz; type:Opts`
 */
export function summarizeSymbols(symbols: Symbol[]): string {
  if (symbols.length === 0) return "";
  const groups: Record<string, string[]> = {};
  for (const s of symbols) {
    (groups[s.kind] ??= []).push(s.name);
  }
  return Object.entries(groups)
    .map(([k, names]) => `${k}:${names.slice(0, 12).join(",")}${names.length > 12 ? "…" : ""}`)
    .join("; ");
}
