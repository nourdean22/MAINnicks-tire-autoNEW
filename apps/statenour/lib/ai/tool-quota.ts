/**
 * lib/ai/tool-quota.ts · v10.0.529.4 · D-2 defense
 *
 * Per-day call quota for expensive chat tools (runPython · E2B sandbox
 * @ ~$0.0003/run · ingestDocumentFromUrl · arbitrary external fetch +
 * embedding cost). The chat route already caps tool-call depth per
 * turn via stopWhen=stepCountIs(N), but a prompt-injection loop that
 * fires across many turns could still bleed paid quota in ~6 minutes.
 *
 * This module adds a soft daily cap per tool. Above the cap the tool
 * returns a structured `{ ok: false, error: "quota_exceeded" }` so
 * the chat model can gracefully tell the operator instead of silently
 * failing.
 *
 * Storage: BrainMemory(category="tool_quota_daily", key="<tool>_<date>")
 * Metadata.count holds the running counter. NO new tables · uses the
 * existing rolling tool-pattern (matches morning-brief, decision-replay).
 *
 * Reset cadence: rows are date-keyed so the count rolls naturally at
 * midnight ET (the operator's tz). Old rows get reaped by
 * lib/services/memory-decay.ts on its weekly run.
 *
 * Cap defaults are conservative · the operator's typical day uses
 * runPython ~5-10 times and ingestDocumentFromUrl ~2-5 times. The
 * cap of 100 gives ~10x headroom and triggers only on actual abuse.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/tool-quota");

export interface QuotaCheckResult {
  ok: boolean;
  count: number;
  cap: number;
  resetAt: string; // ISO of next midnight ET
}

const DEFAULT_CAPS: Record<string, number> = {
  runPython: 100,
  ingestDocumentFromUrl: 50,
};

function todayKey(toolName: string): string {
  // YYYY-MM-DD in America/New_York · matches morning-brief's pattern.
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  return `${toolName}_${date}`;
}

function nextMidnightEtIso(): string {
  // Tomorrow 00:00 in NY · DST-aware. v10.0.529.8 fix · the original
  // `setUTCHours(28)` assumed UTC-4 (EDT, summer) and undershot by 1h
  // during EST (UTC-5, Nov-Mar). Compute the actual offset for the
  // current moment by parsing what `toLocaleString` says for ET right
  // now, then advance to next day's 00:00 local.
  const now = new Date();
  // The `en-CA` locale gives YYYY-MM-DD which sorts lexicographically
  // · matches todayKey() above. Then we compute "tomorrow midnight ET"
  // by adding a day and interpreting it back into UTC via the offset
  // dance.
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  // Get the ET calendar date for tomorrow
  const etDate = tomorrow.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  // Construct midnight-ET as an ISO string · works for both EST and
  // EDT since the offset is encoded in the string itself. We pick EDT
  // (-04:00) when we're after the spring-forward transition and EST
  // (-05:00) otherwise. Use the actual current offset as a proxy.
  const etOffset = isCurrentlyEdt(now) ? "-04:00" : "-05:00";
  return new Date(`${etDate}T00:00:00${etOffset}`).toISOString();
}

/**
 * Detect whether ET is currently on EDT (UTC-4) vs EST (UTC-5). Uses
 * the offset of the operator's `America/New_York` timezone right now ·
 * survives DST transitions because we ask the runtime, not a hardcoded
 * date table.
 */
function isCurrentlyEdt(d: Date): boolean {
  const utcHour = d.getUTCHours();
  const etHourStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
  const etHour = parseInt(etHourStr.split(":")[0] ?? "0", 10);
  // The offset is utcHour - etHour (modulo 24, handling day-boundary cross)
  const diff = (utcHour - etHour + 24) % 24;
  // EDT is 4-hour offset · EST is 5-hour offset.
  return diff === 4;
}

/**
 * Atomic check-and-increment via raw SQL `ON CONFLICT ... jsonb_set(... + 1)`.
 *
 * v10.0.529.8 fix · post-session review caught a race condition in the
 * v529.4 read-then-upsert pattern: concurrent calls could both read the
 * same count and overwrite each other's increment, silently undercounting
 * the quota. Fix uses Postgres's atomic upsert with jsonb_set + a CAST
 * dance to increment the JSON `count` field as part of the WRITE — the
 * lock is held by the row write, not the JS code, so concurrent calls
 * serialize correctly.
 *
 * Behavior:
 *   · Returns `{ ok: true, count, cap, resetAt }` when post-increment
 *     count ≤ cap.
 *   · Returns `{ ok: false, count, cap, resetAt }` when count > cap.
 *     The over-by-one cost is bounded: the row IS incremented, so the
 *     next call sees the bump, but the THIS call is rejected at the
 *     application level. Net effect: cap may be exceeded by exactly 1
 *     under tight concurrency (acceptable · the cap is a budget not
 *     a hard wall).
 *   · Fail-open on any DB error: returns `ok: true` so a quota
 *     subsystem hiccup doesn't break the chat surface.
 */
export async function checkAndIncrementToolQuota(
  toolName: string,
  capOverride?: number,
): Promise<QuotaCheckResult> {
  const cap = capOverride ?? DEFAULT_CAPS[toolName] ?? 1000;
  const key = todayKey(toolName);

  type IncrementRow = { count: number };

  let rows: IncrementRow[];
  try {
    // Atomic INSERT ... ON CONFLICT DO UPDATE with jsonb_set increment.
    // The `metadata` column is jsonb-compatible (Prisma Json maps to
    // postgres jsonb). The CAST chain pulls count out as int, adds 1,
    // converts back to text, then back to jsonb so jsonb_set accepts it.
    // Generate an id matching the schema's cuid-shape default. We pass
    // it explicitly because raw INSERT bypasses Prisma's @default.
    const id = `quota_${key}_${Date.now().toString(36)}`;
    rows = await prisma.$queryRaw<IncrementRow[]>`
      INSERT INTO "brain_memories" (
        "id", "category", "key", "content", "confidence", "source",
        "metadata", "last_seen", "seen_count", "created_at", "updated_at",
        "created_by"
      )
      VALUES (
        ${id},
        'tool_quota_daily',
        ${key},
        ${`${toolName} daily counter`},
        1,
        'ai:tool-quota',
        ${JSON.stringify({ count: 1, tool: toolName })}::jsonb,
        NOW(), 1, NOW(), NOW(), 'system'
      )
      ON CONFLICT ("category", "key") DO UPDATE
        SET "metadata" = jsonb_set(
              "brain_memories"."metadata",
              '{count}',
              ((COALESCE(("brain_memories"."metadata"->>'count')::int, 0) + 1)::text)::jsonb
            ),
            "updated_at" = NOW()
      RETURNING (("metadata"->>'count')::int) AS count
    `;
  } catch (err) {
    log.warn("quota_upsert_failed", {
      toolName,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    // Fail open · don't block the tool when the quota table is unhealthy.
    return { ok: true, count: 0, cap, resetAt: nextMidnightEtIso() };
  }

  const count = rows[0]?.count ?? 0;
  if (count > cap) {
    log.warn("tool_quota_exceeded", { toolName, count, cap });
    return { ok: false, count, cap, resetAt: nextMidnightEtIso() };
  }
  return { ok: true, count, cap, resetAt: nextMidnightEtIso() };
}
