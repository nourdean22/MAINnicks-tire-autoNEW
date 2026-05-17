/**
 * Cross-system nudge — closes the loop between identity, skills,
 * ghost, and contradictions. Apr 19.
 *
 * Until now each brain system ran in isolation. This module reads
 * identity axes + open contradictions + ghost accuracy and produces
 * a short set of nudge strings that the chat route + narrator can
 * reference. Each nudge is short, actionable, and grounded in the
 * specific data that triggered it (no vague "be better").
 *
 * Example outputs:
 *   "promise_integrity is 42 (↓) · check /commitments for 3 open
 *    promises before committing to more"
 *   "2 unresolved contradictions from the last 7d · open /brain to
 *    reconcile"
 *   "ghost accuracy 73% (12/16) — rhythm is predictable"
 *
 * Shape:
 *   severity: "high" | "medium" | "low"
 *   source:   which subsystem produced it
 *   text:     one short sentence
 *   link:     optional deep-link
 */

import { loadIdentitySnapshot, type AxisKey } from "./identity-snapshot";
import { countUnresolved } from "./contradiction-surfacer";
import { loadGhostAccuracy } from "./ghost-nick";
import { loadActiveSkills, loadPendingSkills } from "./skill-extractor";
import { prisma } from "@/lib/prisma";

export interface Nudge {
  severity: "high" | "medium" | "low";
  source:
    | "identity"
    | "contradiction"
    | "ghost"
    | "skill"
    | "pin_hygiene"
    | "belief_refresh"
    // v11.1 meta-intelligence sources (F2–F5)
    | "correlation"
    | "decision_drift"
    | "prediction_streak"
    | "blind_spot";
  text: string;
  link?: string;
}

// Weakness threshold per axis — below this, nudge fires
const WEAKNESS_FLOOR: Record<AxisKey, number> = {
  velocity: 45,
  patience_horizon: 35,
  promise_integrity: 55,       // higher — broken promises cost more
  dopamine_discipline: 40,
  business_vs_personal: 20,    // extreme low is unhealthy
  risk_appetite: 25,
  social_battery: 30,
  reflection_cadence: 35,
};

// Human-readable axis phrasing for nudges
const AXIS_NUDGE_TEXT: Partial<Record<AxisKey, (value: number) => string>> = {
  promise_integrity: (v) =>
    `promise integrity ${v} (↓) — check /commitments for open promises before adding more`,
  patience_horizon: (v) =>
    `patience horizon ${v} (↓) — you're committing to same-week deadlines; try staging 2+ weeks out`,
  dopamine_discipline: (v) =>
    `dopamine discipline ${v} (↓) — capture cadence drifting; set a focus block`,
  reflection_cadence: (v) =>
    `reflection cadence ${v} (↓) — last sit-down is stale; tonight's a good one`,
  risk_appetite: (v) =>
    `risk appetite ${v} (↓) — wins lately are low-stakes; pick one critical item`,
  social_battery: (v) =>
    `social battery ${v} (↓) — you've been heads-down alone this week`,
  velocity: (v) =>
    `velocity ${v} (↓) — tasks are running long vs your estimates; calibrate downward`,
};

/**
 * Build a ranked list of nudges from the current state of every
 * brain subsystem. Returns [] when nothing pops — the silence is
 * the reward for being in rhythm.
 */
export async function computeNudges(): Promise<Nudge[]> {
  const [snap, unresolvedCount, accuracy, activeSkills, pendingSkills] = await Promise.all([
    loadIdentitySnapshot().catch(() => null),
    countUnresolved(14).catch(() => 0),
    loadGhostAccuracy().catch(() => null),
    loadActiveSkills().catch(() => []),
    loadPendingSkills().catch(() => []),
  ]);

  const nudges: Nudge[] = [];

  // ── Identity axis weaknesses ──
  if (snap) {
    for (const key of Object.keys(snap.axes) as AxisKey[]) {
      const a = snap.axes[key];
      const value = a.manual ?? a.value;
      if (value < WEAKNESS_FLOOR[key]) {
        const phraser = AXIS_NUDGE_TEXT[key];
        nudges.push({
          severity: value < WEAKNESS_FLOOR[key] - 15 ? "high" : "medium",
          source: "identity",
          text: phraser ? phraser(value) : `${key} weak (${value})`,
          link: "/settings",
        });
      }
    }
  }

  // ── Contradictions ──
  if (unresolvedCount > 0) {
    nudges.push({
      severity: unresolvedCount >= 3 ? "high" : "medium",
      source: "contradiction",
      text: `${unresolvedCount} unresolved contradiction${unresolvedCount > 1 ? "s" : ""} · reconcile in /brain`,
      link: "/brain",
    });
  }

  // ── Ghost Nick accuracy signal ──
  if (accuracy) {
    const total = accuracy.hits + accuracy.surprises;
    if (total >= 10) {
      const rate = accuracy.hits / total;
      if (rate < 0.3) {
        nudges.push({
          severity: "medium",
          source: "ghost",
          text: `ghost accuracy ${Math.round(rate * 100)}% — rhythm is unpredictable lately`,
        });
      } else if (rate >= 0.7) {
        nudges.push({
          severity: "low",
          source: "ghost",
          text: `ghost accuracy ${Math.round(rate * 100)}% (${accuracy.hits}/${total}) — rhythm solid`,
        });
      }
    }
  }

  // ── Unreviewed skill candidates pile up ──
  if (pendingSkills.length >= 5) {
    nudges.push({
      severity: pendingSkills.length >= 10 ? "medium" : "low",
      source: "skill",
      text: `${pendingSkills.length} unreviewed skill candidates · triage in /settings`,
      link: "/settings",
    });
  }

  // ── Active skills with no fires in 30d ──
  const stale = activeSkills.filter((s) => {
    if (s.graduated) return false;
    if (!s.last_fired) return false;
    const days = (Date.now() - new Date(s.last_fired).getTime()) / 86400_000;
    return days > 30;
  });
  if (stale.length > 0) {
    nudges.push({
      severity: "low",
      source: "skill",
      text: `${stale.length} active skill${stale.length > 1 ? "s" : ""} stale (30d+) · drop or reinforce`,
      link: "/settings",
    });
  }

  // ── Pin hygiene cron output (Apr 20) ──
  // The weekly /api/cron/pin-hygiene writes nudge_pin_hygiene rows
  // and the nightly /api/cron/auto-calibrate writes
  // belief_refresh_report rows. Both were going dark — the cron
  // persisted them but nothing surfaced them. Read + surface now so
  // the NudgePanel sees what maintenance ran.
  const [pinHygiene, beliefRefresh] = await Promise.all([
    prisma.brainMemory
      .findFirst({
        where: { category: "nudge_pin_hygiene", key: "weekly_pin_review" },
        select: { content: true, metadata: true, updatedAt: true },
      })
      .catch(() => null),
    prisma.brainMemory
      .findFirst({
        where: { category: "belief_refresh_report" },
        orderBy: { updatedAt: "desc" },
        select: { content: true, updatedAt: true, metadata: true },
      })
      .catch(() => null),
  ]);

  if (pinHygiene) {
    const age = Date.now() - new Date(pinHygiene.updatedAt).getTime();
    // Only surface if fresh this week (7d)
    if (age < 7 * 86400_000) {
      const meta = (pinHygiene.metadata as { findings?: Array<{ kind: string }> } | null) || null;
      const findings = meta?.findings || [];
      const veryStale = findings.filter((f) => f.kind === "very_stale").length;
      nudges.push({
        severity: veryStale > 0 ? "medium" : "low",
        source: "pin_hygiene",
        text: pinHygiene.content,
        link: "/brain#pinned-context",
      });
    }
  }

  if (beliefRefresh) {
    const age = Date.now() - new Date(beliefRefresh.updatedAt).getTime();
    // Only surface same-day (18h — spans the morning)
    if (age < 18 * 3600_000) {
      const meta = (beliefRefresh.metadata as { changes?: Array<{ action: string }> } | null) || null;
      const changes = meta?.changes || [];
      const needsReview = changes.filter((c) => c.action === "queued_for_review").length;
      nudges.push({
        severity: needsReview > 0 ? "medium" : "low",
        source: "belief_refresh",
        text:
          needsReview > 0
            ? `Overnight: ${beliefRefresh.content} · tap to review`
            : `Overnight: ${beliefRefresh.content}`,
        link: "/brain",
      });
    }
  }

  // v11.1 meta-intelligence sources (F2-F5) — read BrainMemory rows
  // the cron workers populate. Each cron writes a single canonical row
  // per concern; here we read them cheaply in parallel and translate
  // to nudges.
  const [corrAlerts, driftRow, streakRows, blindSpots] = await Promise.all([
    prisma.brainMemory.findMany({
      // v10.0.65 · soft-delete bypass fix on all 3 findMany sites
      // below — these feed the cross-system-nudge surface (HQ pulse
      // ticker, /brain/continuity). Pre-fix soft-deleted alerts /
      // streaks / pin candidates stayed in the nudge stream until
      // hard-deleted by data-cleanup cron.
      where: {
        category: "correlation_alert",
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { key: true, content: true, metadata: true },
    }).catch((): never[] => []),
    prisma.brainMemory.findUnique({
      where: { category_key: { category: "decision_drift", key: "weekly" } },
      select: { content: true, metadata: true, deletedAt: true },
    }).catch((): null => null),
    prisma.brainMemory.findMany({
      where: { category: "prediction_streak", deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { key: true, content: true, metadata: true },
    }).catch((): never[] => []),
    prisma.brainMemory.findMany({
      where: { category: "hq_pin_candidate", deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { key: true, content: true, metadata: true },
    }).catch((): never[] => []),
  ]);

  // F2 · correlation alerts — each NEW correlation surfaces once at
  // medium severity (the ambient-observation contract).
  for (const row of corrAlerts) {
    nudges.push({
      severity: "medium",
      source: "correlation",
      text: row.content,
      link: "/brain/continuity",
    });
  }

  // F3 · decision-quality drift — severity from metadata
  if (driftRow?.metadata && typeof driftRow.metadata === "object") {
    const meta = driftRow.metadata as { deltaPct?: number; severity?: string };
    const deltaPct = typeof meta.deltaPct === "number" ? meta.deltaPct : 0;
    if (deltaPct < -15) {
      nudges.push({
        severity: "high",
        source: "decision_drift",
        text: `Decision-quality dropped ${Math.abs(Math.round(deltaPct))}% vs prior 3w · regrade + reflect`,
        link: "/system/decision-drift",
      });
    } else if (deltaPct < -5) {
      nudges.push({
        severity: "low",
        source: "decision_drift",
        text: `Decision-quality softening (${Math.round(deltaPct)}% vs prior) · watch`,
        link: "/system/decision-drift",
      });
    }
  }

  // F4 · prediction-streak state = "extending" (celebrate) or "broken"
  // (reckon). "building" + "steady" → no nudge.
  for (const row of streakRows) {
    const meta = row.metadata as { state?: string; category?: string; currentStreak?: number; longestStreak?: number } | null;
    if (!meta || typeof meta !== "object") continue;
    if (meta.state === "extending" && typeof meta.currentStreak === "number" && meta.currentStreak >= 3) {
      nudges.push({
        severity: "low",
        source: "prediction_streak",
        text: `Nick on a ${meta.currentStreak}-streak for ${meta.category} predictions`,
      });
    } else if (meta.state === "broken" && typeof meta.longestStreak === "number" && meta.longestStreak >= 5) {
      nudges.push({
        severity: "medium",
        source: "prediction_streak",
        text: `${meta.category} streak ended at ${meta.longestStreak} · recalibrate the signals`,
      });
    }
  }

  // F5 · blind-spot critical pins — high severity, always surface
  for (const row of blindSpots) {
    const meta = row.metadata as { suggestedAction?: string; domain?: string } | null;
    nudges.push({
      severity: "high",
      source: "blind_spot",
      text: meta?.suggestedAction ? `BLIND SPOT · ${meta.domain}: ${meta.suggestedAction}` : row.content,
      link: "/system/blind-spots",
    });
  }

  // v11.1 · filter out ACKed nudges. Each dismiss writes a
  // BrainMemory row to category="nudge_ack" with a stable key
  // derived from {source, text}. We look up the current set once
  // (the table stays small — dismissals roll off via
  // metadata.expiresAt) and suppress anything that matches.
  const acks = await prisma.brainMemory.findMany({
    where: { category: "nudge_ack" },
    select: { key: true, metadata: true },
  });
  const now = Date.now();
  const ackedKeys = new Set<string>();
  for (const row of acks) {
    const meta = row.metadata as { expiresAt?: string | null } | null;
    if (meta?.expiresAt) {
      const exp = Date.parse(meta.expiresAt);
      if (Number.isFinite(exp) && exp < now) continue; // expired → not an ACK
    }
    ackedKeys.add(row.key);
  }
  function nudgeKey(source: string, text: string): string {
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
    return `${source}::${slug}`;
  }
  const filtered = nudges.filter((n) => !ackedKeys.has(nudgeKey(n.source, n.text)));

  filtered.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    return rank[b.severity] - rank[a.severity];
  });

  return filtered;
}

/**
 * Chat-turn block — renders nudges as short bullet list. Used by the
 * system prompt builder so Nick can reference the specific deltas
 * (instead of generic advice).
 */
export async function buildNudgeContextBlock(): Promise<string> {
  const nudges = await computeNudges();
  if (nudges.length === 0) return "";
  const lines: string[] = ["## Cross-system nudges (real-time)"];
  for (const n of nudges.slice(0, 6)) {
    const mark = n.severity === "high" ? "‼" : n.severity === "medium" ? "⚠" : "·";
    lines.push(`- ${mark} [${n.source}] ${n.text}`);
  }
  return lines.join("\n");
}
