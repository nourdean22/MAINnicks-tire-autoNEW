/**
 * The Higgsfield session keepalive is PROMOTED (2026-09-08), and this pins why
 * it must stay that way.
 *
 * WHAT HAPPENED. The keepalive was staged behind the manual trigger on
 * 2026-08-29 on the premise that reel-pipeline "no longer runs on the CLI
 * session lane unattended". Production said otherwise: the three jobs that
 * died on 2026-08-30 failed with "Higgsfield CLI exited with code 2 ... Session
 * expired", and for the next nine days no reel was generated. The keepalive is
 * the only in-container refresher of that session; with it off, liveness
 * depended entirely on generation happening often enough to rotate the token —
 * the exact thing a rotation deadlock had already stopped.
 *
 * The reason it was staged — "a cron that dies silently between logins" — is
 * already fixed in its own handler: an invalid session THROWS, so
 * cron-failure-observer records status='failed' and alerts. Loud, not silent.
 *
 * WHY SOURCE ASSERTIONS. The tiered job list is not exported and the handler
 * spawns the CLI. `cronControlPlane.test.ts` set the precedent of parsing
 * scheduler.ts for exactly this property, and its own extractor is reused here
 * so the two tests cannot disagree about what "disabled" means. Every check is
 * also run against a deliberately broken copy — a check that cannot fail is not
 * a check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractDisabledTierJobNames, MANUAL_TRIGGER_STAGED } from "./cron/registry-tier-map";

const scheduler = readFileSync(resolve(process.cwd(), "server/cron/scheduler.ts"), "utf8");
const JOB = "higgsfield-session-keepalive";

/** The keepalive's registration block: from its name to the next job's `name:`. */
function keepaliveBlock(src: string): string {
  const start = src.indexOf(`name: "${JOB}"`);
  if (start < 0) return "";
  const next = src.indexOf("\n        name: \"", start + 1);
  return src.slice(start, next > start ? next : undefined);
}

const block = keepaliveBlock(scheduler);

describe("silent-instrument guard: the keepalive block is actually located", () => {
  it("is a non-empty region containing the handler, not the whole file", () => {
    expect(block, "keepalive registration not found — the job was renamed or removed").not.toBe("");
    expect(block).toContain("getHiggsfieldAccountHealth");
    expect(block.length).toBeLessThan(scheduler.length / 4);
  });
});

describe("the keepalive is scheduled, not staged", () => {
  it("has no `enabled: false` — the tier loop will run it", () => {
    expect(extractDisabledTierJobNames(scheduler).has(JOB)).toBe(false);
  });

  it("PLANTED CANARY: re-staging it is caught by the same extractor", () => {
    const restaged = scheduler.replace(`name: "${JOB}",`, `name: "${JOB}",\n        enabled: false,`);
    expect(restaged).not.toBe(scheduler);
    expect(extractDisabledTierJobNames(restaged).has(JOB)).toBe(true);
  });

  it("has no MANUAL_TRIGGER_STAGED entry, so the failure observer will alert on it", () => {
    // observer.ts suppresses alerts for every name in this list. A promoted job
    // that stayed listed would run AND be muted — the worst of both.
    expect(MANUAL_TRIGGER_STAGED.map((j) => j.name)).not.toContain(JOB);
  });
});

describe("the reason it was staged is already fixed: failure is LOUD", () => {
  const throwsOnInvalid = (s: string) =>
    /if \(!health\.credsValid\) \{[\s\S]*?throw new Error\(/.test(s) &&
    /re-login required/.test(s);
  const clearsStaleCacheFirst = (s: string) => {
    const i = s.indexOf("clearRuntimeHiggsfieldCache()");
    const t = s.indexOf("throw new Error(");
    return i > -1 && t > -1 && i < t;
  };

  it("an invalid session THROWS (status='failed'), never returns 'completed'", () => {
    expect(throwsOnInvalid(block)).toBe(true);
  });

  it("PLANTED CANARY: a handler that returns instead of throwing is caught", () => {
    const quiet = block.replace(/throw new Error\(/, "return ({ recordsProcessed: 0, details: (");
    expect(quiet).not.toBe(block);
    expect(throwsOnInvalid(quiet)).toBe(false);
  });

  it("drops the in-process credential cache BEFORE throwing, so a pasted credential is picked up within one pulse", () => {
    expect(clearsStaleCacheFirst(block)).toBe(true);
  });

  it("PLANTED CANARY: removing the cache clear is caught", () => {
    const stale = block.replace("clearRuntimeHiggsfieldCache();", "");
    expect(stale).not.toBe(block);
    expect(clearsStaleCacheFirst(stale)).toBe(false);
  });

  it("a healthy session returns a 'session refreshed' receipt", () => {
    expect(block).toMatch(/details: `session refreshed/);
  });
});
