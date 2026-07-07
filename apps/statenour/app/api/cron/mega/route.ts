import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
// 2026-05-17 follow-up · shared single-source-of-truth job arrays.
// Pre-fix the same MORNING/EVENING/WEEKLY arrays were also defined
// in src/inngest/functions/mega-fanout.ts · drift bait. Now both
// consumers import from src/inngest/jobs.ts.
import { MORNING_JOBS, EVENING_JOBS, WEEKLY_JOBS } from '@/lib/inngest/jobs';

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Mega-cron: Hobby plan only allows 2 daily crons.
// This endpoint fans out to all individual cron jobs in PARALLEL.
// Schedule: morning (5am) and evening (10pm)
// v10.0.195 · was 120 — concurrency-limited fan-out (6 workers)
// means 30 jobs × ~30s avg / 6 workers ≈ 150s expected, with
// AI-heavy outliers up to 240s under load. Vercel Pro caps at
// 300s; 240 leaves 60s headroom for the post-fan-out DB write.
export const maxDuration = 240; // Pro plan

// 2026-05-17 follow-up · CRON_JOBS now reads from the shared arrays
// imported above · pre-fix this was a 200-LOC inline duplicate of
// what now lives in src/inngest/jobs.ts. The Inngest fan-out at
// src/inngest/functions/mega-fanout.ts reads from the same source.
const CRON_JOBS = {
  morning: MORNING_JOBS as readonly string[] as string[],
  evening: EVENING_JOBS as readonly string[] as string[],
  weekly: WEEKLY_JOBS as readonly string[] as string[],
};


export async function GET(req: NextRequest) {
  // v10.0.114 audit fix · the previous 'x-vercel-cron: 1' bypass was
  // a CRITICAL spoofable hole — Vercel does NOT sign that header, so
  // any public HTTP client could trigger this fan-out by adding it.
  // Now require a real Bearer secret (CRON_SECRET or STATENOUR_SYNC_KEY)
  // unconditionally. Vercel cron requests already include the bearer
  // when CRON_SECRET is set in env, so this doesn't break the schedule.
  const authHeader = req.headers.get('authorization') ?? '';
  const hasCronSecret = process.env.CRON_SECRET && safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`);
  const hasSyncKey = process.env.STATENOUR_SYNC_KEY ? safeEqual(authHeader, `Bearer ${process.env.STATENOUR_SYNC_KEY}`) : false;

  if (!hasCronSecret && !hasSyncKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // v10.0.114 audit fix · refuse to fan-out if CRON_SECRET is missing.
  // Pre-fix the children received `Bearer ` (empty) and all 401'd
  // silently — partial-success log made the cron look healthy while
  // every child was a no-op. Better to fail loudly here.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET unset — refusing to fan out with empty Bearer to children' },
      { status: 503 },
    );
  }

  const slot = req.nextUrl.searchParams.get('slot') || 'morning';
  // Internal cron fan-out targets the stable Railway service URL
  // (or APP_BASE_URL). The browser-facing custom domain (bdnick.info)
  // is deliberately NOT used here — service-to-service calls should
  // hit the platform URL, which never changes with a domain swap.
  const baseUrl =
    process.env.APP_BASE_URL?.trim()
    || 'https://statenour-web-production.up.railway.app';

  const now = new Date();
  // v10.0.45 — fixed weekly-block scheduling. Pre-fix
  // `now.getUTCDay() === 0` checked UTC Sunday, but the evening
  // mega slot fires at 10pm ET = 03:00 UTC Monday → getUTCDay
  // returns 1 → `isSunday` was always false → the weekly block
  // (weekly-digest, voice-clone-train, memory-bloat-watch, etc.)
  // has been silently skipped every week since the manifest landed.
  // Sourced via toLocaleDateString in America/New_York (matches the
  // correct pattern already in cron/reflect/route.ts:12).
  const isSunday =
    now.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
    }) === "Sunday";

  let jobs = CRON_JOBS[slot as keyof typeof CRON_JOBS] || CRON_JOBS.morning;

  // Add weekly jobs on Sunday evening
  if (slot === 'evening' && isSunday) {
    jobs = [...jobs, ...CRON_JOBS.weekly];
  }

  // v10.0.114 audit fix · CRON_SECRET is guaranteed set by the guard
  // above, so drop the `|| ''` fallback that masked silent fan-out
  // failures. Children authenticate via the real Bearer.
  const cronSecret = process.env.CRON_SECRET;

  // v10.0.195 · CRITICAL · concurrency limit on AI-using fan-out.
  //
  // Pre-fix · `jobs.map` + `Promise.all` launched ALL 30+ child crons
  // simultaneously. Many (think, consolidate, ai-memory, intelligence,
  // brain-intelligence, conversation-mission-link) hit the same AI
  // provider chain (Venice → Ollama → OpenAI → Anthropic). Live
  // probe (24h window) found:
  //   ai-memory               50% failure rate (22/44 emergency)
  //   thinking-engine         39% failure rate (14/36)
  //   memory-consolidation    75% failure rate ( 3/ 4)
  // All concentrated 02-04 UTC = mega-evening fan-out window.
  // Failure durations averaged 133 SECONDS — exhausting all 4
  // providers serially because rate limits tripped on the
  // simultaneous burst.
  //
  // Fix · sliding-window concurrency limit. Six workers pull from
  // the queue. Fast crons (DB queries, cleanup) finish in <1s and
  // free their slot immediately; AI-heavy crons (~30-90s) hold a
  // slot longer but never more than 6 hit providers at once. This
  // smears the rate-limit pressure over time without serializing
  // the cleanup work.
  //
  // Six chosen because: 4 providers in chain × ~1.5 typical concurrent
  // requests per provider ≈ 6. Empirical floor that keeps Venice
  // out of 429s. If Venice rate-limit headers change, tune this.
  type JobResult = { path: string; status: number | string; duration: number };
  async function dispatch(path: string): Promise<JobResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cronSecret}` },
        // v10.0.178 · 90s per child (mega's maxDuration is 240s post-
        // v10.0.195 bump; child timeout × concurrency caps the worst
        // case at 90s × ceil(jobs/6) which fits comfortably).
        signal: AbortSignal.timeout(90000),
      });
      return { path, status: res.status, duration: Date.now() - start };
    } catch (err) {
      return { path, status: `error: ${(err as Error).message}`, duration: Date.now() - start };
    }
  }

  // v10.0.201 · use the shared lib/utils/concurrent helper. The
  // sliding-window pattern that v10.0.195 inlined here got promoted
  // to a reusable utility so future fan-outs (autonomous engine,
  // bulk imports, etc.) share the same implementation.
  const { withConcurrency } = await import("@/lib/utils/concurrent");
  const results: JobResult[] = await withConcurrency(jobs, dispatch, 6);

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const failures = results.filter(r => typeof r.status === 'string' || (typeof r.status === 'number' && r.status >= 400));

  // Apr 27 — log the mega-cron itself so /system/cron-diagnostics
  // doesn't flag it as silent. The child crons each write their own
  // CronJobLog rows via apiHandler; this row is the slot-level
  // heartbeat (jobName matches what diagnostics expects:
  // "mega" for morning, "mega-evening" for evening).
  const wallDuration = Date.now() - now.getTime();
  const jobName = slot === 'evening' ? 'mega-evening' : 'mega';
  const status = failures.length === 0 ? 'success' : 'partial';
  // v10.0.178 · capture which children failed. Pre-fix the audit
  // showed mega/mega-evening had ZERO success rows in 24h, only
  // "partial" — and the failure detail was discarded before write.
  // The error column is now populated with a compact summary so
  // diagnostics can name the culprit instead of saying "something".
  const errorSummary =
    failures.length > 0
      ? JSON.stringify(
          failures.slice(0, 5).map((f) => ({
            path: f.path,
            status: f.status,
            ms: f.duration,
          })),
        ).slice(0, 1900) // CronJobLog.error is Text; stay well under page size
      : null;
  // Fire-and-forget so a logger failure never breaks the cron run.
  prisma.cronJobLog.create({
    data: { jobName, status, duration: wallDuration, error: errorSummary },
  }).catch(() => {
    // intentionally swallow — diagnostics will surface drift via
    // jobsLoggedLast48h count if logging itself is broken
  });

  return NextResponse.json({
    ok: true,
    slot,
    isSunday,
    jobsRun: results.length,
    failures: failures.length,
    totalDurationMs: totalDuration,
    results,
    timestamp: now.toISOString(),
  });
}
