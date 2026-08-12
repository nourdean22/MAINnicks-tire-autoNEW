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

import { loadIdentitySnapshot, type AxisKey, type AxisDirection } from "./identity-snapshot";
import { countUnresolved } from "./contradiction-surfacer";
import { loadGhostAccuracy } from "./ghost-nick";
import { loadActiveSkills, loadPendingSkills } from "./skill-extractor";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { brainMemory } from "@/lib/brain/memory-manager";
import { cached, invalidate } from "@/lib/utils/cache";

/**
 * 2026-08-06 · cache key for the whole nudge set. See `computeNudges`.
 *
 * MULTI-REPLICA CAVEAT — read before raising the TTL. `invalidate()`
 * clears L2 (Redis) and the calling replica's L1, but a SIBLING Railway
 * replica keeps serving its own warm L1 copy until that copy's own TTL
 * expires. So the worst-case "dismissed nudge is still on screen"
 * window equals the TTL, not zero. 300s is acceptable for a
 * single-operator app; every second added to the TTL is a second added
 * to that ghost window. Don't raise it without re-deciding that trade.
 */
const NUDGE_CACHE_KEY = "brain_nudges_v1";

/**
 * Stable BrainMemory(nudge_ack) key for a {source, text} pair. Module-
 * scoped so the dismiss path (`dismissNudge`) and the suppression
 * filter inside `computeNudges` derive the SAME key — a dismiss can
 * only land on the nudge it targets.
 */
function nudgeKey(source: string, text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
  return `${source}::${slug}`;
}

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

// 2026-08-12 · every phraser used to hardcode "(↓)" regardless of the
// axis's ACTUAL computed direction — a promise_integrity/reflection_cadence
// nudge read "(↓)" even on a prod snapshot where direction was "stable"
// (value pinned at its floor, not declining). Arrow now derives from the
// real field; "stable" gets no arrow rather than a fabricated one.
function trendArrow(direction: AxisDirection): string {
  if (direction === "rising") return " (↑)";
  if (direction === "falling") return " (↓)";
  return "";
}

// Human-readable axis phrasing for nudges
const AXIS_NUDGE_TEXT: Partial<Record<AxisKey, (value: number, arrow: string) => string>> = {
  // 2026-08-12 · dropped the "/commitments" reference — that route has
  // never existed, so the nudge sent the operator to a 404 every time
  // this fired. The open promises are already visible (and now directly
  // resolvable — Done/Drop buttons) in the pulse feed itself.
  promise_integrity: (v, arrow) =>
    `promise integrity ${v}${arrow} — resolve or drop the open promises in your pulse feed`,
  patience_horizon: (v, arrow) =>
    `patience horizon ${v}${arrow} — you're committing to same-week deadlines; try staging 2+ weeks out`,
  dopamine_discipline: (v, arrow) =>
    `dopamine discipline ${v}${arrow} — capture cadence drifting; set a focus block`,
  reflection_cadence: (v, arrow) =>
    `reflection cadence ${v}${arrow} — last sit-down is stale; tonight's a good one`,
  risk_appetite: (v, arrow) =>
    `risk appetite ${v}${arrow} — wins lately are low-stakes; pick one critical item`,
  social_battery: (v, arrow) =>
    `social battery ${v}${arrow} — you've been heads-down alone this week`,
  velocity: (v, arrow) =>
    `velocity ${v}${arrow} — tasks are running long vs your estimates; calibrate downward`,
};

/**
 * Build a ranked list of nudges from the current state of every
 * brain subsystem. Returns [] when nothing pops — the silence is
 * the reward for being in rhythm.
 *
 * Not exported — every caller goes through the cached `computeNudges`
 * below, so the wrapper can stay one line and the cache can't be
 * accidentally bypassed on the chat hot path.
 */
async function computeNudgesUncached(): Promise<Nudge[]> {
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
        const arrow = trendArrow(a.direction);
        nudges.push({
          severity: value < WEAKNESS_FLOOR[key] - 15 ? "high" : "medium",
          source: "identity",
          text: phraser ? phraser(value, arrow) : `${key} weak (${value})`,
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
        where: { category: BRAIN_CATEGORIES.NUDGE_PIN_HYGIENE, key: "weekly_pin_review" },
        select: { content: true, metadata: true, updatedAt: true },
      })
      .catch(() => null),
    prisma.brainMemory
      .findFirst({
        where: { category: BRAIN_CATEGORIES.BELIEF_REFRESH_REPORT },
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
        category: BRAIN_CATEGORIES.CORRELATION_ALERT,
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { key: true, content: true, metadata: true },
    }).catch((): never[] => []),
    prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.DECISION_DRIFT, key: "weekly" } },
      select: { content: true, metadata: true, deletedAt: true },
    }).catch((): null => null),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.PREDICTION_STREAK, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { key: true, content: true, metadata: true },
    }).catch((): never[] => []),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.HQ_PIN_CANDIDATE, deletedAt: null },
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
    where: { category: BRAIN_CATEGORIES.NUDGE_ACK },
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
  const filtered = nudges.filter((n) => !ackedKeys.has(nudgeKey(n.source, n.text)));

  filtered.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    return rank[b.severity] - rank[a.severity];
  });

  return filtered;
}

/**
 * Cached entry point — the one every caller uses (chat context block ·
 * GET /api/brain/nudges · trpc brain.nudges · ultron-ticker · narrator).
 *
 * 2026-08-06 · this ran on essentially every chat turn (nudges block
 * fired 1386/1417 turns over 30d) and cost ~12 Postgres round-trips
 * per call, on a route whose measured p50 time-to-first-token was
 * 10,453ms. Nothing it reads can actually move inside 300s: the
 * pin-hygiene row is gated on a 7d freshness window, belief-refresh on
 * 18h, correlation alerts on 7d, and skill/streak/blind-spot rows are
 * written by crons. The ONE input that moves on operator time is a
 * dismissal — `dismissNudge` invalidates this key explicitly, so the
 * NudgePanel doesn't show a dismissed nudge coming back.
 */
export async function computeNudges(): Promise<Nudge[]> {
  return cached(NUDGE_CACHE_KEY, 300, computeNudgesUncached);
}

/**
 * Drop the cached nudge set. Exported (rather than each writer calling
 * `invalidate("brain_nudges_v1")`) because a second copy of the key
 * string is exactly how a rename silently un-invalidates one writer and
 * leaves the other looking fine.
 *
 * WHO CALLS THIS, and why only these — audited 2026-08-06 against every
 * writer of every row `computeNudgesUncached` reads:
 *
 *   1. `dismissNudge` (below) — writes the `nudge_ack` row that the
 *      suppression filter reads. Operator taps dismiss in NudgePanel.
 *   2. `resolveContradiction` (lib/brain/contradiction-surfacer.ts) —
 *      flips a contradiction row off `"unresolved"`, which is precisely
 *      what `countUnresolved(14)` counts, and that count IS the
 *      contradiction nudge. Operator taps resolve in
 *      ContradictionResolutionPanel / ContradictionsCard, or Nick calls
 *      the `resolveContradiction` AI tool mid-turn. All five entry
 *      points (trpc brain.* + system.*, both REST routes, the AI tool)
 *      funnel through that one function, so one call covers them all.
 *   3. `setManualOverride` (lib/brain/identity-snapshot.ts) — writes the
 *      identity row whose axes this module compares against
 *      WEAKNESS_FLOOR. Added 2026-08-06 after review; see the
 *      identity-axes note below for why the original exclusion was wrong.
 *
 * DELIBERATELY NOT invalidated. Each input below moves on cron time
 * behind a freshness window that already dwarfs 300s, so wiring it up
 * would delete the cache on a schedule for zero user-visible gain —
 * which is just the un-cached version with extra steps:
 *   - pin_hygiene       · gated `age < 7d`   (weekly pin-review cron)
 *   - belief_refresh    · gated `age < 18h`  (nightly auto-calibrate)
 *   - correlation_alert · gated `updatedAt >= now-7d` (detector cron)
 *   - decision_drift    · a single `"weekly"` row (weekly cron)
 *   - prediction_streak · hq_pin_candidate · ghost accuracy — cron rows
 *   - identity axes     · the DAILY-SCHEDULER recompute only. A MANUAL
 *     pin is NOT exempt and is now wired (see 3 above). The original
 *     version of this list claimed the nudge "fires on a WEAKNESS_FLOOR
 *     crossing, not on the raw number" and used that to exclude identity
 *     writes wholesale — wrong, because a manual pin from 40 to 70 IS a
 *     floor crossing, and clearing that nudge is usually the operator's
 *     whole reason for pinning.
 *   - NEW contradiction rows from `surfaceContradictions`
 *     (lib/brain/contradiction-surfacer.ts, fire-and-forget from
 *     importance-scorer on a chat turn) · these RAISE
 *     `countUnresolved(14)`, so this one genuinely does move on
 *     turn time, not cron time. Excluded on a cost/benefit call, not
 *     because it cannot move: a nudge appearing up to 300s late is
 *     cheap, whereas a DISMISSED nudge coming BACK reads as the app
 *     ignoring the operator. Wire it only if late-arriving
 *     contradiction nudges ever become a real complaint.
 *   - skill / skill_pending · the nudge needs >= 5 pending candidates
 *     or a 30d-stale skill; a single triage in /settings cannot flip
 *     either condition, so at worst a count reads one stale for 300s
 */
export function invalidateNudgeCache(): void {
  invalidate(NUDGE_CACHE_KEY);
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

/** ACK-window choice for a nudge dismissal. */
export type NudgeDismissUntil = "today" | "7d" | "forever";

/**
 * Dismiss (ACK) a nudge for a window. Writes a BrainMemory(nudge_ack)
 * row keyed by {source, text}; `computeNudges` filters out any nudge
 * whose ack row hasn't expired. Lifted verbatim from
 * POST /api/brain/nudges/dismiss · the route AND the tRPC
 * `brain.dismissNudge` procedure both call this · drift impossible.
 */
export async function dismissNudge(args: {
  source: string;
  text: string;
  until?: NudgeDismissUntil;
}): Promise<{ ok: true; key: string; expiresAt: string | null }> {
  const key = nudgeKey(args.source, args.text);
  const until = args.until ?? "7d";

  let expiresAt: Date | null;
  if (until === "today") {
    const d = new Date();
    d.setHours(24, 0, 0, 0); // midnight tonight (rough 00:00 local)
    expiresAt = d;
  } else if (until === "forever") {
    expiresAt = null;
  } else {
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  await brainMemory.remember(
    "nudge_ack",
    key,
    `ACK: ${args.source} · ${args.text.slice(0, 120)}`,
    "nudge-dismiss",
    {
      source: args.source,
      text: args.text,
      until,
      ackAt: new Date().toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    },
  );

  // 2026-08-06 · LOAD-BEARING. The ack row only takes effect through
  // the suppression filter inside `computeNudgesUncached`, and that is
  // now behind a 300s cache. Without this line the operator taps
  // dismiss in the NudgePanel and watches the nudge come straight back
  // on the next poll for up to five minutes. Both dismiss paths (the
  // REST route and trpc brain.dismissNudge) land here, so one call
  // covers both.
  invalidateNudgeCache();

  return { ok: true, key, expiresAt: expiresAt?.toISOString() ?? null };
}
