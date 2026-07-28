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
export function pushBodyFromBrief(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\n+/g, " · ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Step 2 · send Web Push to the operator's subscribed devices.
 * No-ops if no subscriptions or VAPID_PRIVATE_KEY unset.
 *
 * `chatSeed` lets the operator tap the notification and land in chat
 * with the brief pre-quoted · "walk me through this" works out of
 * the box.
 */
async function sendBriefPush(brief: ComposedBrief): Promise<{
  sent: number;
  failed: number;
}> {
  const { sendPush } = await import("@/lib/notifications/push");
  const result = await sendPush({
    title: "Morning brief",
    // Trim aggressively · push body has a hard limit ~120 chars on
    // most platforms before the OS truncates with "…".
    body: pushBodyFromBrief(brief.text),
    level: "high",
    url: "/command",
    tag: `morning-brief-${brief.date}`,
    chatSeed: {
      prompt: `morning brief for ${brief.date} just landed · walk me through the highest-leverage item and what to do about it today`,
      suggKind: "morning-brief",
      suggId: brief.date,
    },
  });
  return result;
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
    const push = await step.run("web-push", () => sendBriefPush(brief));
    const audio = await step.run("voice-file", () => generateBriefAudio(brief));
    // Phase A.3 · pin scoreboard picks for /scoreboard "as of 6am"
    const pinned = await step.run("pin-scoreboard", () =>
      pinScoreboard(brief.date),
    );

    return {
      date: brief.date,
      sectionCount: brief.sectionCount,
      pushSent: push.sent,
      pushFailed: push.failed,
      audioStatus: audio.status,
      audioBytes: audio.bytes ?? null,
      audioReason: audio.reason ?? null,
      scoreboardPinned: pinned.status,
      scoreboardNumberCount: pinned.numberCount ?? null,
    };
  },
);
