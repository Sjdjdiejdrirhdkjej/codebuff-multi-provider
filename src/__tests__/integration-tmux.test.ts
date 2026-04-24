import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

const hasTmux = spawnSync("which", ["tmux"]).status === 0;
const describeIfTmux = hasTmux ? describe : describe.skip;

describeIfTmux("tmux integration", () => {
  it("can start a tmux session", () => {
    const sess = `cb-test-${Date.now()}`;
    const create = spawnSync("tmux", ["new-session", "-d", "-s", sess, "sleep", "1"]);
    expect(create.status).toBe(0);
    spawnSync("tmux", ["kill-session", "-t", sess]);
  });
});

if (!hasTmux) {
  describe("tmux integration (skipped)", () => {
    it("tmux is not installed; install tmux to run these tests", () => {
      expect(true).toBe(true);
    });
  });
}
