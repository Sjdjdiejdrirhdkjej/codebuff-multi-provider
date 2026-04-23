import { describe, expect, it } from "bun:test";

import { parseArgs } from "../index.js";

describe("parseArgs", () => {
  it("returns defaults for empty argv", () => {
    const r = parseArgs([]);
    expect(r.initialPrompt).toBeNull();
    expect(r.agent).toBeNull();
    expect(r.clearLogs).toBe(false);
    expect(r.continue).toBe(false);
    expect(r.continueId).toBeNull();
    expect(r.initialMode).toBe("NORMAL");
    expect(r.command).toBeNull();
  });

  it("parses positional prompt", () => {
    const r = parseArgs(["fix", "the", "bug"]);
    expect(r.initialPrompt).toBe("fix the bug");
  });

  it("--lite sets LITE mode", () => {
    expect(parseArgs(["--lite"]).initialMode).toBe("LITE");
    expect(parseArgs(["--free"]).initialMode).toBe("LITE");
  });

  it("--max sets MAX mode", () => {
    expect(parseArgs(["--max"]).initialMode).toBe("MAX");
  });

  it("--plan sets PLAN mode", () => {
    expect(parseArgs(["--plan"]).initialMode).toBe("PLAN");
  });

  it("--agent stores the id", () => {
    expect(parseArgs(["--agent", "planner"]).agent).toBe("planner");
  });

  it("--continue without id sets continue=true and continueId=null", () => {
    const r = parseArgs(["--continue"]);
    expect(r.continue).toBe(true);
    expect(r.continueId).toBeNull();
  });

  it("--continue <id> stores the id", () => {
    const r = parseArgs(["--continue", "abc-123"]);
    expect(r.continue).toBe(true);
    expect(r.continueId).toBe("abc-123");
  });

  it("--clear-logs is captured", () => {
    expect(parseArgs(["--clear-logs"]).clearLogs).toBe(true);
  });

  it("--cwd stores the directory", () => {
    expect(parseArgs(["--cwd", "/tmp"]).cwd).toBe("/tmp");
  });

  it("login subcommand sets command='login'", () => {
    expect(parseArgs(["login"]).command).toBe("login");
  });

  it("publish subcommand collects agent ids", () => {
    const r = parseArgs(["publish", "a1", "a2"]);
    expect(r.command).toBe("publish");
    expect(r.publishAgentIds).toEqual(["a1", "a2"]);
  });
});
