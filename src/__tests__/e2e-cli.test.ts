import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "index.tsx");

function runCli(args: string[], input = "") {
  return spawnSync("bun", [entry, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, IS_FREEBUFF: "false", CODEBUFF_CLI_VERSION: "0.0.0-test" },
    timeout: 15_000,
  });
}

describe("e2e: codebuff CLI", () => {
  it("--help prints usage and exits 0", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("codebuff");
    expect(r.stdout).toContain("--continue");
  });

  it("--version prints the version", () => {
    const r = runCli(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("0.0.0-test");
  });

  it("login subcommand exits 0", () => {
    const r = runCli(["login"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Logged in");
  });
});
