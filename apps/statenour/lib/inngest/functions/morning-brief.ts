/**
 * morning-brief · Wave-200 Phase 5 (2026-05-17)
 *
 * Operator-facing morning brief workflow · runs daily at 10:00 UTC
 * (6am ET) so the brief lands when the operator's first cup of coffee
 * does. Composes the brief, sends Web Push, optionally generates a
 * Cartesia-spoken audio file the operator can tap-and-listen to.
 *
 * Relationship to existing path (UPDATED 2026-06-10 · evolution audit):
 *   · `/api/cron/morning-brief` (the legacy Telegram producer) was
 *     DELETED in Wave AE (2026-05-28) and was never in MORNING_JOBS —
 *     so this function is now the ONLY producer. composeBrief()
 *     persists the durable BrainMemory row itself (it previously
 *     assumed the legacy cron wrote it → readMorningBrief() returned
 *     ready:false every day in prod).
 *   · Delivery channels:
 *       (a) Web Push — silent landing on the operator's phone
 *       (b) Cartesia spoken audio — pre-rendered today.mp3 for the
 *           voice-tap-to-play flow on the PWA at /voice
 *
 *   · Idempotency: reuses BrainMemory(category="morning_brief") for
 *     today when present; otherwise composes via buildMorningBrief()
 *     and upserts the row.
 *
 *   · Failure semantics: each step retries independently. If Web Push
 *     fails because VAPID isn't set up, that step errors but the
 *     compose step's data still lives in BrainMemory.
 *
 * Why 10:00 UTC (6am ET):
 *   · The legacy cron at 9:00 UTC (5am ET) finishes BrainMemory write
 *     by ~9:05 UTC · this fires at 10:00 UTC with 55min of slack
 *   · 6am ET lands the push notification right when the operator
 *     wakes and reaches for the phone
 *   · The Cartesia file is fresh — no chance of stale "yesterday" data
 *
 * See:
 *   · docs/adr/0007-morning-brief-multichannel.md (forthcoming)
 *   · apps/statenour/lib/services/morning-brief.ts (composer)
 *   · apps/statenour/lib/notifications/push.ts (Web Push surface)
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";
import { GOALS_HEADER, NOT_SEEING_HEADER } from "@/lib/services/brief-private";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("inngest/morning-brief");
const inngest = getInngest();

interface ComposedBrief {
  date: string;
  text: string;
  /** Number of payload sections present · diagnostic only. */
  sectionCount: number;
}

/**
 * Step 1 · compose the brief. Reads today's row from BrainMemory if
 * the legacy cron already wrote it; otherwise calls buildMorningBrief
 * directly so we still deliver something.
 */
async function composeBrief(): Promise<ComposedBrief> {
  const { prisma } = await import("@/lib/prisma");
  // 2026-06-10 · evolution-audit fix · use the READER's date convention
  // (America/New_York, en-CA = YYYY-MM-DD — see lib/services/
  // morning-brief-read.ts) so the row this function writes is the row
  // readMorningBrief() looks up. Identical at the 10:00 UTC fire time;
  // correct for manual re-runs in the 00:00-05:00 UTC window where the
  // UTC date is already tomorrow.
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const existing = await prisma.brainMemory.findFirst({
    where: { category: "morning_brief", key: today },
    select: { content: true, metadata: true },
  });

  if (existing?.content) {
    const payload =
      (existing.metadata as Record<string, unknown> | null) ?? {};
    return {
      date: today,
      text: existing.content,
      sectionCount: Object.keys(payload).length,
    };
  }

  // Compose from scratch. 2026-06-10 · evolution-audit fix · the header
  // comment's "legacy cron writes the durable row, THAT PATH STAYS" went
  // stale: Wave AE (2026-05-28) deleted /api/cron/morning-brief and it
  // was never in MORNING_JOBS — so NOTHING wrote the durable row and
  // readMorningBrief() returned ready:false every day (confirmed live
  // 2026-06-10: ready:false · composedAt:null) while push/audio kept
  // working off this in-memory fallback. This function is now the
  // durable producer: persist the row so /voice, the home surfaces, and
  // every other reader see the brief.
  log.warn("brief_not_yet_persisted", {
    date: today,
    action: "compose-direct",
  });
  const { buildMorningBrief } = await import("@/lib/services/morning-brief");
  const brief = await buildMorningBrief();
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: "morning_brief", key: today } },
      create: {
        category: "morning_brief",
        key: today,
        content: brief.text,
        confidence: 1.0,
        source: "inngest/morning-brief",
        metadata: brief.payload as never,
      },
      update: {
        content: brief.text,
        metadata: brief.payload as never,
      },
    })
    .catch((err) => {
      // Persist failure must not kill push/audio delivery — log + continue.
      log.warn("brief_persist_failed", {
        date: today,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    });
  return {
    date: today,
    text: brief.text,
    sectionCount: Object.keys(brief.payload).length,
  };
}

/**
 * Pure push-body shaper · exported for tests. 2026-07-28 cron-truth
 * audit: the composer emits HTML (`<b>Drift:</b> …`) and the AUDIO path
 * strips tags before speaking — but the push path didn't, so the very
 * first delivery (post Inngest re-sync) would have shown literal
 * `<b>` tags on the phone. Strip FIRST, then trim: slicing before
 * stripping could also cut a tag in half mid-notification.
 */
export function pushBodyFromBrief(text: string, checkInsDue = 0, weeklyReviewReady = false): string {
  // The weekly gap and Monday Goals sections are private: a lock screen never shows any of
  // them (PR #3221 review; goals-system W2). Cut at whichever comes first.
  const cuts = [NOT_SEEING_HEADER, GOALS_HEADER].map((h) => text.indexOf(h)).filter((i) => i >= 0);
  const cut = cuts.length > 0 ? Math.min(...cuts) : -1;
  const body = (cut >= 0 ? text.slice(0, cut) : text)
    .replace(/<[^>]+>/g, "")
    .replace(/\n+/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  // R2a (2026-11-03): goals due a check-in, as a COUNT after the cut; a title never goes on a
  // lock screen. Then "Weekly review is ready" (claimed once per ISO week by deliverMorningBrief). Room
  // is kept for the whole tail so the 200-char cap cannot cut it off.
  const tail = [
    checkInsDue > 0 ? `${checkInsDue} ${checkInsDue === 1 ? "goal needs" : "goals need"} a check-in` : "",
    weeklyReviewReady ? "Weekly review is ready" : "",
  ].filter(Boolean).join(" · ");
  if (!tail) return body.slice(0, 200);
  const head = body.slice(0, 200 - tail.length - 3).replace(/[\s·]+$/, "");
  return head ? `${head} · ${tail}` : tail;
}

/** "YYYY-WNN" of a Monday "YYYY-MM-DD", in pure date math (no clock, no zone). */
function isoWeekOfMonday(monday: string): string {
  const thursday = new Date(`${monday}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3); // the week's Thursday names its ISO year
  const year = thursday.getUTCFullYear();
  const dayOfYear = Math.round((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000);
  return `${year}-W${String(Math.floor(dayOfYear / 7) + 1).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * R2a manager ruling (2026-11-03) · claim the "Weekly review is ready" line for the first brief after a
 * review is written. The weekly-review cron runs Sunday ~22:00-23:00 ET (inside sendPush's quiet hours)
 * and keys its row weekly:<that week's Monday>, so a Monday brief looks for this week's Monday or the
 * one just ended; the newest wins. The claim is a weekly_review_nudge create keyed by the review's ISO
 * week (claim-before-act: P2002 = an earlier brief this week took it, so no line). Any read or create
 * failure = no line. The caller releases the claim when the brief reached nobody.
 */
async function claimWeeklyReviewLine(today: string): Promise<{ id: string; week: string } | null> {
  const thisMonday = addDaysYmd(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.brainMemory.findMany({
      where: { category: "weekly_review", key: { in: [`weekly:${thisMonday}`, `weekly:${addDaysYmd(thisMonday, -7)}`] }, deletedAt: null },
      select: { key: true },
    });
    if (rows.length === 0) return null;
    const weekStart = rows.map((r) => r.key.slice("weekly:".length)).sort().at(-1)!;
    const week = isoWeekOfMonday(weekStart);
    // brain-memory-direct-write: a once-per-week send marker (the claim), not a semantic memory. No
    // expiresAt and confidence 1.0, so pruneNoise and data-cleanup never reach it; excluded from merge.
    const row = await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.WEEKLY_REVIEW_NUDGE,
        key: week,
        content: `Weekly review is ready line, morning brief of ${today}`,
        confidence: 1.0,
        source: "inngest/morning-brief",
        metadata: { weekStart, briefDate: today } as never,
      },
      select: { id: true },
    });
    return { id: row.id, week };
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2002") return null;
    log.warn("weekly_review_claim_failed", { err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  }
}

/** Release a claim whose brief reached nobody, by its own id, so the next brief can carry the line. */
async function releaseWeeklyReviewLine(claim: { id: string; week: string }): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  await prisma.brainMemory
    .deleteMany({ where: { id: claim.id, category: BRAIN_CATEGORIES.WEEKLY_REVIEW_NUDGE, key: claim.week } })
    .catch((err) => log.error("weekly_review_release_failed", { week: claim.week, err: err instanceof Error ? err.message : String(err) }));
}

/** Active goals past their check-in cadence (lib/brain/goal-pace.ts), the read Home's
 *  loadGoalCheckInDue makes. null = the read failed: no line, never a "0". */
async function countCheckInsDue(now: number = Date.now()): Promise<number | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const { checkInOverdueDays } = await import("@/lib/brain/goal-pace");
    const goals = await prisma.lifeGoal.findMany({
      where: { deletedAt: null, status: "active" },
      take: 50,
      select: { id: true, horizon: true, createdAt: true },
    });
    if (goals.length === 0) return 0;
    const events = await prisma.goalEvent.findMany({
      where: { goalId: { in: goals.map((g) => g.id) }, kind: "check_in" },
      orderBy: { createdAt: "desc" },
      distinct: ["goalId"],
      select: { goalId: true, createdAt: true },
    });
    const last = new Map<string, Date>();
    for (const e of events) if (!last.has(e.goalId)) last.set(e.goalId, e.createdAt);
    return goals.filter((g) => checkInOverdueDays({ ...g, lastCheckInAt: last.get(g.id) ?? null }, now) >= 0).length;
  } catch (err) {
    log.warn("check_in_count_failed", { err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  }
}

/**
 * Step 2 · send Web Push to the operator's subscribed devices.
 * No-ops if no subscriptions or VAPID_PRIVATE_KEY unset.
 *
 * `chatSeed` lets the operator tap the notification and land in chat
 * with the brief pre-quoted · "walk me through this" works out of
 * the box.
 */
/** Wave-3 (2026-07-29) · when web push reached zero devices, the brief
 *  still MUST reach the phone — Telegram is the confirmed-working lane.
 *  The message names the cause so the operator can re-enable push. */
async function briefTelegramFallback(
  brief: ComposedBrief,
  push: { sent: number; failed: number },
  ledgerId: string | null,
  checkInsDue = 0,
  weeklyReviewReady = false,
): Promise<{ status: "skipped_push_ok" | "sent" | "failed" }> {
  if (push.sent > 0) return { status: "skipped_push_ok" };
  const { sendTelegram, sendTelegramWithButtons } = await import("@/lib/services/telegram");
  const { ratingTelegramButtons } = await import("@/lib/services/outcome-rating-affordance");
  const reason =
    push.failed > 0
      ? "web push failed on every registered device"
      : "no live web-push subscription";
  const text =
    `🌅 Morning brief (${brief.date}) — delivered via Telegram because ${reason}. ` +
    `Re-enable push in Settings → Notifications.\n\n${pushBodyFromBrief(brief.text, checkInsDue, weeklyReviewReady)}\n\n` +
    `There is no brief page. Ask Nick on the home screen for the full brief: https://bdnick.info/`;
  // 2026-10-02 · this is the path the brief takes when push reaches no device,
  // and it was the one delivery of a ledgered brief with no way to rate it.
  // Same owner as every other rateable push: ratingTelegramButtons.
  const buttons = ratingTelegramButtons(ledgerId);
  const ok = buttons
    ? await sendTelegramWithButtons(text, buttons).then((r) => r.ok).catch(() => false)
    : await sendTelegram(text).catch(() => false);
  return { status: ok ? "sent" : "failed" };
}

async function sendBriefPush(brief: ComposedBrief, checkInsDue: number, weeklyReviewReady: boolean): Promise<{
  sent: number;
  failed: number;
  /** The ledger row the rating buttons point at; null when ledgering failed. */
  ledgerId: string | null;
}> {
  const { sendPush } = await import("@/lib/notifications/push");
  const { ratingPushActions } = await import("@/lib/services/outcome-rating-affordance");

  // LEDGER FIRST, THEN SEND (2026-09-18). The button has to carry a ledger id,
  // so the row must exist before the notification does — the same order
  // inversion sendRatablePush made for the Telegram pushes in #2424.
  //
  // WHY THE BRIEF WAS UNRATEABLE UNTIL NOW: #2424 gave proactive pushes their
  // Telegram buttons, but the brief's PRIMARY surface is web push, which had no
  // affordance at all. ~90 daily_brief rows in intelligence_outcomes carried
  // zero labels — not operator neglect; nothing anywhere could express a
  // verdict on them.
  //
  // FAIL-SOFT: no ledger id means no buttons, but the brief still ships. A
  // brief the operator cannot rate beats a brief they never get.
  let ledgerId: string | null = null;
  try {
    const { recordShown } = await import("@/lib/services/outcome-ledger");
    ledgerId = await recordShown({
      kind: "daily_brief",
      sourceEngine: "morning-brief",
      summary: brief.text,
      // Pre-send guess; deliverMorningBrief corrects it once delivery
      // is known (web-push, or telegram-fallback when no device was reached).
      shownSurface: "web-push",
    });
  } catch {
    // recordShown logs its own failure; the push path must never break on
    // bookkeeping.
  }

  const result = await sendPush({
    title: "Morning brief",
    // Trim aggressively · push body has a hard limit ~120 chars on
    // most platforms before the OS truncates with "…".
    body: pushBodyFromBrief(brief.text, checkInsDue, weeklyReviewReady),
    level: "high",
    // `chatSeed` below OVERRIDES this, so it is the no-seed fallback only. It
    // pointed at the retired /command route (which redirects home — a hop, not
    // a break, but misleading). There is no brief page; home is the landing surface.
    url: "/",
    tag: `morning-brief-${brief.date}`,
    // Rating buttons, only when there is a row for them to land on. The service
    // worker routes an `oc_*` action to POST /api/outcomes/rate and
    // deliberately does NOT navigate — opening the app on a 👍 would punish the
    // operator for answering.
    ...ratingPushActions(ledgerId),
    chatSeed: {
      prompt: `morning brief for ${brief.date} just landed · walk me through the highest-leverage item and what to do about it today`,
      suggKind: "morning-brief",
      suggId: brief.date,
    },
  });
  return { ...result, ledgerId };
}

/**
 * Deliver the composed brief: web push first, Telegram when no device took it.
 * Runs straight after compose. (Until 2026-10-18 this waited 35 minutes for the
 * daily intelligence brief to fold it into one push; that brief was stopped, so
 * the wait and the hand-off row are gone.)
 *
 * The ledger row is written by sendBriefPush with a pre-send guess; the real
 * surface is set here, only once delivery is KNOWN: "web-push" when a device
 * took it, "telegram-fallback" only when the fallback really sent. When both
 * fail the surface is left alone (the brief reached nobody) and the status is
 * "undelivered". It is returned, not thrown: the step is memoized and the
 * function retries, so a throw would re-send; the orchestrator declares the run
 * `partial` instead, which cron-lifecycle records and the Owner Panel reads.
 */
export async function deliverMorningBrief(brief: ComposedBrief): Promise<{
  status: "sent" | "telegram_fallback" | "undelivered";
  push: { sent: number; failed: number };
}> {
  const checkInsDue = (await countCheckInsDue()) ?? 0;
  const review = await claimWeeklyReviewLine(brief.date);
  let push: Awaited<ReturnType<typeof sendBriefPush>>;
  try {
    push = await sendBriefPush(brief, checkInsDue, review !== null);
  } catch (err) {
    // The step retries on a throw; give the line back so the retry can claim it again.
    if (review) await releaseWeeklyReviewLine(review);
    throw err;
  }
  const counts = { sent: push.sent, failed: push.failed };
  const { setShownSurface } = await import("@/lib/services/outcome-ledger");
  if (push.sent > 0) {
    if (push.ledgerId) await setShownSurface(push.ledgerId, "web-push");
    return { status: "sent", push: counts };
  }
  const fallback = await briefTelegramFallback(brief, push, push.ledgerId, checkInsDue, review !== null);
  if (fallback.status === "sent") {
    if (push.ledgerId) await setShownSurface(push.ledgerId, "telegram-fallback");
    return { status: "telegram_fallback", push: counts };
  }
  // The brief reached nobody, so the review line did not either: release the claim.
  if (review) await releaseWeeklyReviewLine(review);
  const { logError } = await import("@/lib/utils/error-log");
  logError(
    "inngest/morning-brief",
    new Error("morning brief reached no device and the Telegram fallback failed"),
    { date: brief.date, pushFailed: push.failed, ledgerId: push.ledgerId },
  );
  return { status: "undelivered", push: counts };
}
/**
 * Step 3 · generate a Cartesia-TTS audio file for the brief and
 * cache it at the operator-facing endpoint. Graceful: skipped if
 * CARTESIA_API_KEY missing.
 *
 * The cache write itself targets the `MorningBriefAudio` table — we
 * use BrainMemory(category="morning_brief_audio") with the date as
 * key + the audio bytes stored as a base64-encoded content. The
 * `/api/morning-brief/today.mp3` endpoint reads from this row.
 *
 * Limit: Cartesia rejects payloads > ~1500 chars per request. The
 * brief is intentionally tight (~15 lines, < 1500 chars typically)
 * so this is rarely a problem. If it ever is, we'd chunk + concat.
 */
async function generateBriefAudio(brief: ComposedBrief): Promise<{
  status: "generated" | "skipped" | "failed";
  reason?: string;
  bytes?: number;
}> {
  const apiKey = (process.env.CARTESIA_API_KEY ?? "").trim();
  const voiceId = (
    process.env.CARTESIA_VOICE_ID ?? "78fef94e-30c8-4c8a-9b91-7c00aef60af7"
  ).trim();

  if (!apiKey) {
    return { status: "skipped", reason: "CARTESIA_API_KEY unset" };
  }

  // Strip HTML the brief composer emits (`<b>Drift:</b> ...`) before
  // sending to TTS. Cartesia would speak the tags otherwise.
  const spokenText = brief.text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);

  if (spokenText.length < 10) {
    return { status: "skipped", reason: "brief too short to speak" };
  }

  try {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-11-13",
      },
      body: JSON.stringify({
        model_id: "sonic-2",
        transcript: spokenText,
        voice: { mode: "id", id: voiceId },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 2026-05-17 follow-up · transient 5xx (502/503/504/408/429) should
      // THROW so Inngest's per-step retry kicks in instead of looking
      // "successful with failed-status" to the platform · permanent
      // (4xx auth · payload too large) returns failed cleanly.
      if ([408, 429, 502, 503, 504].includes(res.status)) {
        throw new Error(
          `cartesia_transient_${res.status} · ${text.slice(0, 200)}`,
        );
      }
      return {
        status: "failed",
        reason: `cartesia_http_${res.status} · ${text.slice(0, 200)}`,
      };
    }

    const audio = Buffer.from(await res.arrayBuffer());
    const base64 = audio.toString("base64");

    const { prisma } = await import("@/lib/prisma");
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: "morning_brief_audio", key: brief.date },
      },
      create: {
        category: "morning_brief_audio",
        key: brief.date,
        content: base64,
        confidence: 1.0,
        source: "inngest/morning-brief",
        metadata: { bytes: audio.length, mime: "audio/mpeg" },
      },
      update: {
        content: base64,
        metadata: { bytes: audio.length, mime: "audio/mpeg" },
      },
    });

    return { status: "generated", bytes: audio.length };
  } catch (err) {
    // 2026-05-17 follow-up · timeouts + network errors throw to retry.
    // Anything else returns failed for one-shot diagnostic visibility
    // (e.g. payload-too-large is permanent · retrying is wasteful).
    const message = err instanceof Error ? err.message : String(err);
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "TypeError" || /transient/i.test(message))
    ) {
      throw err;
    }
    return { status: "failed", reason: message.slice(0, 200) };
  }
}

/**
 * Phase A.3 follow-up (2026-05-18) · brief feeds meta.
 * Snapshots the meta-scoreboard at brief-time so /scoreboard can
 * surface "as of 6am" picks · operator sees what mattered when the
 * brief fired vs what matters now.
 *
 * Writes BrainMemory(category="scoreboard_pinned", key=YYYY-MM-DD)
 * with the full ScoreboardNumber[] from buildMetaScoreboard(). The
 * page-side reads the latest pinned row · uses it as the baseline ·
 * adds runtime-detected anomalies on top.
 */
async function pinScoreboard(briefDate: string): Promise<{
  status: "pinned" | "skipped";
  numberCount?: number;
  reason?: string;
}> {
  try {
    const { buildMetaScoreboard } = await import(
      "@/lib/services/meta-scoreboard"
    );
    const { prisma } = await import("@/lib/prisma");
    const { Prisma } = await import("@prisma/client");
    const snapshot = await buildMetaScoreboard();
    const metadata = { numbers: snapshot.numbers, state: snapshot.state } as unknown as
      | typeof Prisma.JsonNull
      | object;
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: "scoreboard_pinned", key: briefDate },
      },
      create: {
        category: "scoreboard_pinned",
        key: briefDate,
        content: `Brief-time scoreboard · ${snapshot.state} · ${snapshot.numbers.length} numbers`,
        confidence: 1.0,
        source: "inngest/morning-brief",
        metadata: metadata as never,
      },
      update: {
        content: `Brief-time scoreboard · ${snapshot.state} · ${snapshot.numbers.length} numbers`,
        metadata: metadata as never,
      },
    });
    return { status: "pinned", numberCount: snapshot.numbers.length };
  } catch (err) {
    log.warn("pin_scoreboard_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return {
      status: "skipped",
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

/**
 * The Inngest orchestrator · four sequential checkpoints, each
 * separately retried. Cron trigger at 10:00 UTC daily.
 */
export const operatorMorningBrief = inngest.createFunction(
  {
    id: "operator-morning-brief",
    name: "Operator morning brief · multi-channel",
    retries: 2,
    triggers: [{ cron: "0 10 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const brief = await step.run("compose", composeBrief);
    // Push right after composing; ledger, rating buttons and the Telegram fallback
    // live in deliverMorningBrief.
    const delivery = await step.run("deliver-push", () => deliverMorningBrief(brief));
    const audio = await step.run("voice-file", () => generateBriefAudio(brief));
    // Phase A.3 · pin scoreboard picks for /scoreboard "as of 6am"
    const pinned = await step.run("pin-scoreboard", () =>
      pinScoreboard(brief.date),
    );

    // cron-lifecycle settles a returned status: "partial" as a partial run (never a quiet success).
    const undelivered = delivery.status === "undelivered";
    return {
      ...(undelivered
        ? { status: "partial" as const, degradedReason: "morning brief reached no device and the Telegram fallback failed" }
        : {}),
      date: brief.date,
      sectionCount: brief.sectionCount,
      pushSent: delivery.push.sent,
      pushFailed: delivery.push.failed,
      delivery: delivery.status,
      audioStatus: audio.status,
      audioBytes: audio.bytes ?? null,
      audioReason: audio.reason ?? null,
      scoreboardPinned: pinned.status,
      scoreboardNumberCount: pinned.numberCount ?? null,
    };
  },
);
