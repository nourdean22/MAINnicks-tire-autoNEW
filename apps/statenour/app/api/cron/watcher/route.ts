import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export const maxDuration = 30;

/**
 * GET /api/cron/watcher — the OS self-check.
 *
 * Runs every 3h and audits the other crons against vercel.json to
 * detect silent failures — scheduled jobs that haven't produced a
 * `success` log in 2× their interval. Writes a `brain_insight`
 * audit event for each stale finding + surfaces them in the
 * pulse-digest.
 *
 * Also checks embedding coverage drift: if any table has > 5 rows
 * without corresponding VectorEmbedding rows, fires an insight so
 * the embed-backfill cron gets a prompt.
 *
 * Silent on healthy systems — no event written when all crons are
 * running within their SLA.
 *
 * Schedule: `0 /3 * * *` (every 3 hours) — will be added to vercel.json.
 */
export const GET = cronHandler(async () => {
  // ── Load scheduled crons from vercel.json (read filesystem at
  //    request time; vercel.json is shipped with the lambda so this
  //    works in prod) ──
  const vercelJsonPath = path.join(process.cwd(), "vercel.json");
  let scheduled: Array<{ path: string; schedule: string }> = [];
  try {
    const raw = fs.readFileSync(vercelJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> };
    scheduled = parsed.crons ?? [];
  } catch {
    // vercel.json not readable — can't audit, return silently
    return { audited: 0, stale: 0, note: "vercel.json unreadable" };
  }

  // ── For each scheduled cron, find the most recent successful
  //    log and flag if older than 2× the schedule interval ──
  const stale: Array<{ path: string; schedule: string; lastSeenHoursAgo: number | null }> = [];

  for (const cron of scheduled) {
    // Extract the job name from the path (/api/cron/foo?slot=bar → foo)
    const match = cron.path.match(/\/api\/cron\/([^/?]+)/);
    if (!match) continue;
    const jobName = match[1];

    // Estimate the interval from the cron schedule (rough)
    const intervalHours = estimateIntervalHours(cron.schedule);
    if (intervalHours === null) continue;

    const sinceHours = intervalHours * 2 + 1; // 2× interval + 1h buffer
    const cutoff = new Date(Date.now() - sinceHours * 3600_000);

    const lastSuccess = await prisma.cronJobLog.findFirst({
      where: { jobName, status: "success", createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (!lastSuccess) {
      // Also check for any log (failed counts as "fired") so we don't
      // false-flag jobs that are failing hard
      const anyRecent = await prisma.cronJobLog.findFirst({
        where: { jobName, createdAt: { gte: cutoff } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      });
      const lastSeen = anyRecent?.createdAt ?? null;
      const lastSeenHoursAgo = lastSeen
        ? Math.round((Date.now() - lastSeen.getTime()) / 3600_000)
        : null;
      stale.push({ path: cron.path, schedule: cron.schedule, lastSeenHoursAgo });
    }
  }

  if (stale.length > 0) {
    const body = stale
      .slice(0, 5)
      .map(
        (s) =>
          `  ${s.path} · ${s.schedule}${s.lastSeenHoursAgo !== null ? ` · last ${s.lastSeenHoursAgo}h ago` : " · never logged"}`
      )
      .join("\n");
    await prisma.auditEvent
      .create({
        data: {
          actor: "system",
          eventType: "brain_insight",
          detail: `CRON WATCHER: ${stale.length} scheduled crons silent beyond 2× SLA`,
          payload: {
            stale: stale.slice(0, 10),
            note:
              "These jobs are scheduled in vercel.json but haven't logged a success recently. Check Vercel dashboard for scheduling issues, or remove from vercel.json if retired.",
            body,
          },
        },
      })
      .catch(() => {});

    // 2026-05-27 · Telegram surfacing for watcher findings. Pre-fix:
    // the watcher wrote `auditEvent.eventType="brain_insight"` only,
    // but the alert-telegram-bridge scans BrainMemory not auditEvent,
    // so the entire cron-watcher safety net was silent on Telegram —
    // crons could go dead for weeks (like moeseuclid Gmail did) with
    // no phone ping. Now: mirror to BrainMemory(category="watcher_alert")
    // with a per-day idempotency key so a single day's findings ping
    // at most once. The bridge picks up "watcher_alert" on its next
    // 15-min sweep.
    await prisma.brainMemory
      .upsert({
        where: {
          category_key: {
            category: "watcher_alert",
            key: `cron_stale_${new Date().toISOString().slice(0, 10)}`,
          },
        },
        create: {
          category: "watcher_alert",
          key: `cron_stale_${new Date().toISOString().slice(0, 10)}`,
          content: `${stale.length} cron${stale.length === 1 ? "" : "s"} silent beyond 2× SLA:\n${body}`,
          source: "cron:watcher",
          confidence: 1.0,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
        update: {
          content: `${stale.length} cron${stale.length === 1 ? "" : "s"} silent beyond 2× SLA:\n${body}`,
          lastSeen: new Date(),
        },
      })
      .catch(() => undefined);
  }

  // ── Embedding coverage drift check ──
  const [brainMemCount, brainMemEmbeds, brainDumpCount, brainDumpEmbeds, reflCount, reflEmbeds] = await Promise.all([
    prisma.brainMemory.count(),
    prisma.vectorEmbedding.count({ where: { sourceType: "brain_memory" } }),
    prisma.brainDump.count(),
    prisma.vectorEmbedding.count({ where: { sourceType: "brain_dump" } }),
    prisma.reflection.count(),
    prisma.vectorEmbedding.count({ where: { sourceType: "reflection" } }),
  ]);
  const gaps: Array<{ source: string; total: number; embedded: number; missing: number }> = [];
  if (brainMemCount - brainMemEmbeds > 5) {
    gaps.push({ source: "brain_memory", total: brainMemCount, embedded: brainMemEmbeds, missing: brainMemCount - brainMemEmbeds });
  }
  if (brainDumpCount - brainDumpEmbeds > 5) {
    gaps.push({ source: "brain_dump", total: brainDumpCount, embedded: brainDumpEmbeds, missing: brainDumpCount - brainDumpEmbeds });
  }
  if (reflCount - reflEmbeds > 5) {
    gaps.push({ source: "reflection", total: reflCount, embedded: reflEmbeds, missing: reflCount - reflEmbeds });
  }

  if (gaps.length > 0) {
    await prisma.auditEvent
      .create({
        data: {
          actor: "system",
          eventType: "brain_insight",
          detail: `CRON WATCHER: vector coverage drift — ${gaps.map((g) => `${g.source} ${g.missing} missing`).join(" · ")}`,
          payload: { gaps, note: "vector-coverage-watcher cron will backfill on next run." },
        },
      })
      .catch(() => {});
  }

  return {
    scheduledCrons: scheduled.length,
    stale: stale.length,
    vectorGaps: gaps.length,
    staleDetail: stale,
  };
});

/**
 * Estimate the interval in hours from a cron expression. Handles the
 * common patterns used in vercel.json: daily / hourly / weekly / slash
 * notation. Returns null if we can't parse.
 */
function estimateIntervalHours(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Hourly-ish: "0 * * * *" or "*/N * * * *"
  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    if (minute.startsWith("*/")) {
      const n = parseInt(minute.slice(2), 10);
      return n > 0 ? n / 60 : null;
    }
    return 1; // every hour
  }

  // "*/N * * * *" — minute-based
  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10);
    return n > 0 ? n / 60 : null;
  }

  // Every N hours: "0 */N * * *" (e.g. every 3h, every 6h).
  // Must come BEFORE the daily fallback because hour !== "*" but the
  // slash pattern still means sub-daily. Previously fell through to
  // the "Daily" branch and returned 24h, making the watcher miss
  // stale-cron signals for auto-linker (3h) + knowledge-sync (6h).
  if (hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10);
    return n > 0 ? n : null;
  }

  // Multi-hour per day: "0 9,14,18 * * *" → daily with 3 fires, but the
  // longest gap could be up to 19h. Use 24h / firings.
  if (hour.includes(",")) {
    const n = hour.split(",").length;
    if (n > 0) return 24 / n;
  }

  // Daily: "0 9 * * *" → 24h
  if (dayOfMonth === "*" && dayOfWeek === "*") return 24;

  // Weekly (specific day): "0 2 * * 0" → 168h
  if (dayOfWeek && dayOfWeek !== "*") {
    if (dayOfWeek.includes(",")) {
      return 168 / dayOfWeek.split(",").length;
    }
    return 168;
  }

  // Fallback — treat as daily
  return 24;
}
