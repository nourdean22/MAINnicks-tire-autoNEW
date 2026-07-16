/**
 * lib/services/ultron-ticker.ts · Phase B.6a (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · operator-domain
 * sub-slice).
 *
 * The ambient awareness feed for the Ultron top strip. Pulls:
 *   - Simulated timelines (personal what-if projections)
 *   - Market snapshots (S&P, DJI, NASDAQ, oil, gold) from Stooq
 *   - General / macro / auto-industry headlines from a curated set
 *   - Shop pulse from nickstire · brain pulse · self metrics · ops
 *
 * Items are interleaved so the operator's own intelligence surfaces
 * alongside world data — not buried at the end.
 *
 * Extracted from the inline route logic in app/api/ultron/ticker/route.ts
 * so BOTH the legacy REST route AND the new `operator.ticker` tRPC
 * procedure call the same `buildTickerFeed` function · drift
 * impossible. The `cached()` wrapper lives inside `buildTickerFeed`
 * so both transports share the 60s window.
 *
 * Sources are free and non-authenticated. If any upstream is down,
 * the payload carries a softError so the UI shows stale data rather
 * than blank.
 */

import { cached } from "@/lib/utils/cache";
import { computeInputs, generateTimelines, type Timeline } from "@/lib/ultron/timelines";
import { queryNickBatch } from "@/lib/nickstire/query";
import type { Nudge } from "@/lib/brain/cross-system-nudge";
import type { IdentityAxis, AxisKey } from "@/lib/brain/identity-snapshot";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface TickerItem {
  id: string;
  category:
    | "market"
    | "macro"
    | "industry"
    | "local"
    | "timeline"
    | "shop"
    | "brain";
  symbol?: string;
  label: string;
  deltaPct?: number | null;
  severity?: "info" | "warn" | "win";
  domain?: string;
  href?: string;
  at?: string;
}

export interface TickerPayload {
  items: TickerItem[];
  generatedAt: string;
  softError?: string;
}

// Stooq free quotes endpoint — CSV per symbol, no API key needed.
const STOOQ_QUOTES = [
  { symbol: "^spx", label: "S&P" },
  { symbol: "^ndq", label: "NASDAQ" },
  { symbol: "^dji", label: "DOW" },
  { symbol: "cl.f", label: "OIL" },
  { symbol: "gc.f", label: "GOLD" },
] as const;

async function fetchStooqQuote(
  symbol: string,
  label: string,
): Promise<TickerItem | null> {
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

// STATIC_MACRO removed 2026-05-31 — was 4 hardcoded fake macro/weather
// headlines ("Fed holds rates next week", "Tire futures ▼2% Q2", "Ontario
// snow advisory Thursday", …) that never updated. Real market data is live
// from Stooq above; the empty-feed case is handled by the softError below.
export const STATIC_MACRO: TickerItem[] = [];

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
 * Failure is silent · the ticker renders without shop items rather
 * than blocking on nickstire latency.
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
 * Interleave four streams (timelines, markets, macro, shop) so the
 * user's own intelligence surfaces throughout, not only bunched at
 * the end.
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
 * BODY + MONEY ticker items — ZERO stale fallbacks.
 *
 * BODY emits ONLY when a workout DAILY task has a live streak
 * (lastCompletedAt within the last 2 days). MONEY emits ONLY when
 * the freshest FinancialSnapshot is <45 days old.
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
        .catch(
          () =>
            null as {
              streakCount: number;
              lastCompletedAt: Date | null;
              title: string;
            } | null,
        ),
      prisma.financialSnapshot
        .findMany({
          orderBy: { date: "desc" },
          take: 12,
          select: { netWorthEstimate: true, date: true },
        })
        .catch(
          () => [] as Array<{ netWorthEstimate: number | null; date: string }>,
        ),
    ]);

    const items: TickerItem[] = [];

    // ── BODY (live only) ──
    if (
      workoutStreak &&
      workoutStreak.streakCount > 0 &&
      workoutStreak.lastCompletedAt
    ) {
      const daysSince =
        (Date.now() - workoutStreak.lastCompletedAt.getTime()) / 86400_000;
      if (daysSince < 2) {
        items.push({
          id: "self-body",
          category: BRAIN_CATEGORIES.TIMELINE,
          symbol: "BODY",
          label: `${workoutStreak.streakCount}d workout streak 🔥`,
          deltaPct: null,
          severity: "win",
          domain: "body",
          href: "/stats#body",
        });
      }
    }

    // ── MONEY (fresh only) ──
    if (finSnaps.length >= 2) {
      const latest = finSnaps[0];
      const latestAge =
        (Date.now() - new Date(latest.date).getTime()) / 86400_000;
      if (latestAge < 45) {
        const prev = finSnaps[finSnaps.length - 1].netWorthEstimate ?? 0;
        const current = latest.netWorthEstimate ?? 0;
        const netDelta = current - prev;
        if (Math.abs(netDelta) > 50) {
          const sign = netDelta < 0 ? "-" : "+";
          const abs = Math.abs(netDelta);
          const formatted =
            abs >= 1000
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
            href: "/business?tab=money",
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
 * Personal-ops items folded from the old chat-header LiveHudBar.
 * Items only emit on a real signal · silent ticker beats noise.
 */
async function fetchPersonalOpsItems(): Promise<TickerItem[]> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const [tasksDue, tasksActive, costData] = await Promise.all([
      prisma.task
        .count({
          where: {
            status: { in: ["READY", "DOING", "WAITING"] },
            deletedAt: null,
            dueDate: { not: null, lte: todayEnd },
          },
        })
        .catch(() => null as number | null),
      prisma.task
        .count({ where: { status: { in: ["READY", "DOING", "WAITING"] }, deletedAt: null } })
        .catch(() => null as number | null),
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
        tasksActive !== null && tasksActive > tasksDue
          ? ` · ${tasksActive} active`
          : "";
      items.push({
        id: "ops-tasks",
        category: BRAIN_CATEGORIES.TIMELINE,
        symbol: "TASKS",
        label: `${tasksDue} due today${activeStr}`,
        severity: tasksDue >= 5 ? "warn" : "info",
        domain: "life",
        href: "/missions",
      });
    }

    // ── COST · only when > $1 spent on AI today ──
    const cents = costData?._sum.costCents ?? null;
    if (cents !== null && cents >= 100) {
      const dollars = cents / 100;
      const formatted =
        dollars >= 100 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`;
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
    const [maturityMod, nudgeMod, contradictionMod, identityMod] =
      await Promise.all([
        import("@/app/api/brain/maturity/route").catch(() => null),
        import("@/lib/brain/cross-system-nudge"),
        import("@/lib/brain/contradiction-surfacer"),
        import("@/lib/brain/identity-snapshot"),
      ]);
    const [nudges, openContradictions, snap] = await Promise.all([
      nudgeMod.computeNudges().catch(() => []),
      contradictionMod.countUnresolved(14).catch(() => 0),
      identityMod.loadIdentitySnapshot().catch(() => null),
    ]);
    void maturityMod; // silence unused import warning

    const items: TickerItem[] = [];

    // High-severity nudges — most important signal
    for (const n of nudges
      .filter((x: Nudge) => x.severity === "high")
      .slice(0, 2)) {
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
      const shifting = (
        Object.entries(snap.axes) as Array<[AxisKey, IdentityAxis]>
      ).find(([, a]) => a.direction !== "stable" && a.evidence.length > 0);
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

/**
 * Ambition Engine · mastery momentum — the stat rising fastest this week +
 * the one closest to leveling (the "next rep"). Connects the new goal→stat
 * spine to the ambient feed. Reads the character sheet (cached by the outer
 * wrapper). Best-effort: a failure just omits the lane.
 */
async function fetchMasteryItems(): Promise<TickerItem[]> {
  try {
    const { computeCharacterSheet } = await import("@/lib/mastery/character-sheet");
    const stats = await computeCharacterSheet().catch((): never[] => []);
    if (stats.length === 0) return [];
    const items: TickerItem[] = [];

    // Fastest riser this week — momentum is in the derivative.
    const riser = stats.reduce<(typeof stats)[number] | null>(
      (best, s) => (s.rising7dXp > (best?.rising7dXp ?? 0) ? s : best),
      null,
    );
    if (riser && riser.rising7dXp > 0) {
      items.push({
        id: "mastery-riser",
        category: BRAIN_CATEGORIES.TIMELINE,
        symbol: "LEVEL",
        label: `${riser.icon} ${riser.label} +${riser.rising7dXp} XP this week`,
        severity: "win",
        domain: "mastery",
        href: "/stats",
      });
    }

    // Closest to leveling — the agentic "next rep" (the easiest win to chase).
    const next = stats.reduce<(typeof stats)[number] | null>(
      (best, s) => (s.progressPct > (best?.progressPct ?? 0) ? s : best),
      null,
    );
    if (next && next.progressPct >= 50 && next.progressPct < 100) {
      const xpToGo = Math.max(1, Math.round(next.xpForNext - next.xpIntoLevel));
      items.push({
        id: "mastery-next",
        category: BRAIN_CATEGORIES.TIMELINE,
        symbol: "NEXT",
        label: `${next.icon} ${next.label} · ${xpToGo} XP → Lvl ${next.level + 1}`,
        severity: "info",
        domain: "mastery",
        href: "/stats",
      });
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Build the full ticker payload · cached 60s (short because personal
 * timelines change intra-day). Both the REST route and the
 * `operator.ticker` tRPC procedure call this.
 */
export async function buildTickerFeed(): Promise<TickerPayload> {
  return cached<TickerPayload>("ultron_ticker_v7", 60, async () => {
    const [inputs, quotes, shopItems, brainItems, selfItems, opsItems, masteryItems] =
      await Promise.all([
        computeInputs().catch(() => null),
        Promise.all(STOOQ_QUOTES.map((q) => fetchStooqQuote(q.symbol, q.label))),
        fetchShopPulse(),
        fetchBrainPulseItems(),
        fetchSelfMetricsTop(),
        fetchPersonalOpsItems(),
        fetchMasteryItems(),
      ]);
    const marketItems = quotes.filter((q): q is TickerItem => q !== null);
    const timelineItems = inputs
      ? generateTimelines(inputs).map(timelineToTickerItem)
      : [];

    // Interleave. Ops + self metrics + brain items lead so Nour's own
    // state hits the eye before market noise.
    const items: TickerItem[] = interleave(
      opsItems,
      masteryItems,
      selfItems,
      brainItems,
      timelineItems,
      marketItems,
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
        opsItems.length === 0 &&
        masteryItems.length === 0
          ? "feeds unavailable — showing macro only"
          : undefined,
    };
  });
}
