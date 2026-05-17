/**
 * Fatal-error → Telegram bridge · v10.0.88 · 2026-05-02.
 *
 * Mirrors lib/brain/alert-telegram-bridge.ts but for production
 * runtime errors. Scans error_logs for FATAL + uncaught HIGH-severity
 * server errors in the last N minutes, dedupes by stack-fingerprint,
 * and pushes a compact summary to Telegram so Nour gets paged
 * instead of finding out via /system/errors hours later.
 *
 * Composition layer:
 *   · Reads ErrorLog rows newer than `windowMinutes` (default 15)
 *   · Filters to level in ('fatal', 'error') with stack present
 *   · Groups by fingerprint = sha1(message-prefix-160 + path) — same
 *     fingerprint = same bug, push once per window per fingerprint
 *   · Persists dedupe markers in BrainMemory category=error_pushed
 *     keyed by fingerprint so re-runs don't spam
 *   · Fires Telegram with a structured HTML message:
 *       <b>🚨 Fatal · /api/route</b>
 *       Message preview · 200 chars
 *       seen Nx · last 30s ago
 *
 * Cadence: every 5 min via /api/cron/error-telegram-push. Faster
 * than alert-telegram (which is 15 min) because errors are more
 * urgent — when a route is throwing 500s, Nour wants to know
 * NOW, not in a quarter-hour.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("system/fatal-error-telegram");

const PUSHED_MARKER_CATEGORY = "error_pushed";
const DEFAULT_WINDOW_MIN = 15;
const FINGERPRINT_PREFIX_LEN = 160;

export interface ErrorPushReport {
  ranAt: string;
  windowMinutes: number;
  scanned: number;
  groups: number;
  pushed: number;
  alreadyPushed: number;
  errors: number;
}

interface ErrorRow {
  id: string;
  level: string;
  message: string;
  stack: string | null;
  context: unknown;
  createdAt: Date;
}

function fingerprintFor(row: ErrorRow): string {
  const ctx =
    row.context && typeof row.context === "object"
      ? (row.context as { path?: string }).path ?? ""
      : "";
  const prefix = (row.message || "").slice(0, FINGERPRINT_PREFIX_LEN);
  return createHash("sha1")
    .update(`${prefix}|${ctx}`)
    .digest("hex")
    .slice(0, 16);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function timeAgo(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export async function runFatalErrorTelegramPush(
  windowMinutes: number = DEFAULT_WINDOW_MIN,
): Promise<ErrorPushReport> {
  const ranAt = new Date().toISOString();
  const since = new Date(Date.now() - windowMinutes * 60_000);

  const rows = await prisma.errorLog
    .findMany({
      where: {
        level: { in: ["fatal", "error"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        level: true,
        message: true,
        stack: true,
        context: true,
        createdAt: true,
      },
    })
    .catch(() => [] as ErrorRow[]);

  if (rows.length === 0) {
    return {
      ranAt,
      windowMinutes,
      scanned: 0,
      groups: 0,
      pushed: 0,
      alreadyPushed: 0,
      errors: 0,
    };
  }

  // Group by fingerprint, keep newest row per fingerprint as the
  // representative + count occurrences.
  const groups = new Map<string, { rep: ErrorRow; count: number }>();
  for (const r of rows) {
    const fp = fingerprintFor(r as ErrorRow);
    const existing = groups.get(fp);
    if (existing) {
      existing.count++;
    } else {
      groups.set(fp, { rep: r as ErrorRow, count: 1 });
    }
  }

  const fingerprints = [...groups.keys()];
  const existing = await prisma.brainMemory.findMany({
    where: {
      category: PUSHED_MARKER_CATEGORY,
      key: { in: fingerprints },
      createdAt: { gte: since },
      deletedAt: null,
    },
    select: { key: true },
  });
  const alreadyPushedSet = new Set(existing.map((m) => m.key));

  let pushed = 0;
  let alreadyPushed = 0;
  let errCount = 0;

  for (const [fp, g] of groups.entries()) {
    if (alreadyPushedSet.has(fp)) {
      alreadyPushed++;
      continue;
    }

    // Claim slot via P2002-protected create
    try {
      await prisma.brainMemory.create({
        data: {
          category: PUSHED_MARKER_CATEGORY,
          key: fp,
          content: `Claimed at ${ranAt} for error ${g.rep.id} (${g.count}x in ${windowMinutes}min)`,
          confidence: 1.0,
          source: "cron:error-telegram-push",
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        alreadyPushed++;
        continue;
      }
      errCount++;
      log.warn("marker_claim_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const path =
      g.rep.context && typeof g.rep.context === "object"
        ? (g.rep.context as { path?: string }).path
        : undefined;
    const head = path ? `${g.rep.level.toUpperCase()} · ${path}` : g.rep.level.toUpperCase();
    const preview = g.rep.message.slice(0, 200).replace(/\s+/g, " ").trim();
    const message =
      `<b>🚨 ${escapeHtml(head)}</b>\n` +
      `${escapeHtml(preview)}` +
      (g.count > 1 ? `\n<i>seen ${g.count}× · last ${timeAgo(g.rep.createdAt)}</i>` : `\n<i>last ${timeAgo(g.rep.createdAt)}</i>`);

    const ok = await sendTelegram(message, undefined, "HTML");
    if (ok) {
      pushed++;
      await prisma.brainMemory
        .update({
          where: {
            category_key: { category: PUSHED_MARKER_CATEGORY, key: fp },
          },
          data: {
            content: `Pushed ${g.count}x of error ${g.rep.id} at ${ranAt}`,
          },
        })
        .catch(() => {});
    } else {
      errCount++;
      log.warn("telegram_send_failed", { fp, errorId: g.rep.id });
    }
  }

  return {
    ranAt,
    windowMinutes,
    scanned: rows.length,
    groups: groups.size,
    pushed,
    alreadyPushed,
    errors: errCount,
  };
}
