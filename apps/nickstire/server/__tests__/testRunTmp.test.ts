import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

// vitest.config.ts globalSetup (scripts/agent-os/runTmp.mjs) gives each run its own temp
// dir and deletes it afterwards. If the globalSetup line goes, fixtures leak into the
// system temp dir again and this fails.
describe("test run temp dir", () => {
  it("os.tmpdir() is the run-scoped dir from globalSetup", () => {
    const runDir = process.env.TEST_RUN_TMP;
    expect(runDir, "TEST_RUN_TMP is set by the vitest globalSetup").toBeTruthy();
    expect(tmpdir().startsWith(runDir as string)).toBe(true);
  });
});
