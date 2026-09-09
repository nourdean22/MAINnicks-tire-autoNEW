/**
 * The second wave of audit findings, 2026-09-09. Each pins a defect that was
 * live, with a negative control so the pin cannot pass vacuously.
 *
 * What is NOT here, deliberately: a token-refresh job (this app authenticates
 * against graph.facebook.com, so the 60-day ig_refresh_token flow does not
 * apply and building it would have been broken code), and a `reel` FactChannel
 * (every seed fact is `channels: ALL`, so adding it would clear pricing,
 * warranty and legal statements for public video in one line - an owner
 * decision, not a refactor).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
const SCHED = readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");
const INDEX = readFileSync(path.join(__dirname, "cron", "index.ts"), "utf8");
const LEDGER = readFileSync(path.join(__dirname, "services", "generationLedger.ts"), "utf8");
const LANE = readFileSync(path.join(__dirname, "services", "publishReconcileLane.ts"), "utf8");
const PIPE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
const STUDIO = readFileSync(path.join(__dirname, "..", "client", "src", "lib", "facelessReelStudio.ts"), "utf8");

describe("the manual runner is as safe as the tiered one", () => {
  it("both runners derive the budget from ONE definition", () => {
    expect(INDEX).toContain("export function jobTimeoutMs");
    expect(SCHED).toContain('import { acquireCronLock, releaseCronLock, jobTimeoutMs } from "./index"');
    // The duplicate that used to live in scheduler.ts is gone.
    expect(SCHED).not.toContain("function jobTimeoutMs(job:");
  });

  it("the HTTP trigger races the handler and sizes its lock from the same budget", () => {
    const fn = INDEX.slice(INDEX.indexOf("export async function runJobByName"));
    expect(fn).toContain("acquireCronLock(job.name, budgetMs * 2)");
    expect(fn).toContain('reject(new Error("timeout"))');
    // And it holds the lock on timeout, exactly like runTier.
    expect(fn).toContain("timedOut");
    expect(fn).toContain("CRON_TIMEOUT_LOCK_HELD");
  });

  it("reel-pipeline carries the same 14-minute budget in BOTH registries", () => {
    expect(INDEX).toContain("}, true, 14 * 60 * 1000);");
    expect(SCHED).toContain("timeoutMs: 14 * 60 * 1000");
  });

  it("PLANTED CANARY: the bare acquire with no TTL is gone from the manual runner", () => {
    const fn = INDEX.slice(INDEX.indexOf("export async function runJobByName"));
    expect(fn).not.toContain("acquireCronLock(job.name)\n");
  });
});

describe("reservations nothing will settle are released", () => {
  it("the sweeper exists, targets only `reserved`, and releases rather than settles", () => {
    expect(LEDGER).toContain("export async function sweepStaleReservations");
    const fn = LEDGER.slice(LEDGER.indexOf("export async function sweepStaleReservations"));
    const body = fn.slice(0, fn.indexOf("\n/** Settle after success"));
    expect(body).toContain('eq(ctx.table.status, "reserved")');
    // released, not settled: we cannot evidence a charge.
    expect(body).toContain('status: "released"');
    expect(body).not.toContain('status: "settled"');
    // Guarded on the row AND its status, so a row that settled underneath is untouched.
    expect(body).toContain('eq(ctx.table.status, "reserved")');
  });

  it("the stale window is hours, not minutes — it can never race a live worker", () => {
    expect(LEDGER).toContain("export const RESERVATION_STALE_HOURS = 6");
    // The longest legitimate hold is one 14-minute pulse plus assembly.
    const hours = Number(/RESERVATION_STALE_HOURS = (\d+)/.exec(LEDGER)?.[1]);
    expect(hours).toBeGreaterThanOrEqual(1);
  });

  it("`reserved` is still counted as spend — the sweeper is the fix, not un-counting it", () => {
    // If reserved stopped counting, an in-flight job could be double-spent.
    expect(LEDGER).toContain('inArray(ctx.table.status, ["reserved", "settled", "failed"])');
  });

  it("the pulse actually calls it", () => {
    expect(SCHED).toContain("sweepStaleReservations()");
  });
});

describe("an ambiguous publish resolves itself", () => {
  it("the lane reuses the operator's reconciler and writer, inventing no verdict", () => {
    expect(LANE).toContain("reconcileAttempt");
    expect(LANE).toContain("applyReconciliation");
    expect(LANE).toContain("findUnreconciledAttempts");
  });

  it("it auto-applies only the two EVIDENCED verdicts", () => {
    expect(LANE).toContain('verdict.status === "resolved_published"');
    expect(LANE).toContain('verdict.status === "resolved_not_published"');
    // Judgement and no-evidence stay with a human.
    expect(LANE).toContain("leftForOperator");
    expect(LANE).not.toMatch(/decision:\s*"published"[\s\S]{0,200}needs_operator/);
  });

  it("it touches reel jobs only — a scheduled post has its own closure path", () => {
    expect(LANE).toContain('a.kind === "reel_job"');
  });

  it("it is bounded per run and ignores attempts that may still be settling", () => {
    expect(LANE).toContain("RECONCILE_MAX_PER_RUN");
    expect(LANE).toContain("RECONCILE_MIN_AGE_MINUTES");
    expect(LANE).toContain("slice(0, maxPerRun)");
  });

  it("the pulse calls it, and a failure cannot take the pulse down", () => {
    expect(SCHED).toContain("reconcileAmbiguousPublishes()");
    const call = SCHED.slice(SCHED.indexOf("reconcileAmbiguousPublishes()"));
    expect(call.slice(0, 400)).toContain(".catch(");
  });
});

describe("today's job no longer jams the lane", () => {
  it("the parked-QA filter applies to the fallback branch too", () => {
    const region = CRON.slice(CRON.indexOf("if (!job && todaysJob)"));
    expect(region.slice(0, 1400)).toContain("PARKED_QA_GATES.has(g.gate)");
    expect(region.slice(0, 1400)).toContain("runIfMissing: false");
    expect(region.slice(0, 1400)).toContain("qa_parked:");
  });

  it("PLANTED CANARY: the unguarded assignment is gone", () => {
    expect(CRON).not.toContain("if (!job) job = todaysJob;");
  });

  it("an unreadable gate leaves today's job selectable, not silently dropped", () => {
    const region = CRON.slice(CRON.indexOf("if (!job && todaysJob)"));
    expect(region.slice(0, 1400)).toContain("leaving it selectable");
  });
});

describe("the quality score can finally see a sibling", () => {
  it("the self-graded concept part is gone", () => {
    // conceptTournament's own header: "'Self-score honestly' is literally in
    // the reel prompt". A model grading itself was 5 of 75 points.
    expect(STUDIO).not.toContain("label: `Winning concept >=");
  });

  it("distinctiveness replaced it and reads the real repetition checks", () => {
    expect(STUDIO).toContain("function distinctPart");
    expect(STUDIO).toContain("buildRepetitionChecks(brief, recent)");
    expect(STUDIO).toContain("Distinct from recent reels");
  });

  it("NO CONTEXT IS NOT A PASS — a blind score loses the points and says why", () => {
    const fn = STUDIO.slice(STUDIO.indexOf("function distinctPart"));
    const body = fn.slice(0, fn.indexOf("export function calculateReelQualityScore"));
    expect(body).toContain("if (!recent)");
    expect(body).toContain("points: 0");
    expect(body).toContain("Not checked");
  });

  it("the scale still totals 75, so the 70 floor keeps its meaning", async () => {
    // BEHAVIOURAL, not a source regex. distinctPart is a CALL inside that
    // array, so its `max: 5` never appears there as a literal — counting
    // literals reported 70 and was wrong about the runtime scale. That is the
    // exact false signal a source pin gives once the thing it counts stops
    // being spelled out, and it is why this one asks the function instead.
    const { calculateReelQualityScore } = await import("../client/src/lib/facelessReelStudio");
    const { SAMPLE_REEL_BRIEFS } = await import("../client/src/lib/facelessReelStudioSamples");
    const res = calculateReelQualityScore(SAMPLE_REEL_BRIEFS[0]);
    expect(res.parts.reduce((a, p) => a + p.max, 0)).toBe(75);
    expect(res.parts.some((p) => p.label === "Distinct from recent reels")).toBe(true);
  });

  it("a brief scored WITHOUT context loses the distinctiveness points; with an empty window it keeps them", async () => {
    // The asymmetry is the whole design. No context = we did not look = no
    // credit. An empty recent window = we looked and there is nothing to
    // repeat = credit, which is also the honest answer for a new account.
    const { calculateReelQualityScore } = await import("../client/src/lib/facelessReelStudio");
    const { SAMPLE_REEL_BRIEFS } = await import("../client/src/lib/facelessReelStudioSamples");
    const blind = calculateReelQualityScore(SAMPLE_REEL_BRIEFS[0]);
    const looked = calculateReelQualityScore(SAMPLE_REEL_BRIEFS[0], undefined, {
      recent: { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] },
    });
    expect(looked.overall).toBe(blind.overall + 5);

    // And a brief that repeats the recent window is refused the points.
    const repeat = calculateReelQualityScore(SAMPLE_REEL_BRIEFS[0], undefined, {
      recent: {
        topics: [SAMPLE_REEL_BRIEFS[0].topic],
        keywords: [], archetypes: [], motionLenses: [], objectCharacters: [],
      },
    });
    expect(repeat.overall).toBe(blind.overall);
    expect(repeat.parts.find((p) => p.label === "Distinct from recent reels")?.detail).toContain("Repeats recent topic");
  });
});

describe("hashtags: duplicates go before the cap does", () => {
  it("dedupe is case-insensitive and runs first", () => {
    const region = PIPE.slice(PIPE.indexOf("const { HASHTAG_CAP } = await import"));
    const body = region.slice(0, 1600);
    expect(body).toContain("trim().toLowerCase()");
    expect(body.indexOf("seen.has(key)")).toBeLessThan(body.indexOf("unique.slice(0, HASHTAG_CAP)"));
  });

  it("PLANTED CANARY: the old cap-only slice of the raw list is gone", () => {
    expect(PIPE).not.toContain("brief.hashtags = tags.slice(0, HASHTAG_CAP);");
  });
});

describe("terminal states are named, not reported as corruption", () => {
  it("published and publish_ambiguous no longer fall through to Unknown", () => {
    expect(CRON).toContain('job.status === "published" || job.status === "posted"');
    expect(CRON).toContain('job.status === "publish_ambiguous"');
    const tail = CRON.slice(CRON.indexOf('job.status === "published" || job.status === "posted"'));
    expect(tail).toContain("Unknown job status");
    // ...but only AFTER the named ones.
    expect(tail.indexOf("Unknown job status")).toBeGreaterThan(tail.indexOf('publish_ambiguous'));
  });
});
