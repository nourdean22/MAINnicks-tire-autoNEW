// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cached } from "@/lib/utils/cache";
import { computeInputs, generateTimelines, type Timeline } from "@/lib/ultron/timelines";
import { queryNickBatch } from "@/lib/nickstire/query";
// v10.0.283 · drop 5 `any` in fetchBrainPulseItems · use the upstream types
import type { Nudge } from "@/lib/brain/cross-system-nudge";
import type { IdentityAxis, AxisKey } from "@/lib/brain/identity-snapshot";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/**
 * GET /api/ultron/ticker
 *
 * Ambient awareness feed for the Ultron top strip. Pulls:
 *   - Simulated timelines (personal what-if projections) — v2
 *   - Market snapshots (S&P, DJI, NASDAQ, oil, gold) from Stooq (free, no key)
 *   - General / macro / auto-industry headlines from a curated RSS fanout
 *
 * Items are interleaved 1-timeline, 1-market, 1-macro so the user's own
 * intelligence surfaces alongside world data — not buried at the end.
 *
 * v1 is deliberately thin. The goal is 6-12 items across categories,
 * cached 60s (short because personal timelines change intra-day).
 *
 * Personalisation (click-learn) is v3 — the data shape already supports
 * categories so we can filter on the client for now.
 *
 * Sources are free and non-authenticated. If any upstream is down, we
 * return whatever we got plus a softError in the payload so the UI can
 * show stale data rather than blank.
 */

interface TickerItem {
  id: string;                     // stable, used as React key
  // Phase BB · codemod-categories.ts type-position carve-out · this
  // is a TS union-type literal not a value · the BRAIN_CATEGORIES
  // rewrite would create a namespace reference in type context.
  // Intentional inline string · matches BRAIN_CATEGORIES.MARKET value.
  category: "market" | "macro" | "industry" | "local" | "timeline" | "shop" | "brain";
  symbol?: string;                // e.g. "SPX", "OIL", "YOU", "SHOP", "BRAIN"
  label: string;                  // short display text
  deltaPct?: number | null;       // for markets only
  severity?: "info" | "warn" | "win"; // for timelines + shop alerts
  domain?: string;                // for timelines (body/mind/money/life)
  href?: string;                  // drill-through link
  at?: string;                    // ISO timestamp when the quote/headline was from
}

interface TickerPayload {
  items: TickerItem[];
  generatedAt: string;
  softError?: string;
}

export const revalidate = 300;

// Stooq free quotes endpoint — CSV per symbol, no API key needed.
// Symbols documented at https://stooq.com/q/?s=^spx
const STOOQ_QUOTES = [
  { symbol: "^spx", label: "S&P" },
  { symbol: "^ndq", label: "NASDAQ" },
  { symbol: "^dji", label: "DOW" },
  { symbol: "cl.f",  label: "OIL" },
  { symbol: "gc.f",  label: "GOLD" },
] as const;

async function fetchStooqQuote(symbol: string, label: string): Promise<TickerItem | null> {
  try {
    const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    const row = lines[1].split(",");
    // Row: Symbol,Date,Time,Open,High,Low,Close,Volume
    const open = Number(row[3]);
    const close = Number(row[6]);
    if (!isFinite(open) || !isFinite(close) || open === 0) return null;
    const deltaPct = ((close - open) / open) * 100;
    return {
      id: `mkt-${symbol}`,
      category: BRAIN_CATEGORIES.MARKET,
      symbol: label,
      label: `${label} ${close.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      deltaPct: Math.round(deltaPct * 100) / 100,
      at: `${row[1]} ${row[2] ?? ""}`.trim(),
    };
  } catch {
    return null;
  }
}

// AP headline fallbacks — deliberately hardcoded seed items so the ticker is
// never empty. v2 swaps to a live RSS fetch. Keeping static in v1 is honest:
// we'd rather surface curated content than an unreliable scraped feed.
//
// May 02 · STALE-by-design · these were authored Apr 19 and don't tick
// over with real time. Each is X-dismissable from the client via the
// useDismissedTicker hook (Set<id> in localStorage); once the user X's
// them they stay gone across reloads. Long-term fix: replace this with
// a live RSS pull + freshness gating (drop items > 72h old). For now
// the IDs below are the canonical dismissal targets.
const STATIC_MACRO: TickerItem[] = [
  {
    id: "macro-fed",
    category: BRAIN_CATEGORIES.MACRO,
    label: "Fed holds rates — watching CPI print next week",
    href: "https://www.federalreserve.gov/monetarypolicy.htm",
  },
  {
    id: "macro-autos",
    category: BRAIN_CATEGORIES.INDUSTRY,
    label: "Auto lease originations +6% YoY — demand softening",
    href: "https://www.autonews.com/",
  },
  {
    id: "macro-tires",
    category: BRAIN_CATEGORIES.INDUSTRY,
    label: "Tire futures ▼ 2% on Q2 import data",
  },
  {
    id: "local-weather",
    category: BRAIN_CATEGORIES.LOCAL,
    label: "Ontario snow advisory Thursday — morning rush impact",
  },
];

function timelineToTickerItem(t: Timeline): TickerItem {
  return {
    id: `tl-${t.id}`,
    category: BRAIN_CATEGORIES.TIMELINE,
    symbol: "YOU",
    label: t.text,
    severity: t.severity,
    domain: t.domain,
  };
}

/**
 * Fetch a compact shop pulse from nickstire via the shared query API.
 * This is the oversight layer — autonicks (personal OS) surfaces a few
 * headlines without owning shop data. Failure is silent; the ticker
 * renders without shop items rather than blocking on nickstire latency.
 */
async function fetchShopPulse(): Promise<TickerItem[]> {
  try {
    const results = await queryNickBatch([
      { query: "revenue_today" },
      { query: "leads_urgent" },
      { query: "callbacks_pending" },
      { query: "attention_needed" },
    ]);

    const items: TickerItem[] = [];
    const unwrap = (r: unknown) =>
      (r as Record<string, unknown> | undefined)?.data as
        | Record<string, unknown>
        | undefined;

    const rev = unwrap(results.revenue_today);
    if (rev && typeof rev.totalDollars === "number") {
      const jobs = typeof rev.invoiceCount === "number" ? rev.invoiceCount : 0;
      items.push({
        id: "shop-rev",
        category: BRAIN_CATEGORIES.SHOP,
        symbol: "SHOP",
        label: `$${rev.totalDollars.toLocaleString()} today · ${jobs} jobs`,
        severity: rev.totalDollars > 0 ? "win" : "info",
        href: "https://nickstire.org/admin",
      });
    }

    const leads = unwrap(results.leads_urgent);
    if (leads && typeof leads.count === "number" && leads.count > 0) {
      items.push({
        id: "shop-leads",
        category: BRAIN_CATEGORIES.SHOP,
        symbol: "LEADS",
        label: `${leads.count} urgent lead${leads.count === 1 ? "" : "s"} waiting`,
        severity: leads.count >= 3 ? "warn" : "info",
        href: "https://nickstire.org/admin/leads",
      });
    }

    const callbacks = unwrap(results.callbacks_pending);
    if (callbacks && typeof callbacks.count === "number" && callbacks.count > 0) {
      items.push({
        id: "shop-callbacks",
        category: BRAIN_CATEGORIES.SHOP,
        symbol: "CALLS",
        label: `${callbacks.count} callback${callbacks.count === 1 ? "" : "s"} pending`,
        severity: callbacks.count >= 5 ? "warn" : "info",
        href: "https://nickstire.org/admin/callbacks",
      });
    }

    const attn = unwrap(results.attention_needed);
    if (attn && Array.isArray(attn.alerts)) {
      const topAlert = (attn.alerts as Array<Record<string, unknown>>)[0];
      if (topAlert && typeof topAlert.msg === "string") {
        items.push({
          id: "shop-attn",
          category: BRAIN_CATEGORIES.SHOP,
          symbol: "ATTN",
          label: String(topAlert.msg).slice(0, 80),
          severity: "warn",
          href: "https://nickstire.org/admin",
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

/**
 * Interleave four streams (timelines, markets, macro, shop) so user's own
 * intelligence surfaces throughout, not only bunched at the end.
 * Pattern per cycle: [timeline?, shop?, market?, macro?, ...]
 * Shop goes second so oversight is always near the front of the rotation.
 */
function interleave(...lists: TickerItem[][]): TickerItem[] {
  const out: TickerItem[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

/**
 * Apr 19 · Fetch BODY + MONEY as TickerItems. Folded from the old
 * top-of-screen PulseStack so the header stays slim. Body + money are
 * quantitative externals — they pair naturally with the markets /
 * shop rotation in the TOP ticker. Mind + life go to the BOTTOM
 * personal-pulse.
 *
 * Sources the exact same data as /api/ultron/pulse (which the old
 * PulseStack consumed) so the values match what Nour used to see
 * on the chips.
 */
/**
 * BODY + MONEY ticker items — ZERO stale fallbacks.
 *
 * Apr 19 per Nour: if the chip has no fresh signal, don't show
 * anything at all. A silent ticker beats stale filler.
 *
 * BODY emits ONLY when a workout DAILY task has a live streak
 * (lastCompletedAt within the last 2 days). MasteryScore fallback
 * retired (the scorer itself is stale since Nour stopped logging).
 *
 * MONEY emits ONLY when the freshest FinancialSnapshot is <45 days
 * old. Older than that → the net-worth trend is meaningless.
 */
async function fetchSelfMetricsTop(): Promise<TickerItem[]> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const [workoutStreak, finSnaps] = await Promise.all([
      prisma.task
        .findFirst({
          where: {
            loopKind: "DAILY",
            OR: [
              { title: { contains: "workout", mode: "insensitive" } },
              { title: { contains: "move", mode: "insensitive" } },
              { title: { contains: "gym", mode: "insensitive" } },
              { title: { contains: "exercise", mode: "insensitive" } },
            ],
          },
          orderBy: { streakCount: "desc" },
          select: { streakCount: true, lastCompletedAt: true, title: true },
        })
        .catch(() => null as { streakCount: number; lastCompletedAt: Date | null; title: string } | null),
      prisma.financialSnapshot
        .findMany({
          orderBy: { date: "desc" },
          take: 12,
          select: { netWorthEstimate: true, date: true },
        })
        .catch(() => [] as Array<{ netWorthEstimate: number | null; date: string }>),
    ]);

    const items: TickerItem[] = [];

    // ── BODY (live only) ──
    if (workoutStreak && workoutStreak.streakCount > 0 && workoutStreak.lastCompletedAt) {
      const daysSince = (Date.now() - workoutStreak.lastCompletedAt.getTime()) / 86400_000;
      // Only surface a WARM streak (last touch within 2d). Cold streaks
      // shouldn't clutter the ticker — if the workout habit died, the
      // ticker simply drops the chip.
      if (daysSince < 2) {
        items.push({
          id: "self-body",
          category: BRAIN_CATEGORIES.TIMELINE,
          symbol: "BODY",
          label: `${workoutStreak.streakCount}d workout streak 🔥`,
          deltaPct: null,
          severity: "win",
          domain: "body",
          href: "/body",
        });
      }
    }

    // ── MONEY (fresh only) ──
    if (finSnaps.length >= 2) {
      const latest = finSnaps[0];
      const latestAge = (Date.now() - new Date(latest.date).getTime()) / 86400_000;
      if (latestAge < 45) {
        const prev = finSnaps[finSnaps.length - 1].netWorthEstimate ?? 0;
        const current = latest.netWorthEstimate ?? 0;
        const netDelta = current - prev;
        // Only surface when there's actual movement (>$50 abs).
        if (Math.abs(netDelta) > 50) {
          const sign = netDelta < 0 ? "-" : "+";
          const abs = Math.abs(netDelta);
          const formatted = abs >= 1000
            ? `${sign}$${(abs / 1000).toFixed(1)}k`
            : `${sign}$${Math.round(abs).toLocaleString()}`;
          items.push({
            id: "self-money",
            category: BRAIN_CATEGORIES.TIMELINE,
            symbol: "MONEY",
            label: `net Δ ${formatted}`,
            deltaPct: null,
            severity: netDelta > 0 ? "win" : "warn",
            domain: "money",
            href: "/financial",
          });
        }
      }
    }

    return items;
  } catch {
    return [];
  }
}

/**
 * v10.0.351 · Personal-ops items folded from the old chat-header LiveHudBar.
 *
 * The chat header used to mount a separate metrics bar (tasks / score /
 * AI cost). That duplicated the ticker's job and burned a 30s poll
 * concurrent with the 5min ticker. Folding into the ticker:
 *   · ONE poll, ONE awareness surface
 *   · No duplication with shop pulse (revenue + leads already there)
 *   · Items only emit on a real signal · silent ticker beats noise
 *
 * Skip rules:
 *   · TASKS · only when dueToday > 0 (no point flagging "0 due")
 *   · SCORE · only when today's score exists (already conditional)
 *   · COST · only when > $1 (sub-dollar AI spend isn't ticker-worthy)
 *
 * IDs are stable so the existing dismiss mechanism (useDismissedTicker)
 * works · operator can X out a metric and it stays gone across reloads.
 */
async function fetchPersonalOpsItems(): Promise<TickerItem[]> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const [tasksDue, tasksActive, scoreData, costData] = await Promise.all([
      prisma.task
        .count({
          where: {
            status: { in: ["READY", "DOING", "WAITING"] },
            dueDate: { not: null, lte: todayEnd },
          },
        })
        .catch(() => null as number | null),
      prisma.task
        .count({ where: { status: { in: ["READY", "DOING", "WAITING"] } } })
        .catch(() => null as number | null),
      prisma.brainMemory
        .findFirst({
          where: { category: "daily_score", createdAt: { gte: todayStart } },
          orderBy: { createdAt: "desc" },
          select: { metadata: true },
        })
        .catch(() => null),
      prisma.aiGeneration
        .aggregate({
          where: { createdAt: { gte: todayStart } },
          _sum: { costCents: true },
        })
        .catch(() => null),
    ]);

    const items: TickerItem[] = [];

    // ── TASKS · only when something is actually due/overdue today ──
    if (tasksDue !== null && tasksDue > 0) {
      const activeStr =
        tasksActive !== null && tasksActive > tasksDue ? ` · ${tasksActive} active` : "";
      items.push({
        id: "ops-tasks",
        category: BRAIN_CATEGORIES.TIMELINE,
        symbol: "TASKS",
        label: `${tasksDue} due today${activeStr}`,
        severity: tasksDue >= 5 ? "warn" : "info",
        domain: "life",
        href: "/tasks",
      });
    }

    // ── SCORE · only when today's daily score exists ──
    const scoreToday =
      scoreData?.metadata && typeof (scoreData.metadata as { score?: number }).score === "number"
        ? (scoreData.metadata as { score: number }).score
        : null;
    if (scoreToday !== null) {
      const tone: TickerItem["severity"] =
        scoreToday >= 80 ? "win" : scoreToday >= 50 ? "info" : "warn";
      items.push({
        id: "ops-score",
        category: BRAIN_CATEGORIES.TIMELINE,
        symbol: "SCORE",
        label: `${scoreToday}/100 today`,
        severity: tone,
        domain: "life",
        href: "/journal",
      });
    }

    // ── COST · only when > $1 spent on AI today ──
    const cents = costData?._sum.costCents ?? null;
    if (cents !== null && cents >= 100) {
      const dollars = cents / 100;
      const formatted =
        dollars >= 100
          ? `$${dollars.toFixed(0)}`
          : `$${dollars.toFixed(2)}`;
      items.push({
        id: "ops-cost",
        category: BRAIN_CATEGORIES.TIMELINE,
        symbol: "AI$",
        label: `${formatted} today`,
        severity: cents >= 1000 ? "warn" : "info",
        domain: "money",
        href: "/system/costs",
      });
    }

    return items;
  } catch {
    return [];
  }
}

async function fetchBrainPulseItems(): Promise<TickerItem[]> {
  try {
    const [maturityMod, nudgeMod, contradictionMod, identityMod] = await Promise.all([
      import("@/app/api/brain/maturity/route").catch(() => null),
      import("@/lib/brain/cross-system-nudge"),
      import("@/lib/brain/contradiction-surfacer"),
      import("@/lib/brain/identity-snapshot"),
    ]);
    // Use the compute helpers directly instead of HTTP
    const [nudges, openContradictions, snap] = await Promise.all([
      nudgeMod.computeNudges().catch(() => []),
      contradictionMod.countUnresolved(14).catch(() => 0),
      identityMod.loadIdentitySnapshot().catch(() => null),
    ]);
    void maturityMod; // silence unused import warning

    const items: TickerItem[] = [];

    // High-severity nudges — most important signal
    for (const n of nudges.filter((x: Nudge) => x.severity === "high").slice(0, 2)) {
      items.push({
        id: `brain-nudge-${n.source}-${n.text.slice(0, 20)}`,
        category: BRAIN_CATEGORIES.BRAIN,
        symbol: "BRAIN",
        label: `‼ ${n.text}`,
        severity: "warn",
        href: n.link ?? "/brain",
      });
    }
    // Medium-severity — one at most
    const medium = nudges.find((x: Nudge) => x.severity === "medium");
    if (medium && items.length < 3) {
      items.push({
        id: `brain-nudge-med-${medium.source}`,
        category: BRAIN_CATEGORIES.BRAIN,
        symbol: "BRAIN",
        label: `⚠ ${medium.text}`,
        severity: "warn",
        href: medium.link ?? "/brain",
      });
    }

    // Open contradictions counter
    if (openContradictions > 0) {
      items.push({
        id: `brain-contradict`,
        category: BRAIN_CATEGORIES.BRAIN,
        symbol: "BRAIN",
        label: `⚠ ${openContradictions} open contradiction${openContradictions > 1 ? "s" : ""}`,
        severity: "warn",
        href: "/brain",
      });
    }

    // Identity axis shift (if any axis moved materially)
    if (snap) {
      const shifting = (Object.entries(snap.axes) as Array<[AxisKey, IdentityAxis]>).find(
        ([, a]) => a.direction !== "stable" && a.evidence.length > 0,
      );
      if (shifting) {
        const [key, axis] = shifting;
        const arrow = axis.direction === "rising" ? "↑" : "↓";
        items.push({
          id: `brain-axis-${key}`,
          category: BRAIN_CATEGORIES.BRAIN,
          symbol: "BRAIN",
          label: `${key.replace(/_/g, " ")} ${arrow} ${axis.manual ?? axis.value}`,
          severity: axis.direction === "rising" ? "win" : "info",
          href: "/brain",
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    // v10.0.351 · cache key bumped v5 → v6 to invalidate stale cache after
    // folding personal-ops items (tasks/score/cost) from the chat-header HUD.
    const payload = await cached<TickerPayload>("ultron_ticker_v6", 60, async () => {
      // Fetch in parallel — personal timelines + markets + shop + brain +
      // self (body/money) + ops (tasks/score/cost · v10.0.351).
      const [inputs, quotes, shopItems, brainItems, selfItems, opsItems] = await Promise.all([
        computeInputs().catch(() => null),
        Promise.all(STOOQ_QUOTES.map((q) => fetchStooqQuote(q.symbol, q.label))),
        fetchShopPulse(),
        fetchBrainPulseItems(),
        fetchSelfMetricsTop(),
        fetchPersonalOpsItems(),
      ]);
      const marketItems = quotes.filter((q): q is TickerItem => q !== null);
      const timelineItems = inputs
        ? generateTimelines(inputs).map(timelineToTickerItem)
        : [];

      // Interleave. Ops + self metrics + brain items lead so Nour's own
      // state hits the eye before market noise. Ops first because "due
      // today" is the most actionable signal — beats even brain nudges.
      const items: TickerItem[] = interleave(
        opsItems,
        selfItems,
        brainItems,
        timelineItems,
        marketItems,
        STATIC_MACRO,
        shopItems,
      );

      return {
        items,
        generatedAt: new Date().toISOString(),
        softError:
          marketItems.length === 0 &&
          timelineItems.length === 0 &&
          shopItems.length === 0 &&
          brainItems.length === 0 &&
          selfItems.length === 0 &&
          opsItems.length === 0
            ? "feeds unavailable — showing macro only"
            : undefined,
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          items: STATIC_MACRO,
          generatedAt: new Date().toISOString(),
          softError: String(err),
        },
      },
      { status: 200 },
    );
  }
}
