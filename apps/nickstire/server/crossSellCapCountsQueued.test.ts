/**
 * Cross-sell outreach per-run cap must count QUEUED texts (Codex P1 on PR #2063).
 *
 * Outside the SMS window every sendSms call returns `queued:true`. The loop
 * guard used to check `sent >= MAX_SMS_PER_RUN` only, so a closed-window run
 * could enqueue every one of the (up to 200) selected predictions for the
 * 8 AM drain — twenty times the documented cap of 10. A queued text WILL
 * reach the customer, so it is an accepted send and counts against the cap.
 *
 * Source contract, same style as crossSellDeadQuery.test.ts: the guard names
 * both counters, and the old sent-only guard is gone. A positive control
 * proves the file under test is the real one (the cap constant is present).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./cron/jobs/crossSellOutreach.ts", import.meta.url), "utf8");

describe("cross-sell per-run cap counts queued texts", () => {
  it("positive control — the cap and both counters exist in the file", () => {
    expect(SRC).toMatch(/const MAX_SMS_PER_RUN = \d+;/);
    expect(SRC).toMatch(/let queued = 0;/);
    expect(SRC).toMatch(/let uncertain = 0;/);
  });

  it("the loop guard is `sent + queued + uncertain >= MAX_SMS_PER_RUN`", () => {
    expect(SRC).toMatch(/if \(sent \+ queued \+ uncertain >= MAX_SMS_PER_RUN\) break;/);
  });

  it("an unconfirmed (uncertain) send still writes the closed-loop action row — only a failure skips it", () => {
    expect(SRC).toMatch(/if \(outcome !== "failed"\) \{\s*if \(outcome === "sent"\) sent\+\+; else if \(outcome === "queued"\) queued\+\+; else uncertain\+\+;/);
  });

  it("the sent-only guard does not survive anywhere", () => {
    expect(SRC).not.toMatch(/if \(sent >= MAX_SMS_PER_RUN\)/);
  });
});
