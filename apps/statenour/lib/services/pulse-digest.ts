/**
 * lib/services/pulse-digest.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The ranked-and-clustered notification-bell digest · lifted verbatim
 * from app/api/ultron/pulse-digest/route.ts so the legacy REST endpoint
 * AND the new `brain.pulseDigest` tRPC procedure call the SAME function
 * · drift between consumers structurally impossible.
 *
 * Clusters DriftAlerts (de-duped by ruleName) + brain_insight AuditEvents
 * + today's wins into priority / emerging / wins / maintenance tiers.
 *
 * Returns an explicit, shallow `PulseDigest` shape — every field is a
 * scalar projection (the AuditEvent `payload` Json is read only to
 * derive a deep-link string inside this module · never returned) so
 * the recursive `JsonValue` type never reaches the AppRouter — the
 * TS2589 firewall.
 */

import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface DigestItem {
  id: string;
  headline: string;
  detail?: string;
  kind: "drift" | "insight" | "win" | "error" | "maintenance";
  severity: "critical" | "warning" | "info" | "win";
  streakDays?: number;
  at: string;
  /** Deep link · every surfaced item takes the operator somewhere useful. */
  link?: string;
}

export interface PulseDigest {
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
    const p = (payload ?? {}) as { top?: { key?: string }; key?: string };
    const k = p.top?.key ?? p.key;
    return k ? `/brain?resolve=${k}` : "/brain";
  }
  if (
    a.includes("skill") ||
    a.includes("belief") ||
    a.includes("identity") ||
    a.includes("ghost") ||
    a.includes("narrator") ||
    a.includes("qualitative") ||
    a.includes("decay") ||
    a.includes("brain_reset")
  ) {
    return "/brain";
  }
  if (a === "system" || a.includes("watcher") || a.includes("cron")) {
    return "/system/health";
  }
  if (a.includes("distill")) return "/brain";
  return "/brain";
}

/**
 * Actors hidden from the user-facing notification bell — system-health
 * signals that belong in /system/health + cron control, not the
 * personal pulse.
 */
const HIDDEN_ACTORS = new Set([
  "system",
  "cron_watcher",
  "cron_health",
  "backlog_triage",
]);

function isHiddenInsight(
  actor: string | null | undefined,
  detail: string,
): boolean {
  const a = (actor ?? "").toLowerCase();
  if (HIDDEN_ACTORS.has(a)) return true;
  if (detail.startsWith("CRON WATCHER:")) return true;
  if (detail.startsWith("⚙︎ ")) return true;
  return false;
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * Build the pulse digest. The REST route and the tRPC `brain.pulseDigest`
 * procedure both call this. 60s-cached via `cached()` so the 5-minute
 * client poll never hammers Neon.
 */
export async function buildPulseDigest(): Promise<PulseDigest> {
  return cached<PulseDigest>("ultron_pulse_digest_v1", 60, async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      drifts,
      insights,
      doneToday,
      autoActionsToday,
      reflectionsToday,
      brainDigestToday,
      aiErrorBurst,
    ] = await Promise.all([
      prisma.brainMemory
        .findMany({
          where: {
            category: "coach_event",
            key: { startsWith: "coach:drift-recovery:" },
          },
          orderBy: { createdAt: "desc" },
          select: {
            key: true,
            content: true,
            metadata: true,
            createdAt: true,
          },
        })
        .then((rows) => {
          const unresolved = rows.filter((r) => {
            const meta = (r.metadata ?? {}) as Record<string, any>;
            return !meta.ackedAt;
          });
          return unresolved.map((r) => {
            const meta = (r.metadata ?? {}) as Record<string, any>;
            const ruleId = r.key.replace("coach:drift-recovery:", "");
            const severity = meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "high" : "warning";
            return {
              id: r.key,
              ruleId,
              ruleName: r.content,
              severity,
              message: typeof meta.body === "string" ? meta.body : "",
              createdAt: r.createdAt,
            };
          });
        })
        .catch((): Array<{ id: string; ruleId: string; ruleName: string; severity: string; message: string; createdAt: Date }> => []),
      prisma.auditEvent.findMany({
        where: {
          eventType: "brain_insight",
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          detail: true,
          payload: true,
          actor: true,
          createdAt: true,
        },
      }),
      prisma.task.count({
        where: { status: "DONE", deletedAt: null, updatedAt: { gte: today } },
      }),
      prisma.autonomousAction.count({
        where: { result: "success", executedAt: { gte: today } },
      }),
      prisma.reflection.count({
        where: {
          deletedAt: null,
          date: new Date().toLocaleDateString("en-CA", {
            timeZone: "America/New_York",
          }),
        },
      }),
      prisma.brainMemory.findFirst({
        where: {
          category: BRAIN_CATEGORIES.BACKLOG_TRIAGE,
          createdAt: { gte: today },
        },
        select: { content: true, createdAt: true },
      }),
      prisma.auditEvent.count({
        where: {
          eventType: "ai_error",
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      }),
    ]);

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
      const byDomain = new Map<string, { count: number; latest?: string }>();
      for (const e of recentErrors) {
        const domain = (
          e.detail?.split(":")?.slice(0, 2).join(":") ||
          e.actor ||
          "unknown"
        ).trim();
        const current = byDomain.get(domain) ?? { count: 0 };
        current.count += 1;
        if (!current.latest && e.detail) {
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
        Math.floor(
          (entry.lastAt.getTime() - entry.firstAt.getTime()) / 86400000,
        ) + 1,
      );
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

    if (aiErrorBurst >= 3) {
      const breakdownLine =
        aiErrorBreakdown.length > 0
          ? aiErrorBreakdown.map((b) => `${b.count}× ${b.domain}`).join(" · ")
          : "domains unknown";
      const topErr = aiErrorBreakdown[0];
      const latestLine = topErr?.latest ? `\n↳ latest: ${topErr.latest}` : "";
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
        detail:
          doneToday >= 3
            ? "above-average execution · protect the streak"
            : undefined,
        kind: "win",
        severity: "win",
        at: new Date().toISOString(),
        link: "/missions",
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
        link: "/missions",
      });
    }

    // ── Summary mood ──
    const criticalCount = priority.filter(
      (p) => p.severity === "critical",
    ).length;
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
        total:
          priority.length +
          dedupedEmerging.length +
          wins.length +
          maintenance.length,
        headline,
        mood,
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
