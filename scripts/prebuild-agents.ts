#!/usr/bin/env bun
/**
 * Pre-compiles TypeScript agent definitions in `.agents/` to JSON.
 * In this scaffold we just validate any existing `.agents/*.json` files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const agentsDir = join(root, ".agents");

if (!existsSync(agentsDir)) {
  console.log(`prebuild-agents: no .agents/ directory at ${root}, skipping.`);
  process.exit(0);
}

let count = 0;
let errors = 0;
for (const name of readdirSync(agentsDir)) {
  if (!name.endsWith(".json")) continue;
  const file = join(agentsDir, name);
  try {
    JSON.parse(readFileSync(file, "utf8"));
    count++;
  } catch (err) {
    errors++;
    console.error(`prebuild-agents: ${file} is not valid JSON`, err);
  }
}
console.log(`prebuild-agents: validated ${count} agent(s), ${errors} error(s).`);
process.exit(errors > 0 ? 1 : 0);
