#!/usr/bin/env bun
/**
 * Build the CLI for npm distribution.
 *
 * Bundles src/index.tsx -> dist/index.js with Bun. External dependencies
 * (anything in package.json `dependencies`) are *not* bundled — they get
 * resolved at install-time from node_modules. This keeps the published
 * tarball small and lets npm handle native deps (e.g. @opentui/core).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
const entry = join(root, "src/index.tsx");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "node:*",
];

const args = [
  "build",
  entry,
  "--target=node",
  "--format=esm",
  `--outdir=${outDir}`,
  "--minify",
  "--sourcemap=external",
  ...externals.flatMap((e) => ["--external", e]),
];

console.log("> bun", args.join(" "));
const res = spawnSync("bun", args, { stdio: "inherit", cwd: root });
if (res.status !== 0) {
  console.error("Build failed");
  process.exit(res.status ?? 1);
}
console.log(`✓ Built ${join(outDir, "index.js")}`);
