import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "bunfig.toml",
];

export function isHomeDirectory(dir: string): boolean {
  return resolve(dir) === resolve(homedir());
}

export function findProjectRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      const candidate = `${dir}/${marker}`;
      if (existsSync(candidate)) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function pickProject(cwd: string = process.cwd()): {
  root: string;
  isHome: boolean;
} {
  const resolved = resolve(cwd);
  const isHome = isHomeDirectory(resolved);
  const root = isHome ? resolved : findProjectRoot(resolved);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root not found or not a directory: ${root}`);
  }
  return { root, isHome };
}
