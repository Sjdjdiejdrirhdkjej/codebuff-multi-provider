#!/usr/bin/env bun
/** Tag + publish a new CLI release. Stub implementation. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(
  readFileSync(join(new URL("..", import.meta.url).pathname, "package.json"), "utf8"),
) as { name: string; version: string };

console.log(`Would tag and publish ${pkg.name}@${pkg.version}`);
console.log("Steps:");
console.log("  1. bun run build:binary");
console.log(`  2. git tag v${pkg.version}`);
console.log("  3. git push --tags");
console.log("  4. npm publish (or upload artifacts to release storage)");
