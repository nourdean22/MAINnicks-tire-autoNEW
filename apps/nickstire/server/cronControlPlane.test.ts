/**
 * Canaries for the cron control plane (PR-A, 2026-08-23).
 *
 * Per root AGENTS.md "Ship the canary, not just the control": no guard ships
 * without a test that BREAKS it and asserts it fails. Every describe block
 * below is a pair — a broken input that must be caught, and an unbroken input
 * that must still pass. Without the second half, a permanently-broken check
 * scores green forever.
 *
 * The three mechanisms under test, and the production defect each one now
 * catches (all confirmed against prod cron_log on 2026-08-23):
 *
 *   1. a cron registered in no tier            → campaign-resume, 0 runs ever
 *   2. an issue category with no alert route    → 6 of 11 categories were mute
 *   3. cron status sourced from the dead registry → lastRun null for all 33
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  findCronWiringFaults,
  REGISTRY_TIER_ALIASES,
  type RegistryTierAlias,
} from "./cron/registry-tier-map";
import {
  HEALTH_ISSUE_CATEGORIES,
  ISSUE_DELIVERY,
  selectAlertableIssues,
  __resetAlertThrottleForTests,
  type HealthIssue,
} from "./services/selfHealing";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8");

// ─────────────────────────────────────────────────────────────────────────
// 1 · A cron registered in no tier must fail a check
// ─────────────────────────────────────────────────────────────────────────
describe("canary · cron wiring faults", () => {
  const TIERS = new Set(["retention-all", "statenour-live-sync", "self-healing"]);

  it("BREAKS: a registry job in no tier and with no alias is reported unwired", () => {
    const faults = findCronWiringFaults(
      [{ name: "campaign-resume", enabled: true }],
      TIERS,
    );
    expect(faults).toHaveLength(1);
    expect(faults[0].kind).toBe("unwired");
    expect(faults[0].jobName).toBe("campaign-resume");
  });

  it("PASSES: the same job is clean once a tier owns it", () => {
    const faults = findCronWiringFaults(
      [{ name: "campaign-resume", enabled: true }],
      new Set([...TIERS, "campaign-resume"]),
    );
    expect(faults).toEqual([]);
  });

  it("BREAKS: an alias whose covering job is itself unwired is a stale alias", () => {
    // The failure mode an allowlist is prone to: the excuse outliving its
    // justification. Rename or delete `retention-all` and `retention-7day` is
    // stranded again — silently, if the alias were a bare name list.
    const faults = findCronWiringFaults(
      [{ name: "retention-7day", enabled: true }],
      new Set(["self-healing"]), // retention-all is GONE
      REGISTRY_TIER_ALIASES,
    );
    expect(faults).toHaveLength(1);
    expect(faults[0].kind).toBe("stale-alias");
    expect(faults[0].message).toContain("retention-all");
  });

  it("BREAKS: an alias for a job that IS wired is reported redundant", () => {
    const faults = findCronWiringFaults(
      [{ name: "retention-7day", enabled: true }],
      new Set(["retention-7day", "retention-all"]),
      REGISTRY_TIER_ALIASES,
    );
    expect(faults.some((f) => f.kind === "redundant-alias" && f.jobName === "retention-7day")).toBe(true);
  });

  it("PASSES: an aliased job with a live covering job is clean", () => {
    const faults = findCronWiringFaults(
      [{ name: "retention-7day", enabled: true }],
      new Set(["retention-all"]),
      REGISTRY_TIER_ALIASES,
    );
    expect(faults).toEqual([]);
  });

  it("a DISABLED registry job is not a wiring fault", () => {
    expect(findCronWiringFaults([{ name: "whatever", enabled: false }], TIERS)).toEqual([]);
  });

  it("aliases are exact names, never patterns — a sibling is not absorbed", () => {
    // `retention-*` as a pattern would have silently excused a genuinely
    // stranded retention-30day the day someone added one.
    const faults = findCronWiringFaults(
      [{ name: "retention-30day", enabled: true }],
      new Set(["retention-all"]),
      REGISTRY_TIER_ALIASES,
    );
    expect(faults).toHaveLength(1);
    expect(faults[0].kind).toBe("unwired");
  });

  it("every alias cites the tier job it defers to", () => {
    for (const alias of REGISTRY_TIER_ALIASES) {
      expect(alias.coveredBy, `${alias.registryName} must name its cover`).toBeTruthy();
      expect(alias.reason.length, `${alias.registryName} must justify the alias`).toBeGreaterThan(20);
    }
  });

  it("REAL SOURCE: every job in registerAllJobs() is wired or aliased", () => {
    // Parsed from source rather than imported, so this runs without booting the
    // scheduler or touching a database. If it ever disagrees with runtime, the
    // runtime check in selfHealing is the one that pages.
    const registrySrc = read("server/cron/index.ts");
    const schedulerSrc = read("server/cron/scheduler.ts");

    const registryNames = [...registrySrc.matchAll(/registerJob\("([a-z0-9-]+)"/g)].map((m) => m[1]);
    const tierNames = new Set([...schedulerSrc.matchAll(/name: "([a-z0-9-]+)"/g)].map((m) => m[1]));

    expect(registryNames.length).toBeGreaterThan(20); // instrument sees its target
    expect(tierNames.size).toBeGreaterThan(50);

    const faults = findCronWiringFaults(
      registryNames.map((name) => ({ name, enabled: true })),
      tierNames,
    );
    expect(faults.map((f) => `${f.kind}: ${f.jobName}`)).toEqual([]);
  });

  it("REAL SOURCE: the two crons this PR wired are in a tier", () => {
    const tierNames = new Set(
      [...read("server/cron/scheduler.ts").matchAll(/name: "([a-z0-9-]+)"/g)].map((m) => m[1]),
    );
    // Both had ZERO rows in production cron_log before this change.
    expect(tierNames.has("campaign-resume")).toBe(true);
    expect(tierNames.has("sms-learning-digest")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2 · An alert category with no path to alertSystem must fail a check
// ─────────────────────────────────────────────────────────────────────────
describe("canary · self-healing alert routing", () => {
  beforeEach(() => __resetAlertThrottleForTests());

  it("BREAKS: a category with no delivery route is caught", () => {
    // Simulates the twelfth category being added without a route. The compiler
    // rejects this in real code (ISSUE_DELIVERY is a Record over the union);
    // this asserts the runtime behaviour of that gap so the guarantee is not
    // purely compile-time — a `as any` cast anywhere would otherwise reopen it.
    const orphan = { category: "SOMETHING_NEW", message: "x" } as unknown as HealthIssue;
    expect(selectAlertableIssues([orphan])).toEqual([]);
    expect(Object.keys(ISSUE_DELIVERY)).not.toContain("SOMETHING_NEW");
  });

  it("every declared category has an explicit delivery route", () => {
    // The regression this replaces: `i.includes("DATABASE") || ...` enumerated
    // 3 of 11 shapes, so 6 categories reached no operator surface at all.
    for (const category of HEALTH_ISSUE_CATEGORIES) {
      expect(ISSUE_DELIVERY[category], `${category} has no delivery route`).toBeDefined();
    }
    expect(Object.keys(ISSUE_DELIVERY).sort()).toEqual([...HEALTH_ISSUE_CATEGORIES].sort());
  });

  it("PASSES: all eleven categories currently reach the operator", () => {
    const issues: HealthIssue[] = HEALTH_ISSUE_CATEGORIES.map((category) => ({ category, message: `${category} fired` }));
    expect(selectAlertableIssues(issues)).toHaveLength(HEALTH_ISSUE_CATEGORIES.length);
  });

  it("the six formerly-mute categories are among them", () => {
    // Named individually so a future edit that re-mutes one is loud.
    const formerlyMute: HealthIssue["category"][] = [
      "CRON_CADENCE_UNKNOWN",
      "CRON_STALENESS_UNKNOWN",
      "CRON_NEVER_OBSERVED",
      "CRON_STALE",
      "CRON_WIRING_FAULT",
      "AI_PROVIDERS_MISSING",
    ];
    for (const category of formerlyMute) {
      __resetAlertThrottleForTests();
      expect(selectAlertableIssues([{ category, message: "x" }]), category).toHaveLength(1);
    }
  });

  it("throttles a standing condition to once an hour, per category", () => {
    const t0 = 1_000_000;
    const stale: HealthIssue = { category: "CRON_STALE", message: "a" };
    expect(selectAlertableIssues([stale], t0)).toHaveLength(1);
    expect(selectAlertableIssues([stale], t0 + 5 * 60_000)).toHaveLength(0);
    expect(selectAlertableIssues([stale], t0 + 61 * 60_000)).toHaveLength(1);
  });

  it("the throttle is keyed on category, not message text", () => {
    // CRON_STALE messages carry a live minute count, so a text-keyed throttle
    // would let every pass through and the throttle would do nothing.
    const t0 = 2_000_000;
    expect(selectAlertableIssues([{ category: "CRON_STALE", message: "stale 5min" }], t0)).toHaveLength(1);
    expect(selectAlertableIssues([{ category: "CRON_STALE", message: "stale 10min" }], t0 + 60_000)).toHaveLength(0);
  });

  it("a throttled category does not suppress a DIFFERENT category", () => {
    const t0 = 3_000_000;
    selectAlertableIssues([{ category: "CRON_STALE", message: "a" }], t0);
    expect(selectAlertableIssues([{ category: "DATABASE_DOWN", message: "b" }], t0 + 1000)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3 · lastRun sourced from the dead registry must fail a check
// ─────────────────────────────────────────────────────────────────────────
describe("canary · cron status reads the live source", () => {
  it("the legacy registry no longer carries run state at all", () => {
    const src = read("server/cron/index.ts");
    // The class fix: the state died WITH the execution path. If any of these
    // come back, a future reader can be confidently wrong again.
    expect(src).not.toMatch(/^\s*lastRun\?:/m);
    expect(src).not.toMatch(/^\s*running\?:/m);
    expect(src).not.toMatch(/^\s*intervalId\?:/m);
    expect(src).not.toContain("export function getJobStatuses");
    expect(src).not.toContain("export function resetJobRunningFlag");
    expect(src).not.toMatch(/async function runJob\(job: CronJob\)/);
  });

  it("registry membership is exposed under a name that cannot be mistaken for run state", () => {
    const src = read("server/cron/index.ts");
    expect(src).toContain("export function getRegisteredJobNames");
    // The returned shape must not smuggle a timestamp or cadence back in.
    const sig = src.slice(src.indexOf("export function getRegisteredJobNames"));
    const firstLine = sig.slice(0, sig.indexOf("\n"));
    expect(firstLine).toContain("{ name: string; enabled: boolean }");
    expect(firstLine).not.toContain("lastRun");
    expect(firstLine).not.toContain("intervalMin");
  });

  it("both cron-status endpoints source from cron_log, not the registry", () => {
    // Anchor on the HANDLER registration, not the first textual occurrence:
    // bridge-routes.ts mentions "/api/bridge/cron-status" earlier in its
    // BRIDGE_OPS descriptor table, and slicing from there reads the wrong
    // 900 characters. (This test failed on its first run for exactly that
    // reason — kept as a note because a future edit could reintroduce it.)
    const targets: Array<[string, string]> = [
      ["server/routes/adminRoutes.ts", 'app.get("/api/admin/cron-status"'],
      ["server/_core/bridge-routes.ts", 'app.get("/api/bridge/cron-status"'],
    ];
    for (const [rel, anchor] of targets) {
      const src = read(rel);
      const idx = src.indexOf(anchor);
      expect(idx, `${rel} should still register ${anchor}`).toBeGreaterThan(-1);
      const handler = src.slice(idx, idx + 900);
      expect(handler, `${rel} must read the live source`).toContain("getCronStatus");

      // Strip line comments before asserting the ABSENCE of the old reader.
      // Both handlers carry a comment explaining what they used to call, and a
      // bare substring check flags that comment — the mention-vs-execution
      // false positive that guard-red-team exists to catch. A check that fails
      // on its own documentation gets deleted by the next frustrated reader,
      // and then it guards nothing.
      const code = handler.replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${rel} must not read the dead registry`).not.toContain("getJobStatuses");
      expect(code, `${rel} must import the live module`).toContain("cron/cron-status");
    }
  });

  it("getCronStatus distinguishes 'cannot tell' from 'nothing ran'", () => {
    const src = read("server/cron/cron-status.ts");
    // An unreadable cron_log must never render as a fleet of silent jobs.
    expect(src).toContain("observable");
    expect(src).toContain("schedulerStarted");
    expect(src).toMatch(/lastCompletions !== null/);
  });

  it("there is exactly ONE cron_log completion query in the app", () => {
    // Two copies is how the admin and bridge surfaces drifted from selfHealing
    // in the first place. Counted across server/, excluding this test.
    const files = ["server/cron/cron-status.ts", "server/services/selfHealing.ts", "server/cron/observer.ts"];
    const defining = files.filter((f) => /MAX\(completed_at\)\s+AS\s+lastCompletedAt/i.test(read(f)));
    expect(defining).toEqual(["server/cron/cron-status.ts"]);
  });
});
