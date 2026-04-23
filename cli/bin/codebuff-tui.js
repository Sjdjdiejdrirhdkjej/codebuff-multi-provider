#!/usr/bin/env bun
// codebuff-tui — npm-installed entry point. Requires Bun >= 1.3.
import { main } from "../dist/index.js";
main(process.argv.slice(2)).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[codebuff-tui] fatal:", err);
  process.exit(1);
});
