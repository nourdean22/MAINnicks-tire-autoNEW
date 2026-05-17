import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';

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

// Apr 17 separation pass: 12 business crons retired
// (customer-profiles, estimate-escalation, follow-up-reminders,
//  quote-expiry, review-fetch, revenue-aging-alert, scraper-watchdog,
//  staffing, tire-sync, weather-campaigns, winback, projections).
// Shop operations live in nickstire.org/admin.
const CRON_JOBS = {
  morning: [
    // v10.0.529.56 · device-sync + device-health removed · subsystem
    // retired v529.6 · route files deleted v529.56.
    '/api/cron/learn',
    '/api/cron/stale-tasks',
    '/api/cron/brain-cycle',
    // Apr 27 — notification-sender removed. NotificationQueue model
    // was retired from prisma/schema.prisma but the cron + schedule
    // stayed wired. Every run threw "Cannot read properties of
    // undefined (reading 'findMany')" — 26 failures in 24h, painted
    // the orb red. Killed the schedule + the mega-fanout entry; the
    // route handler stays as a no-op that returns 410 Gone for any
    // stragglers.
    '/api/cron/journal-checkin?slot=morning',
    // morning-brief retired Apr 17 — TodoDesk + BottomPulseTicker replace it
    '/api/cron/embed-backfill', // Auto-backfill memory embeddings (10/run, no-op when done)
    // v8.7.1 hotfix — folded crons (Vercel Pro 40-cap):
    '/api/cron/health-digest',         // 8am UTC = 4am ET — morning system snapshot
    '/api/cron/cost-regression',       // 7d-vs-7d AI spend delta
    '/api/cron/schema-drift-watch',    // sentinel daily roll-up
    // v8.7.2 consolidation pass 2:
    '/api/cron/knowledge-sync',        // Drive/Notion/etc. daily re-sync
    '/api/cron/prediction-streaks',    // F4 daily streaks roll-up
    // v10.0.346 · synthetic chat canary (Cat 8 prevention) · folded
    // into mega-morning so it runs once daily before the operator
    // opens chat. Fires the model+sanitizer+critic stack with a
    // deterministic prompt · writes glitch_capture brain memory if
    // the probe fails. ~$0.10/year cost. Per docs/glitch-taxonomy.md.
    '/api/cron/canary-chat',
    // v10.0.524.6 · morning-brief · folded · runs in the morning
    // fanout · operator-visible 7am brief via Telegram (drift state
    // + top task + open tasks + aging commitments + calendar). The
    // route is idempotent per-day so the mega-morning timing of
    // ~5am ET still gives the brief ahead of the operator's day.
    '/api/cron/morning-brief',
    // v10.0.526 · Arc C · F1 · revenue-decision · folded. Pulls
    // nickstire signals (read-only) → matches wisdom corpus → drafts
    // 1-3 concrete revenue moves via aiChat → Telegram approval push.
    // Idempotent per ET-day via BrainMemory(category='revenue_move').
    // Bridge-down behavior: logs and exits cleanly · no Telegram noise.
    // NEVER writes to nickstire (statenour-side read-only boundary).
    '/api/cron/revenue-decision',
    // v10.0.528 · Arc B · F3 · decision-replay · folded into mega-morning.
    // Picks 5 due MasteryDecisions (≥30d), gathers 30d outcome signals,
    // matches ONE wisdom citation, upserts decision_replay_due BrainMemory
    // rows for the morning-brief consumer (which reads + marks consumed in
    // the same pass). Idempotent per decision via DecisionReplay row +
    // BrainMemory upsert keyed by decisionId.
    '/api/cron/decision-replay',
    // v10.0.529.32 · Arc B · F4 · persona-drift · folded into mega-morning.
    // Scans the last 28h of assistant chat replies (cap 60), compares each
    // embedding to the operator's 8-axis identity_snapshot persona vector,
    // logs drift events (similarity < 0.6) to BrainMemory(category=
    // "persona_drift") for surfacing via the SituationCard meta-aggregator.
    // Detection-only · regeneration deliberately Phase 2. Idempotent per
    // message via sha1(messageId) upsert key.
    '/api/cron/persona-drift',
    // v10.0.529.80 · Wave 24 · #3 · orphan-task-nudge · catches DONE
    // tasks that fired ZERO auto-learn engine and surfaces them to
    // /brain so the operator can tag them.
    '/api/cron/orphan-task-nudge',
    // v10.0.529.82 · Wave 26 · B1 · task-resurface · flips WAITING →
    // READY for tasks whose snoozedUntil ≤ now. Closes the snooze
    // broken-promise bug · runs before the operator opens /tasks.
    '/api/cron/task-resurface',
    // 2026-05-17 · CP-coherency · 4 orphans folded into the morning
    // fan-out · they had route handlers + registry entries with their
    // own UTC schedules (refresh-identity 04:30, auto-linker 04:00,
    // backlog-triage 07:00, ingest-drive Sun+Wed 02:30) but no caller —
    // Vercel cron limit pushed every per-cron schedule onto the mega
    // slots long ago and these 4 just never got folded. /system/crons
    // reported them as silent (0 success14d, 0 fail14d). All daily-ish
    // schedules collapse fine into mega-morning (9am UTC) · the
    // Sunday-only ones (extract-skills, pin-hygiene) live in the
    // weekly array further down + only fire on the Sun mega-evening.
    '/api/cron/refresh-identity',
    '/api/cron/auto-linker',
    '/api/cron/backlog-triage',
    '/api/cron/ingest-drive',
    // 2026-05-17 · the registry has both of these marked mode="folded"
    // with foldedInto="mega" (per config/crons.ts), but they were never
    // actually wired into the morning array · annotation drifted from
    // implementation. token-age-watch alerts Telegram for tokens about
    // to expire — runs once daily, idempotent per-token-per-day via
    // BrainMemory category=token_age_pushed.
    '/api/cron/token-age-watch',
  ],
  evening: [
    // v10.0.529.56 · device-sync removed (subsystem retired v529.6 ·
    // route deleted v529.56).
    '/api/cron/reflect',
    '/api/cron/predict',
    '/api/cron/think',
    '/api/cron/consolidate',
    '/api/cron/drift-check',
    '/api/cron/daily-report',
    '/api/cron/data-cleanup',
    '/api/cron/journal-checkin?slot=evening',
    '/api/cron/intelligence',
    '/api/cron/brain-intelligence', // v7: outcome tracking, wisdom distillation, blind spots, learning journal
    '/api/cron/embed-backfill', // Backfill memory embeddings (30/run, no-op when done)
    // v8.7.1 hotfix — folded crons (Vercel Pro 40-cap):
    '/api/cron/chat-message-backfill', // self-terminating finite migration
    '/api/cron/image-rot-scan',        // recent generated-image audit
    '/api/cron/semantic-dedup',        // ~50ms vector-similarity dedup pass
    '/api/cron/pgvector-backfill',     // self-terminating native vector migration
    // v8.7.2 consolidation pass 2:
    '/api/cron/auto-calibrate',        // belief recalibration nightly
    '/api/cron/correlation-alarm',     // F2 cross-domain correlation diff
    // v10.0.529.79 · Wave 23 · auto-learn upgrades
    '/api/cron/mastery-decay',         // -0.05/day on axes with no DONE today
    '/api/cron/pattern-cluster',       // cluster last-7d insights by axis
    // v8.8 storage-quota watcher:
    '/api/cron/storage-quota-watch',   // daily pg_relation_size probe + alerts
    // v8.9 audit retention TTL:
    '/api/cron/audit-retention',       // 90d hot window, 30d for creates
    // v8.10 mass-creation spike detector:
    '/api/cron/creation-spike-detect', // catches chat-interceptor loops + runaway imports
    // v8.11 mass-update spike detector:
    '/api/cron/update-spike-detect',   // catches useEffect storms + migration re-touch bugs
    // v8.11 brain-bus health probe:
    '/api/cron/brain-bus-probe',       // round-trip NOTIFY heartbeat
    // v8.11 stale-conversation auto-archive:
    '/api/cron/stale-conversation-archive', // archive idle >60d convs
    '/api/cron/conversation-mission-link', // link embedded chat archives to missions
    '/api/cron/embed-cleanup', // v10.0.192 · drop orphan vector_embeddings (deleted/archived sources)
    // v8.23 brain-bus consumer activator:
    '/api/cron/brain-bus-consume',     // 50s LISTEN window, flushes counters
    // v10.0.370 · agent-evaluation harness · runs gold prompts nightly,
    // detects regressions vs yesterday, stores trend in eval_run brain
    '/api/cron/agent-eval',
    // v10.0.371 · extract factual domain knowledge from yesterday's
    // assistant replies · adversarial verification · stores high-conf
    // facts as category=domain_knowledge for the semantic-kind recall
    '/api/cron/extract-knowledge',
    // v10.0.411 · brain feedback loop · improve-agent (axis-failure
    // hypotheses) + wisdom-evolution (stale/redundant/low-trust) · folds
    // into evening so morning insight panel reflects fresh signal
    '/api/cron/brain-feedback-loop',
    // v10.0.524.6 · eval-regression · folded into mega-evening. Runs
    // the 35 golden Q&A through the live chat pipeline, scores against
    // expected criteria, writes BrainMemory(eval_result), Telegram-
    // alerts if passRate<80%. Sibling of agent-eval (different shape ·
    // golden-set regression vs continuous evaluation).
    '/api/cron/eval-regression',
    // v10.0.526 · Arc A · F2 · cost-slo-check · folded into mega-evening.
    // Linear 24h burn-rate forecast over AiGeneration · Telegram alert
    // when forecast > DAILY_AI_BUDGET_CENTS · 1.2. Idempotent per ET-day.
    '/api/cron/cost-slo-check',
    // v10.0.526 · Arc A · F3 · vapi-latency-sync · folded into mega-evening.
    // Pulls last 24h of VAPI calls · derives end-to-end latency · writes
    // VoiceLatencyEvent rows (deduped). Telegram alerts when p50 breach
    // streak ≥ 3 consecutive call-days · idempotent per UTC date.
    '/api/cron/vapi-latency-sync',
    // v10.0.526 · Arc A · F5 · os-snapshot · folded into mega-evening.
    // Snapshots codebase metrics (routes/crons/tools/LOC/tests/monster
    // files/`any`/console) to SystemMetric. Compares to 7-day baseline;
    // Telegram-alerts on warn/critical regressions. Idempotent per-day.
    '/api/cron/os-snapshot',
    // v10.0.526 · Arc B · F6 · anticipate · folded into mega-evening.
    // Drafts the 3 questions the operator is most likely to ask
    // tomorrow + precomputes answers via the in-process chat pipeline.
    // Morning-brief surfaces the predictions; chat route injects the
    // cached take when the operator's actual query matches >0.85
    // cosine. BrainMemory(category=anticipated_question) · idempotent
    // per-day (6h skip window). ~30-45s typical, hard 60s cap.
    '/api/cron/anticipate',
    // v10.0.526 · Arc C · F7 · monthly-location-rank · folded into
    // mega-evening. Pure-function ranker over data/location-candidates.json.
    // The handler gates on 1st-of-ET-month internally; on every other
    // day it returns immediately (cheap). File-missing = structured
    // no-op so the cron dashboard stays green while the operator has
    // not pre-populated the candidate file.
    '/api/cron/monthly-location-rank',
    // 2026-05-17 · registry marked mode="folded" foldedInto="mega-evening"
    // (per config/crons.ts) but never actually wired here · annotation
    // drifted from implementation. semantic-link runs KNN cosine over
    // recent high-confidence brain memories + persists top-3 neighbors
    // as BrainMemory category=semantic_edge. Pairs with the rule-driven
    // auto-linker (morning slot) for coverage.
    '/api/cron/semantic-link',
  ],
  weekly: [
    '/api/cron/weekly-digest',
    '/api/cron/weekly-review',
    // v8.7.1 hotfix — folded weekly cron:
    '/api/cron/memory-bloat-watch', // weekly bloat check + dedup trigger
    // v8.7.2 consolidation pass 2 — weekly fold:
    '/api/cron/voice-clone-train',  // mines last week's Fireflies for voice fingerprint
    // v10.0.155 — folded weekly hygiene:
    '/api/cron/inbox-janitor',      // soft-archive empty Inbox catch-alls (30d cold)
    // v10.0.526 · Arc B Feature 1 · weekly preference self-tune. Reads
    // last 7d of chat_feedback audit events, scores replies on 8 style
    // axes (density · creativity · skepticism · directness · humor ·
    // jargon · structure · urgency), applies weighted decay (rate 0.1)
    // to OperatorPreference.voiceToneBoundaries.preferenceVector.
    // System prompt picks up the new vector on the next chat turn via
    // buildSystemPromptAddendum (lib/brain/preference-inference.ts).
    '/api/cron/preference-tune',
    // v10.0.526 · Arc C Feature 3 · weekly pricing-strategy advisor.
    // Reads 30d ALG win-rate per service category from nickstire
    // bridge · flags outliers ≥20pp below fleet median · pulls
    // competitor signal via multiSourceSearch (24h cache) · drafts
    // 3 operator-approval-only experiments per outlier citing
    // Munger/Buffett wisdoms by name. Telegram-alerts only when
    // outliers found. ADVISORY ONLY — never mutates pricing.
    '/api/cron/pricing-advisor',
    // 2026-05-17 · CP-coherency · 2 weekly orphans folded · had route
    // handlers + registry entries (extract-skills Sun 03:00 UTC,
    // pin-hygiene Sun 06:00 UTC) but no caller. /system/crons reported
    // them silent. Folded here so they fire once on Sunday-evening
    // mega run (per `if (slot === 'evening' && isSunday)` branch
    // below). Extract-skills: harvests skills from the week's DONE
    // tasks · pin-hygiene: prunes stale pins.
    '/api/cron/extract-skills',
    '/api/cron/pin-hygiene',
  ],
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
  // CP5 (Railway migration) · prefer APP_BASE_URL (Railway-style)
  // · fall back to legacy Vercel env · final fallback to operator domain.
  // Backward-compatible during dual-write window · works on both platforms.
  const baseUrl =
    process.env.APP_BASE_URL?.trim()
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://autonicks.com');

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
