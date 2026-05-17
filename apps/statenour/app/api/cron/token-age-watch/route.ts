/**
 * GET /api/cron/token-age-watch · v10.0.89 · 2026-05-02.
 *
 * Daily watchdog over all tokens NOUR OS depends on. Re-uses the
 * /api/system/token-ages computation directly so there's only one
 * source of truth. When any token enters the rotate-soon (<14d) or
 * expired window, push to Telegram with idempotent per-day markers
 * so we don't spam the same warning daily.
 *
 * Cadence: daily 11am UTC = 7am Cleveland. Single fire — perfect
 * latency for a "rotate this week" reminder.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/token-age-watch");
const MARKER_CATEGORY = "token_age_pushed";

interface TokenStatus {
  id: string;
  label: string;
  status: string;
  daysUntilExpiry: number | null;
  envPresent: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const maxDuration = 60;

export const GET = cronHandler(async (req) => {
  // Compute the same token-age data the /api/system/token-ages route
  // returns. We can't call our own route from a cron, but we can
  // call the same data assembly inline. Simplest: read the route
  // module's logic via direct fetch to ourselves with a synthetic
  // header so apiHandler grants owner. Cleaner long-term: extract
  // the rollup into a lib helper. For now, fetch self.
  const url = new URL(req.url);
  const selfUrl = `${url.protocol}//${url.host}/api/system/token-ages`;
  const tokensResp = await fetch(selfUrl, {
    headers: {
      cookie: req.headers.get("cookie") ?? "",
      authorization: req.headers.get("authorization") ?? "",
    },
  }).catch(() => null);
  if (!tokensResp || !tokensResp.ok) {
    return {
      ok: false,
      reason: "token-ages-fetch-failed",
      status: tokensResp?.status,
    };
  }
  const tokensData = (await tokensResp.json()) as {
    data: { tokens: TokenStatus[]; alerts: TokenStatus[] };
  };
  const alerts = tokensData.data.alerts ?? [];

  const dayKey = new Date().toISOString().slice(0, 10);
  let pushed = 0;
  let alreadyPushed = 0;

  for (const t of alerts) {
    // Idempotent per-token-per-day push
    const markerKey = `${t.id}__${dayKey}`;
    try {
      await prisma.brainMemory.create({
        data: {
          category: MARKER_CATEGORY,
          key: markerKey,
          content: `${t.label} status=${t.status} daysUntilExpiry=${t.daysUntilExpiry ?? "n/a"}`,
          confidence: 1.0,
          source: "cron:token-age-watch",
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        alreadyPushed++;
        continue;
      }
      log.warn("marker_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    let emoji = "🔑";
    if (t.status === "expired") emoji = "🔥";
    else if (t.status === "missing") emoji = "❓";
    else if (t.status === "rotate-soon") emoji = "⏰";

    const tail =
      t.daysUntilExpiry === null
        ? `· ${t.status}`
        : t.daysUntilExpiry <= 0
          ? `· EXPIRED ${Math.abs(t.daysUntilExpiry)}d ago`
          : `· ${t.daysUntilExpiry}d to expiry`;

    const message = `<b>${emoji} Token rotation due</b>\n${escapeHtml(t.label)}\n<i>${tail}</i>`;
    const ok = await sendTelegram(message, undefined, "HTML");
    if (ok) pushed++;
  }

  return {
    ok: true,
    dayKey,
    totalAlerts: alerts.length,
    pushed,
    alreadyPushed,
  };
});
