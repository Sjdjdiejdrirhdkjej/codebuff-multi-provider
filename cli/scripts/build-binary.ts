#!/usr/bin/env bun
/** Bundle the CLI into a standalone executable using `bun build --compile`. */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });

const target = process.env.CODEBUFF_TARGET ?? `bun-${process.platform}-${process.arch}`;
const outFile = join(outDir, "codebuff-tui");

const args = [
  "build",
  join(root, "src/index.tsx"),
  "--compile",
  `--target=${target}`,
  `--outfile=${outFile}`,
];

console.log(`Building binary -> ${outFile} (target=${target})`);
const res = spawnSync("bun", args, { stdio: "inherit" });
if (res.status !== 0) {
  console.error("Binary build failed");
  process.exit(res.status ?? 1);
}
console.log(`Built ${outFile}`);
