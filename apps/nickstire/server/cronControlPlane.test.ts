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
  extractRegistryJobNames,
  extractTierJobNames,
  extractDisabledTierJobNames,
  MANUAL_TRIGGER_STAGED,
  REGISTRY_TIER_ALIASES,
} from "./cron/registry-tier-map";
import { buildCronJobStatuses, type TierCadence } from "./cron/cron-status";
import {
  HEALTH_ISSUE_CATEGORIES,
  ISSUE_DELIVERY,
  cronStalenessIssues,
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

    const registryNames = extractRegistryJobNames(registrySrc);
    const tierNames = extractTierJobNames(schedulerSrc);

    expect(registryNames.length).toBeGreaterThan(20); // instrument sees its target
    expect(tierNames.size).toBeGreaterThan(50);

    const faults = findCronWiringFaults(
      registryNames.map((name) => ({ name, enabled: true })),
      tierNames,
    );
    expect(faults.map((f) => `${f.kind}: ${f.jobName}`)).toEqual([]);
  });

  it("REAL SOURCE: the two crons this PR wired are in a tier", () => {
    const tierNames = extractTierJobNames(read("server/cron/scheduler.ts"));
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
    expect(selectAlertableIssues([orphan]).issues).toEqual([]);
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
    expect(selectAlertableIssues(issues).issues).toHaveLength(HEALTH_ISSUE_CATEGORIES.length);
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
      expect(selectAlertableIssues([{ category, message: "x" }]).issues, category).toHaveLength(1);
    }
  });

  it("throttles a standing condition to once an hour, per category", () => {
    const t0 = 1_000_000;
    const stale: HealthIssue = { category: "CRON_STALE", message: "a" };
    expect(selectAlertableIssues([stale], t0).issues).toHaveLength(1);
    expect(selectAlertableIssues([stale], t0 + 5 * 60_000).issues).toHaveLength(0);
    expect(selectAlertableIssues([stale], t0 + 61 * 60_000).issues).toHaveLength(1);
  });

  it("the throttle is keyed on category, not message text", () => {
    // CRON_STALE messages carry a live minute count, so a text-keyed throttle
    // would let every pass through and the throttle would do nothing.
    const t0 = 2_000_000;
    expect(selectAlertableIssues([{ category: "CRON_STALE", message: "stale 5min" }], t0).issues).toHaveLength(1);
    expect(selectAlertableIssues([{ category: "CRON_STALE", message: "stale 10min" }], t0 + 60_000).issues).toHaveLength(0);
  });

  it("a throttled category does not suppress a DIFFERENT category", () => {
    const t0 = 3_000_000;
    selectAlertableIssues([{ category: "CRON_STALE", message: "a" }], t0);
    expect(selectAlertableIssues([{ category: "DATABASE_DOWN", message: "b" }], t0 + 1000).issues).toHaveLength(1);
  });

  // --- Regressions caught in review on #1805, before merge -----------------

  it("BREAKS: several issues in ONE category all reach the operator in one pass", () => {
    // The first draft stamped the category inside the loop, so only the FIRST
    // stale cron was delivered and its siblings read as already-throttled.
    // Cadence iteration order is stable, so the same job would be reported
    // every hour while the others never reached Telegram at all.
    const many: HealthIssue[] = [
      { category: "CRON_STALE", message: "job-a stale" },
      { category: "CRON_STALE", message: "job-b stale" },
      { category: "CRON_STALE", message: "job-c stale" },
    ];
    const picked = selectAlertableIssues(many, 4_000_000);
    expect(picked.issues.map((i) => i.message)).toEqual([
      "job-a stale",
      "job-b stale",
      "job-c stale",
    ]);
  });

  it("the NEXT pass is still throttled after a multi-issue batch", () => {
    const t0 = 5_000_000;
    selectAlertableIssues(
      [{ category: "CRON_STALE", message: "a" }, { category: "CRON_STALE", message: "b" }],
      t0,
    );
    expect(selectAlertableIssues([{ category: "CRON_STALE", message: "c" }], t0 + 60_000).issues)
      .toHaveLength(0);
  });

  it("BREAKS: a failed delivery releases the throttle so the category retries", () => {
    // The stamp used to be committed before alertSystem ran, and the caller
    // only logs a rejection - so one transient Telegram failure suppressed the
    // next eleven five-minute checks for a still-active condition.
    const t0 = 6_000_000;
    const first = selectAlertableIssues([{ category: "DATABASE_DOWN", message: "down" }], t0);
    expect(first.issues).toHaveLength(1);

    // Without release(), a pass one minute later is throttled...
    expect(selectAlertableIssues([{ category: "DATABASE_DOWN", message: "down" }], t0 + 60_000).issues)
      .toHaveLength(0);

    // ...and after it, the category is retryable again.
    first.release();
    expect(selectAlertableIssues([{ category: "DATABASE_DOWN", message: "down" }], t0 + 60_000).issues)
      .toHaveLength(1);
  });

  it("release() restores the PRIOR stamp rather than clearing the throttle", () => {
    // A naive delete would let a category that alerted an hour ago fire
    // immediately after any unrelated failed send.
    const t0 = 7_000_000;
    selectAlertableIssues([{ category: "MEMORY_HIGH", message: "1" }], t0);
    const second = selectAlertableIssues([{ category: "MEMORY_HIGH", message: "2" }], t0 + 61 * 60_000);
    expect(second.issues).toHaveLength(1);
    second.release();
    // Stamp is back at t0, so a pass 30 min after t0 is still inside the hour.
    expect(selectAlertableIssues([{ category: "MEMORY_HIGH", message: "3" }], t0 + 30 * 60_000).issues)
      .toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// 2b - Alias resolution on the status surface (review regression, #1805)
// -------------------------------------------------------------------------
describe("canary - cron status resolves aliases before declaring a job unwired", () => {
  const CADENCE: TierCadence = {
    intervalMin: 120,
    businessHoursOnly: false,
    oncePerShopDay: false,
    tier: "hourly",
  };
  const ALIASES = [{ registryName: "retention-7day", coveredBy: "retention-all" }];

  it("BREAKS: an aliased job must NOT be reported as tier: null", () => {
    // The first draft unioned registry names with tier names and looked up
    // cadence by exact name, so all six aliased names came back tier: null —
    // which this module documents as "cannot run". Six permanent false wiring
    // failures, introduced by the change that repaired the surface.
    const [job] = buildCronJobStatuses(
      [{ name: "retention-7day", enabled: true }],
      new Map([["retention-all", CADENCE]]),
      new Map([["retention-all", "2026-08-23T10:00:00.000Z"]]),
      ALIASES,
    ).filter((j) => j.name === "retention-7day");

    expect(job.tier).toBe("hourly");
    expect(job.intervalMin).toBe(120);
    expect(job.coveredBy).toBe("retention-all");
    // An alias has no cron_log rows of its own; the covering job's completion
    // is the one that means anything.
    expect(job.lastCompletedAt).toBe("2026-08-23T10:00:00.000Z");
  });

  it("a STALE alias still reads as unwired, not as covered", () => {
    // Covering job deleted: the alias must NOT launder the gap into health.
    const [job] = buildCronJobStatuses(
      [{ name: "retention-7day", enabled: true }],
      new Map(), // retention-all is GONE
      new Map(),
      ALIASES,
    );
    expect(job.tier).toBeNull();
    expect(job.coveredBy).toBeNull();
  });

  it("a genuinely unwired job is still reported as tier: null", () => {
    const [job] = buildCronJobStatuses(
      [{ name: "campaign-resume", enabled: true }],
      new Map([["retention-all", CADENCE]]),
      new Map(),
      ALIASES,
    ).filter((j) => j.name === "campaign-resume");
    expect(job.tier).toBeNull();
    expect(job.coveredBy).toBeNull();
  });

  it("a directly-wired job reports its own tier and never a cover", () => {
    const [job] = buildCronJobStatuses(
      [{ name: "self-healing", enabled: true }],
      new Map([["self-healing", { ...CADENCE, tier: "heartbeat", intervalMin: 5 }]]),
      new Map([["self-healing", "2026-08-23T19:13:17.000Z"]]),
      ALIASES,
    );
    expect(job.tier).toBe("heartbeat");
    expect(job.coveredBy).toBeNull();
    expect(job.lastCompletedAt).toBe("2026-08-23T19:13:17.000Z");
  });

  it("an unreadable cron_log yields null completions, never invented ones", () => {
    const [job] = buildCronJobStatuses(
      [{ name: "self-healing", enabled: true }],
      new Map([["self-healing", CADENCE]]),
      null, // cron_log unreadable
      ALIASES,
    );
    expect(job.lastCompletedAt).toBeNull();
    // The caller must branch on `observable` — this asserts the shape does not
    // silently present "cannot tell" as "never ran".
    expect(job.tier).toBe("hourly");
  });

  it("the rollback is WIRED, not merely available", () => {
    // The tests above prove release() works. They do NOT prove anything calls
    // it — delete the .catch() handler in runSelfHealingChecks and every one of
    // them still passes. That is the built-tested-unwired shape this whole PR
    // is about, reproduced inside its own canary; assert the consumer.
    const src = read("server/services/selfHealing.ts");
    const call = src.slice(src.indexOf("const alertable = selectAlertableIssues"));
    const block = call.slice(0, call.indexOf("\n  }"));
    expect(block, "alertSystem must be invoked with the selected issues").toContain("alertSystem(");
    expect(block, "the rejection path must release the throttle").toMatch(
      /\.catch\([\s\S]*alertable\.release\(\)/,
    );
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

// ─────────────────────────────────────────────────────────────────────────
// 4 · Manual-trigger staging (2026-08-25)
//
// campaign-resume and sms-learning-digest were wired into tiers on 2026-08-23
// and began firing automatically. campaign-resume can send real SMS and
// SMS_KILL_SWITCH does not gate it, so both are now held OFF the scheduler
// and reachable only by hand.
//
// A staging flag has TWO ways to be wrong, and a test that checks one of them
// is worse than useless because it reads as coverage:
//
//   · it stops working  -> the job goes automatic again, unwatched
//   · it works too well -> the job becomes unreachable, which is a decommission
//                          wearing a staging label, and nobody notices until
//                          the day the recovery net is actually needed
//
// Both directions are asserted below.
// ─────────────────────────────────────────────────────────────────────────
describe("canary · crons staged behind the manual trigger", () => {
  const SCHEDULER = read("server/cron/scheduler.ts");

  it("BREAKS: a job that loses its `enabled: false` is no longer seen as staged", () => {
    // The positive control, and the load-bearing one. If the parser returned
    // the same set either way, every assertion below would be vacuous and
    // would pass over a job that had quietly gone automatic.
    const staged = `{\n  name: "campaign-resume",\n  enabled: false,\n  handler: x,\n},`;
    const promoted = `{\n  name: "campaign-resume",\n  handler: x,\n},`;
    expect(extractDisabledTierJobNames(staged).has("campaign-resume")).toBe(true);
    expect(extractDisabledTierJobNames(promoted).has("campaign-resume")).toBe(false);
  });

  it("BREAKS: a decoy `enabled: true` does not read as staged", () => {
    // Distinct from the case above: there the flag is absent, here it is
    // present and says the opposite. A substring check for "enabled" would
    // pass both and guard nothing.
    const src = `{\n  name: "campaign-resume",\n  enabled: true,\n  handler: x,\n},`;
    expect(extractDisabledTierJobNames(src).has("campaign-resume")).toBe(false);
  });

  it("every staged job really is disabled in the live scheduler", () => {
    const disabled = extractDisabledTierJobNames(SCHEDULER);
    for (const job of MANUAL_TRIGGER_STAGED) {
      expect(disabled.has(job.name), `${job.name} is listed as staged but the scheduler will run it`).toBe(true);
    }
  });

  it("no job is disabled without an entry saying why", () => {
    // The other direction. `enabled: false` alone is indistinguishable from
    // someone parking a broken job and forgetting it; the list is what makes
    // the intent legible, so drift in either direction is a failure.
    const listed = new Set(MANUAL_TRIGGER_STAGED.map((j) => j.name));
    for (const name of extractDisabledTierJobNames(SCHEDULER)) {
      expect(listed.has(name), `${name} is disabled in scheduler.ts with no MANUAL_TRIGGER_STAGED entry`).toBe(true);
    }
  });

  it("every entry states a reason and a promotion condition", () => {
    // Copied from the alias rule above: an entry cannot outlive its
    // justification if it is required to carry one.
    for (const job of MANUAL_TRIGGER_STAGED) {
      expect(job.why.length, `${job.name} needs a why`).toBeGreaterThan(30);
      expect(job.promote.length, `${job.name} needs a promotion condition`).toBeGreaterThan(30);
    }
  });

  it("STAGED, NOT DECOMMISSIONED: the manual runners ignore `enabled`", () => {
    // Without this, the change above is an unwired control — the recovery net
    // would be gone rather than held, and the automatic path and the manual
    // path would both be shut. Assert the mechanism, not the intent: slice
    // each runner's body and require no `enabled` read inside it.
    const body = (src: string, fn: string) => {
      const start = src.indexOf(`export async function ${fn}(`);
      expect(start, `${fn} not found — the manual path was renamed or deleted`).toBeGreaterThan(-1);
      const next = src.indexOf("\nexport ", start + 1);
      return src.slice(start, next === -1 ? undefined : next);
    };
    const tierRunner = body(SCHEDULER, "runTierJobByName");
    expect(tierRunner).toContain("job.handler()");
    expect(tierRunner, "runTierJobByName must not gate on enabled").not.toMatch(/\benabled\b/);

    const REGISTRY = read("server/cron/index.ts");
    const httpRunner = body(REGISTRY, "runJobByName");
    expect(httpRunner).toContain("job.handler()");
    expect(httpRunner, "runJobByName must not gate on enabled").not.toMatch(/\benabled\b/);
  });

  it("REACHABLE BY NAME: every staged job is still in registerAllJobs()", () => {
    // runJobByName resolves against the legacy registry, not the tiers, so a
    // staged job missing from registerAllJobs() is unreachable no matter what
    // the tier says.
    const registry = new Set(extractRegistryJobNames(read("server/cron/index.ts")));
    const tiers = extractTierJobNames(SCHEDULER);
    for (const job of MANUAL_TRIGGER_STAGED) {
      expect(registry.has(job.name), `${job.name} is not in registerAllJobs() — runJobByName cannot find it`).toBe(true);
      expect(tiers.has(job.name), `${job.name} vanished from the tiers`).toBe(true);
    }
  });

  it("REACHABLE IN FACT: an owner-gated route fires staged jobs, and the bridge does NOT", () => {
    // The first version of this suite asserted registry membership and called
    // it reachability. Review proved that false: /api/bridge/run-job 403s on
    // any name outside BRIDGE_RUN_JOB_ALLOWLIST, which deliberately excludes
    // SMS-capable jobs and contained neither staged name — so "fire it by name
    // and it runs" pointed at a locked door and staging was a decommission in
    // fact. Registry membership is necessary, not sufficient; this test pins
    // the whole chain the previous one skipped.
    const ADMIN = read("server/routes/adminRoutes.ts");

    // The dedicated route exists, sits behind the admin gate on the SAME
    // registration line (a gate on a nearby line guards a different route),
    // validates against MANUAL_TRIGGER_STAGED, and executes via runJobByName —
    // the runner that WRITES cron_log, because an unobservable first run
    // defeats the purpose of staging.
    expect(ADMIN).toMatch(/app\.post\("\/api\/admin\/run-staged-cron",\s*requireAdminApiKey/);
    const route = ADMIN.slice(ADMIN.indexOf('app.post("/api/admin/run-staged-cron"'));
    const routeBody = route.slice(0, route.indexOf("app.", 10));
    expect(routeBody, "the route must gate on MANUAL_TRIGGER_STAGED, not accept any name").toContain("MANUAL_TRIGGER_STAGED");
    expect(routeBody, "must refuse non-staged names").toMatch(/status\(403\)/);
    expect(routeBody, "must run via runJobByName so the run lands in cron_log").toContain("runJobByName");

    // And the bridge allowlist must NOT grow the SMS-capable staged jobs —
    // that list is a control from the 2026-07-05 adversarial audit, reachable
    // by the Custom GPT and any leaked X-Bridge-Key. Widening it is the
    // tempting one-line "fix" for the reachability gap, and it is the wrong
    // one. Parse the literal Set, not the whole file, so mentions in comments
    // do not count.
    const BRIDGE = read("server/_core/bridge-routes.ts");
    const listStart = BRIDGE.indexOf("BRIDGE_RUN_JOB_ALLOWLIST = new Set([");
    expect(listStart, "BRIDGE_RUN_JOB_ALLOWLIST not found — if renamed, re-verify reachability from scratch").toBeGreaterThan(-1);
    const list = BRIDGE.slice(listStart, BRIDGE.indexOf("])", listStart));
    for (const job of MANUAL_TRIGGER_STAGED) {
      expect(list, `${job.name} must NOT enter the bridge allowlist — use /api/admin/run-staged-cron`).not.toContain(`"${job.name}"`);
    }
  });

  it("BREAKS: a staged job is never judged stale; the same job live IS", () => {
    // Review finding two, verified before fixing: cronStalenessIssues judged
    // every tier job, so campaign-resume — whose last cron_log row is frozen
    // at its final automatic run — would go CRON_STALE ~15 minutes after the
    // staging deploy and re-alert on every hourly throttle window, forever.
    // An unsilenceable false alarm teaches the operator to ignore the channel,
    // which un-guards everything else the channel carries.
    //
    // Same fixture both ways: identical cadence, identical ancient completion;
    // only the flag differs. Without the live arm this cannot be told apart
    // from a staleness check that stopped firing entirely.
    const NOW = Date.parse("2026-08-25T18:00:00Z");
    const cadence = { intervalMin: 5, businessHoursOnly: false, oncePerShopDay: false, tier: "heartbeat" };
    const ancient = new Map([["campaign-resume", "2026-08-25T14:19:51Z"]]); // ~3.7h > 15min allowance

    const staged = cronStalenessIssues(
      new Map([["campaign-resume", { ...cadence, scheduledAutomatically: false }]]),
      ancient, NOW, 10 * 60 * 60 * 1000,
    );
    expect(staged, `staged job produced: ${JSON.stringify(staged)}`).toEqual([]);

    const live = cronStalenessIssues(
      new Map([["campaign-resume", { ...cadence, scheduledAutomatically: true }]]),
      ancient, NOW, 10 * 60 * 60 * 1000,
    );
    expect(live).toHaveLength(1);
    expect(live[0].category).toBe("CRON_STALE");
  });

  it("a staged job that has NEVER run is not reported either — that is its designed state", () => {
    // The never-observed branch, separately: before the first manual run
    // sms-learning-digest has produced nothing, and long uptime would
    // otherwise flip it to CRON_NEVER_OBSERVED. A live never-run job with the
    // same uptime must still be reported, or this skip has eaten the watchdog.
    const NOW = Date.parse("2026-08-25T18:00:00Z");
    const cadence = { intervalMin: 120, businessHoursOnly: false, oncePerShopDay: true, tier: "briefings" };
    const empty = new Map<string, string>();
    const longUptime = 72 * 60 * 60 * 1000; // > the 48h oncePerShopDay allowance

    expect(
      cronStalenessIssues(new Map([["sms-learning-digest", { ...cadence, scheduledAutomatically: false }]]), empty, NOW, longUptime),
    ).toEqual([]);
    const live = cronStalenessIssues(
      new Map([["sms-learning-digest", { ...cadence, scheduledAutomatically: true }]]), empty, NOW, longUptime,
    );
    expect(live).toHaveLength(1);
    expect(live[0].category).toBe("CRON_NEVER_OBSERVED");
  });

  it("BREAKS: the cron-status surface must not show a staged job as live", () => {
    // Found by adversarially re-reading my own diff, not by a failing test.
    // buildCronJobStatuses renders tier + intervalMin + lastCompletedAt. With
    // no scheduledAutomatically field, campaign-resume would have read
    // "heartbeat, every 5 min, last completed 2026-08-25 14:19" forever — the
    // timestamp frozen at its last automatic run, because nothing will ever
    // write another. A job that cannot fire, displayed as one that fires every
    // five minutes and recently did.
    //
    // Both directions in one fixture: a staged job and a live one, identical
    // in every other field. A test with only the staged row could not tell
    // this apart from the field being hardcoded false.
    const cadences = new Map<string, TierCadence>([
      ["campaign-resume", { intervalMin: 5, businessHoursOnly: false, oncePerShopDay: false, tier: "heartbeat", scheduledAutomatically: false }],
      ["self-healing", { intervalMin: 5, businessHoursOnly: false, oncePerShopDay: false, tier: "heartbeat", scheduledAutomatically: true }],
    ]);
    const rows = buildCronJobStatuses(
      [{ name: "campaign-resume", enabled: true }, { name: "self-healing", enabled: true }],
      cadences,
      new Map([["campaign-resume", "2026-08-25T14:19:51Z"], ["self-healing", "2026-08-25T14:19:50Z"]]),
      [],
    );
    const staged = rows.find((r) => r.name === "campaign-resume");
    const live = rows.find((r) => r.name === "self-healing");
    expect(staged?.scheduledAutomatically, "a staged job must not report as automatically scheduled").toBe(false);
    expect(live?.scheduledAutomatically, "a live job in the same tier must still report true").toBe(true);
    // The misleading fields are still populated on purpose — the tier and the
    // stale timestamp are real facts. The new flag is what stops them being
    // read as liveness.
    expect(staged?.tier).toBe("heartbeat");
    expect(staged?.lastCompletedAt).toBe("2026-08-25T14:19:51Z");
  });

  it("a job in NO tier reports scheduledAutomatically false, not undefined", () => {
    // The `?? false` default. An unwired job is not automatically scheduled
    // either, and `undefined` on a boolean field renders as absent, which a
    // consumer reads as "unknown" — the one answer this surface must never give.
    const rows = buildCronJobStatuses(
      [{ name: "stranded-job", enabled: true }],
      new Map<string, TierCadence>(),
      new Map(),
      [],
    );
    expect(rows[0].tier).toBeNull();
    expect(rows[0].scheduledAutomatically).toBe(false);
  });

  it("staged jobs stay ENABLED in the legacy registry — the second flag is a trap", () => {
    // Two `enabled` flags now exist and mean different things. The tier's is
    // the staging switch. The registry's gates findCronWiringFaults, which
    // does `if (!job.enabled) continue` — so setting the registry flag false
    // would BLIND the wiring check to these two jobs while disabling nothing,
    // since runJobByName never reads it.
    //
    // The tidy-up that causes this is obvious and wrong: "I staged it in the
    // tier, I should stage it in the registry too." Assert the registry
    // registration stays bare so that edit fails here instead of silently
    // removing wiring coverage.
    const REGISTRY = read("server/cron/index.ts");
    for (const job of MANUAL_TRIGGER_STAGED) {
      const call = REGISTRY.slice(REGISTRY.indexOf(`registerJob("${job.name}"`));
      const end = call.indexOf("});");
      expect(end, `registerJob("${job.name}") not found`).toBeGreaterThan(-1);
      expect(
        call.slice(0, end),
        `${job.name} must stay enabled in the legacy registry — a false there blinds findCronWiringFaults without disabling anything`,
      ).not.toMatch(/,\s*false\s*\)/);
    }
  });

  it("the ONLY automatic path is the tier loop", () => {
    // If startAllJobs() ever came back, `enabled: false` on a tier job would
    // stop one scheduler while the legacy registry ran the same job on a
    // setInterval — staging that stages nothing.
    const REGISTRY = read("server/cron/index.ts");
    expect(REGISTRY).toMatch(/startAllJobs\(\) is decommissioned/);
    // Strip comments first — the same false-positive the getJobStatuses check
    // above guards against, and it fired here on the first run: this file's
    // header still said "Uses setInterval", describing a scheduler removed
    // months earlier. The claim was corrected rather than the check loosened,
    // but the check must still read CODE, because the next true sentence about
    // setInterval will also be a comment.
    const code = REGISTRY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the legacy registry must not schedule anything").not.toMatch(/setInterval\s*\(/);
  });
});
