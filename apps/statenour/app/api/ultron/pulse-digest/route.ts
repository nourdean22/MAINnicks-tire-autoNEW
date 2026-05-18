import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// CP7 · Railway build cannot reach Neon during static prerender. Force
// runtime-only · same effective behavior as Vercel due to cached().
export const dynamic = "force-dynamic";

/**
 * GET /api/ultron/pulse-digest
 *
 * Replacement data source for the raw-list notification bell.
 * Instead of dumping every DriftAlert + AuditEvent as its own row
 * (which made the bell feel generic — same 4 messages repeating every
 * day with a fresh timestamp), this endpoint CLUSTERS and RANKS.
 *
 * Tiers returned (each ordered by intensity):
 *   priority   — de-duped critical signals. Stale alert that fired
 *                today AND yesterday collapses to one row with a
 *                "×3d" streak badge, and the ruleName determines the
 *                single headline.
 *   emerging   — brain_insight audit events (cross-domain pattern
 *                detections like "attention scattered across 60 loops").
 *                These are the sharpest pieces of insight we generate
 *                but they were buried in the raw list.
 *   wins       — today's task completions, successful autonomous
 *                actions, score logged, brain digest hits. Counteracts
 *                the warn-heavy tilt of the old feed.
 *   maintenance — old drift alerts queued for auto-resolve by the
 *                backlog-triage engine. Collapsed to a single count so
 *                the priority section doesn't drown in noise.
 *
 * Also returns a `summary` with the total across tiers + the single
 * highest-intensity headline for use in the bell badge or the HQ
 * header strip.
 */

export const revalidate = 60;

interface DigestItem {
  id: string;
  headline: string;
  detail?: string;
  kind: "drift" | "insight" | "win" | "error" | "maintenance";
  severity: "critical" | "warning" | "info" | "win";
  streakDays?: number;
  at: string;
  /** Apr 19 — deep link. Every surfaced item should take Nour somewhere
   *  useful on click so the bell is a true action center, not a ledger. */
  link?: string;
}

/**
 * Derive a deep-link for a brain_insight row based on the actor that
 * emitted it. Keeps the routing logic centralized so adding a new
 * brain subsystem only needs one update.
 */
function linkForInsightActor(
  actor: string | null | undefined,
  payload: unknown,
): string {
  const a = (actor ?? "").toLowerCase();
  if (a.includes("contradiction")) {
    // Prefer the specific contradiction if we persisted one
    const p = (payload ?? {}) as { top?: { key?: string }; key?: string };
    const k = p.top?.key ?? p.key;
    return k ? `/brain?resolve=${k}` : "/brain";
  }
  if (a.includes("skill") || a.includes("belief") || a.includes("identity") ||
      a.includes("ghost") || a.includes("narrator") || a.includes("qualitative") ||
      a.includes("decay") || a.includes("brain_reset")) {
    return "/brain";
  }
  if (a === "system" || a.includes("watcher") || a.includes("cron")) {
    return "/system/health";
  }
  if (a.includes("distill")) return "/brain";
  return "/brain";
}

/**
 * Actors we hide from the user-facing notification bell. These are
 * system-health signals that belong in /system/health + cron control,
 * not the personal pulse. Nour can audit them there when he wants.
 */
const HIDDEN_ACTORS = new Set([
  "system",           // CRON WATCHER + similar system diagnostics
  "cron_watcher",
  "cron_health",
  "backlog_triage",   // housekeeping, already collapsed under maintenance
]);

function isHiddenInsight(actor: string | null | undefined, detail: string): boolean {
  const a = (actor ?? "").toLowerCase();
  if (HIDDEN_ACTORS.has(a)) return true;
  if (detail.startsWith("CRON WATCHER:")) return true;
  if (detail.startsWith("⚙︎ ")) return true; // already-prettified watcher
  return false;
}

interface PulseDigest {
  priority: DigestItem[];
  emerging: DigestItem[];
  wins: DigestItem[];
  maintenance: { count: number; sample: string | null };
  summary: {
    total: number;
    headline: string | null;
    mood: "alert" | "emerging" | "steady" | "quiet";
  };
  generatedAt: string;
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export async function GET() {
  try {
    const payload = await cached<PulseDigest>("ultron_pulse_digest_v1", 60, async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // ── Raw pulls ──
      // Apr 17: dailyScore retired → swap for reflection count (any
      // reflection today counts as a score-win signal).
      const [drifts, insights, doneToday, autoActionsToday, reflectionsToday, brainDigestToday, aiErrorBurst] =
        await Promise.all([
          prisma.driftAlert.findMany({
            where: { resolved: false },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              ruleId: true,
              ruleName: true,
              severity: true,
              message: true,
              createdAt: true,
            },
          }),
          prisma.auditEvent.findMany({
            where: {
              eventType: "brain_insight",
              createdAt: { gte: sevenDaysAgo },
            },
            orderBy: { createdAt: "desc" },
            take: 20, // pull more now that we filter system/watcher
            select: { id: true, detail: true, payload: true, actor: true, createdAt: true },
          }),
          prisma.task.count({
            where: { status: "DONE", updatedAt: { gte: today } },
          }),
          prisma.autonomousAction.count({
            where: { result: "success", executedAt: { gte: today } },
          }),
          prisma.reflection.count({
            where: {
              date: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
            },
          }),
          prisma.brainMemory.findFirst({
            where: { category: BRAIN_CATEGORIES.BACKLOG_TRIAGE, createdAt: { gte: today } },
            select: { content: true, createdAt: true },
          }),
          prisma.auditEvent.count({
            where: {
              eventType: "ai_error",
              createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            },
          }),
        ]);

      // v11.1 · Grab the most common error DOMAINS in the burst window
      // so the HUD card can say "4× chat:post-process + 1× chat:db-write"
      // instead of the generic "Check /api/ai/errors/recent for details".
      // Skip the DB round-trip entirely when the burst is below threshold.
      //
      // v11.2 · ENR1 — Also capture the LATEST error message per domain.
      // Old card said "5 errors in 60min · 4× chat:post-process · 1×
      // chat:db-write · check endpoint". New card also carries the
      // specific latest failure string. So "something's wrong" becomes
      // "this is what's wrong", no separate endpoint round-trip needed.
      let aiErrorBreakdown: Array<{
        domain: string;
        count: number;
        latest?: string;
      }> = [];
      if (aiErrorBurst >= 3) {
        const recentErrors = await prisma.auditEvent.findMany({
          where: {
            eventType: "ai_error",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          orderBy: { createdAt: "desc" },
          select: { actor: true, detail: true },
          take: 50,
        });
        const byDomain = new Map<
          string,
          { count: number; latest?: string }
        >();
        for (const e of recentErrors) {
          // detail is "domain: message" — prefer that for specificity,
          // fall back to actor when detail is unexpectedly short.
          const domain = (
            e.detail?.split(":")?.slice(0, 2).join(":") ||
            e.actor ||
            "unknown"
          ).trim();
          const current = byDomain.get(domain) ?? { count: 0 };
          current.count += 1;
          // Because results are ORDER BY createdAt DESC, the first row
          // we see per domain IS the latest. Only set if not yet set.
          if (!current.latest && e.detail) {
            // Strip the domain prefix so the displayed message is just
            // the failure description. Truncate to a reasonable preview.
            const parts = e.detail.split(":");
            const msg =
              parts.length > 2 ? parts.slice(2).join(":").trim() : e.detail;
            current.latest = msg.slice(0, 120);
          }
          byDomain.set(domain, current);
        }
        aiErrorBreakdown = [...byDomain.entries()]
          .map(([domain, v]) => ({
            domain,
            count: v.count,
            latest: v.latest,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
      }

      // ── Dedup drift alerts by ruleName ──
      // Old bell showed "novelty-seeking" and "no score 2 days" as
      // separate entries every day they re-fire. Collapse on ruleName
      // + ruleId, keep the newest, show the streak in days.
      const driftByRule = new Map<
        string,
        { firstAt: Date; lastAt: Date; alerts: typeof drifts }
      >();
      for (const a of drifts) {
        const key = a.ruleId || a.ruleName;
        const entry = driftByRule.get(key) ?? {
          firstAt: a.createdAt,
          lastAt: a.createdAt,
          alerts: [],
        };
        entry.alerts.push(a);
        if (a.createdAt < entry.firstAt) entry.firstAt = a.createdAt;
        if (a.createdAt > entry.lastAt) entry.lastAt = a.createdAt;
        driftByRule.set(key, entry);
      }

      const priority: DigestItem[] = [];
      const maintenance: typeof drifts = [];

      for (const [, entry] of driftByRule) {
        const newest = entry.alerts[0];
        const age = daysSince(entry.lastAt);
        const streakDays = Math.max(
          1,
          Math.floor((entry.lastAt.getTime() - entry.firstAt.getTime()) / 86400000) + 1
        );
        // Alerts older than 14d are just waiting for the backlog-triage
        // cron to auto-resolve; they shouldn't take a priority slot.
        if (age > 14) {
          maintenance.push(newest);
          continue;
        }
        const severity: DigestItem["severity"] =
          newest.severity === "critical"
            ? "critical"
            : newest.severity === "high" || newest.severity === "warning"
              ? "warning"
              : "info";
        priority.push({
          id: `drift-${newest.id}`,
          headline: newest.ruleName,
          detail: newest.message.slice(0, 160),
          kind: "drift",
          severity,
          streakDays: streakDays > 1 ? streakDays : undefined,
          at: newest.createdAt.toISOString(),
          link: "/system/health",
        });
      }

      // AI error burst (only if ≥ 3 in the last hour)
      if (aiErrorBurst >= 3) {
        // v11.2 · Three-line detail now:
        //   line 1: "4× chat:post-process · 1× chat:db-write"
        //   line 2: "↳ latest: timeout after 5000ms"
        //   line 3: "/api/ai/errors/recent" (deep link trailer)
        // Lets Nour diagnose without opening the raw endpoint in most
        // cases — the specific failure message tells him what's wrong.
        const breakdownLine = aiErrorBreakdown.length > 0
          ? aiErrorBreakdown.map((b) => `${b.count}× ${b.domain}`).join(" · ")
          : "domains unknown";
        const topErr = aiErrorBreakdown[0];
        const latestLine = topErr?.latest
          ? `\n↳ latest: ${topErr.latest}`
          : "";
        priority.push({
          id: `ai-error-burst-${Math.floor(Date.now() / 60_000)}`,
          headline: `AI pipeline: ${aiErrorBurst} errors in 60min`,
          detail: `${breakdownLine}${latestLine}\n/api/ai/errors/recent`,
          kind: "error",
          severity: "critical",
          at: new Date().toISOString(),
          link: "/system/health",
        });
      }

      // Sort priority: critical > warning > info, newest first
      const severityRank: Record<DigestItem["severity"], number> = {
        critical: 0,
        warning: 1,
        info: 2,
        win: 3,
      };
      priority.sort((a, b) => {
        const bySev = severityRank[a.severity] - severityRank[b.severity];
        if (bySev !== 0) return bySev;
        return new Date(b.at).getTime() - new Date(a.at).getTime();
      });

      // ── Emerging: brain_insights — user-facing only ──
      // Apr 19 · Watcher + system-origin insights are HIDDEN from the
      // notification bell. They live on /system/health + /settings cron
      // control where Nour can audit them if he wants. The bell is
      // reserved for personal pulse signals (skills, beliefs, identity
      // shifts, contradictions, wins, drift) that need his attention.
      // Every surfaced item carries a deep link via the `link` field
      // so clicking takes him straight to the relevant page.
      const emerging: DigestItem[] = [];
      for (const e of insights) {
        const detail = typeof e.detail === "string" ? e.detail : "";
        if (!detail || detail.length < 15) continue;
        if (isHiddenInsight(e.actor, detail)) continue;

        const headline = detail.slice(0, 90);
        const payload = e.payload ?? null;
        emerging.push({
          id: `insight-${e.id}`,
          headline,
          detail: detail.length > 90 ? detail.slice(90, 260) : undefined,
          kind: "insight",
          severity: "info",
          at: e.createdAt.toISOString(),
          link: linkForInsightActor(e.actor, payload),
        });
      }
      // Keep the 4 newest + most distinct insights
      const seenKeywords = new Set<string>();
      const dedupedEmerging: DigestItem[] = [];
      for (const e of emerging) {
        const key = e.headline.toLowerCase().slice(0, 40);
        if (seenKeywords.has(key)) continue;
        seenKeywords.add(key);
        dedupedEmerging.push(e);
        if (dedupedEmerging.length >= 4) break;
      }

      // ── Wins ──
      const wins: DigestItem[] = [];
      if (doneToday > 0) {
        wins.push({
          id: "wins-tasks",
          headline: `${doneToday} task${doneToday === 1 ? "" : "s"} done today`,
          detail: doneToday >= 3 ? "above-average execution · protect the streak" : undefined,
          kind: "win",
          severity: "win",
          at: new Date().toISOString(),
          link: "/tasks",
        });
      }
      if (autoActionsToday > 0) {
        wins.push({
          id: "wins-auto",
          headline: `${autoActionsToday} autonomous action${autoActionsToday === 1 ? "" : "s"} executed`,
          detail: "system moved in background without a prompt",
          kind: "win",
          severity: "win",
          at: new Date().toISOString(),
          link: "/system/health",
        });
      }
      if (reflectionsToday > 0) {
        wins.push({
          id: "wins-reflection",
          headline: `${reflectionsToday} reflection${reflectionsToday === 1 ? "" : "s"} logged today`,
          detail:
            reflectionsToday >= 2
              ? "double reflection day · deep awareness signal"
              : "self-tracking loop closed",
          kind: "win",
          severity: "win",
          at: new Date().toISOString(),
          link: "/journal",
        });
      }
      if (brainDigestToday) {
        wins.push({
          id: "wins-triage",
          headline: "backlog triaged today",
          detail: brainDigestToday.content.split("\n")[0]?.slice(0, 80),
          kind: "win",
          severity: "win",
          at: brainDigestToday.createdAt.toISOString(),
          link: "/tasks",
        });
      }

      // ── Summary mood ──
      const criticalCount = priority.filter((p) => p.severity === "critical").length;
      const headline =
        priority[0]?.headline ??
        dedupedEmerging[0]?.headline ??
        wins[0]?.headline ??
        null;
      const mood: PulseDigest["summary"]["mood"] =
        criticalCount > 0
          ? "alert"
          : dedupedEmerging.length > 0
            ? "emerging"
            : priority.length > 0 || wins.length > 0
              ? "steady"
              : "quiet";

      return {
        priority: priority.slice(0, 6),
        emerging: dedupedEmerging,
        wins: wins.slice(0, 4),
        maintenance: {
          count: maintenance.length,
          sample:
            maintenance[0]?.ruleName ??
            (maintenance.length > 0 ? "old drift alerts" : null),
        },
        summary: {
          total: priority.length + dedupedEmerging.length + wins.length + maintenance.length,
          headline,
          mood,
        },
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          priority: [],
          emerging: [],
          wins: [],
          maintenance: { count: 0, sample: null },
          summary: { total: 0, headline: null, mood: "quiet" as const },
          generatedAt: new Date().toISOString(),
        },
        error: String(err),
      },
      { status: 200 }
    );
  }
}
