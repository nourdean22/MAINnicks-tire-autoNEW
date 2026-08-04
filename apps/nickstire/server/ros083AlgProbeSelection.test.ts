/**
 * ROS-083 · the freshness card's failure streak must be counted from probes
 * that actually ATTEMPTED an authentication.
 *
 * There are two ways to get this wrong and only one of them is the bug we came
 * for, so both are pinned.
 *
 * TOO NARROW (the original defect): count only `outcome = 'success'`. A live
 * auth outage is then invisible — the card classifies from the age of the last
 * success against a 24h threshold and stays emerald "Fresh" for a full day.
 *
 * TOO WIDE (the tempting overcorrection): treat every row in alg_probe_log as
 * an attempt. `dedup` means the probe was SKIPPED by the budget guard and never
 * reached ALG at all. Counting those as attempts would make a permanently dead
 * integration look busy and healthy — a WORSE false-green than the one being
 * fixed, because it would survive even a total outage.
 *
 * AUTH_ATTEMPTING_OUTCOMES already draws that line for the session-resume
 * throttle in lib/adminActivity.ts. These assert the freshness read reuses it
 * rather than hand-rolling a second, drifting copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_ATTEMPTING_OUTCOMES } from "./lib/adminActivity";

const ROUTER = readFileSync(join(__dirname, "routers", "adminSecurity.ts"), "utf8");

describe("which probe outcomes count as an attempt", () => {
  it("includes the outcomes that reached ALG auth, whatever the result", () => {
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("success");
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("empty");
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("auth_failed");
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("error");
  });

  it("EXCLUDES dedup — a skipped probe never reached auth and is not evidence of anything", () => {
    expect(AUTH_ATTEMPTING_OUTCOMES).not.toContain("dedup");
    expect(AUTH_ATTEMPTING_OUTCOMES).not.toContain("skipped_recent");
  });
});

describe("the freshness read shares that definition instead of copying it", () => {
  it("imports AUTH_ATTEMPTING_OUTCOMES rather than listing outcomes inline", () => {
    expect(ROUTER).toMatch(/import \{ AUTH_ATTEMPTING_OUTCOMES \} from "\.\.\/lib\/adminActivity"/);
    expect(ROUTER).toMatch(/inArray\(algProbeLog\.outcome, \[\.\.\.AUTH_ATTEMPTING_OUTCOMES\]\)/);
  });

  it("still anchors lastSuccessfulAt on success ALONE — widening it is the worse bug", () => {
    // If someone ever "simplifies" this by pointing lastSuccessfulAt at the
    // attempt query, a dead integration that keeps logging auth_failed would
    // report a fresh successful sync.
    expect(ROUTER).toMatch(/\.where\(eq\(algProbeLog\.outcome, "success"\)\)/);
  });

  it("keeps the streak scan bounded — this query refetches every 60s", () => {
    expect(ROUTER).toMatch(/const ATTEMPT_WINDOW = \d+;/);
    expect(ROUTER).toMatch(/\.limit\(ATTEMPT_WINDOW\)/);
  });
});
