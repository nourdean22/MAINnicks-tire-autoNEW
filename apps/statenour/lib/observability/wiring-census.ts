/**
 * Wiring census — BDN-101 (2026-08-12, operator green-lit; the run's #1
 * finding and its contrarian trade: wiring integrity over new chrome).
 *
 * Every major defect of 2026-08-12 was a SEVERED LANE between a live
 * producer and a live consumer — and dead lanes emit no errors, only
 * silence, which reads as health on every existing surface. This census
 * makes lane liveness a first-class reading: for each declared lane,
 * when did flow last actually happen, and does the consumer exist?
 *
 * Kill-shot constraint from the scan (honored): lanes derive from CODE
 * REGISTRIES, never a hand-list —
 *   · autonomous rules  → listRuleNames() (the engine's own RULES array)
 *   · brain-bus topics  → listRegisteredTopics() (the dispatch registry)
 * plus reverse-orphan detection from the DB (producers still writing
 * rows whose registry entry is gone).
 *
 * Honest-scope disclosure (rendered, not hidden): lane classes this v1
 * deliberately does NOT cover, with where their coverage lives instead —
 *   · cron → artifact lanes (covered: cron deck + silence detector)
 *   · URL-param → handler lanes (covered: pinned by tests, e.g.
 *     use-chat-deep-link-prefill.test.ts — the ?q= class)
 *   · client event/store lanes (not server-censusable)
 *   · page-context bridge → chat (measure via context_manifest logs)
 *
 * Fleet-truth idiom: a thrown probe becomes status "unknown", and
 * unknown NEVER counts as healthy.
 */

import { prisma } from "@/lib/prisma";
import { listRuleNames } from "@/lib/brain/autonomous-engine";
import { listRegisteredTopics } from "@/lib/db/brain-bus-handlers";

export type LaneStatus =
  | "flowing" // observed flow recently
  | "quiet" // consumer wired; no recent traffic (idle ≠ broken, said honestly)
  | "silent" // consumer wired; traffic stopped long ago — investigate
  | "backlog" // producer flowing, consumer NOT keeping up
  | "severed" // producer live, consumer/policy MISSING — the deadlock class
  | "never" // consumer declared, no flow ever observed
  | "unknown"; // probe failed — not healthy, not anything

export interface LaneRow {
  laneClass: "autonomous-rule" | "brain-bus-topic" | "orphan";
  id: string;
  registry: string;
  lastObservedFlow: string | null;
  status: LaneStatus;
  detail: string;
}

export interface WiringCensusView {
  lanes: LaneRow[];
  /** Lane classes this census does NOT cover, and where coverage lives. */
  notCovered: Array<{ laneClass: string; coveredBy: string }>;
  computedAt: string;
}

const DAY_MS = 86_400_000;

/** PURE — classify one autonomous rule's lane. Exported for the test. */
export function classifyRuleLane(input: {
  name: string;
  hasPolicy: boolean;
  approvalClass: string | null;
  lastRowAt: Date | null;
  rowCount: number;
  now: number;
}): Pick<LaneRow, "status" | "detail"> {
  if (!input.hasPolicy) {
    return {
      status: "severed",
      detail:
        "no AutomationPolicy row — the fail-closed engine parks every match as pending forever (the 2026-08-12 deadlock class)",
    };
  }
  if (input.approvalClass === "forbidden") {
    return { status: "quiet", detail: "administratively forbidden by policy — off by decision, not by accident" };
  }
  if (input.rowCount === 0) {
    return {
      status: "never",
      detail: "rule registered + policy present, but no action row has EVER been minted — trigger may never match, or the lane is dead",
    };
  }
  const ageDays = input.lastRowAt ? (input.now - input.lastRowAt.getTime()) / DAY_MS : Infinity;
  if (ageDays <= 7) return { status: "flowing", detail: `last action ${ageDays.toFixed(1)}d ago` };
  if (ageDays <= 30) {
    return {
      status: "quiet",
      detail: `no matches in ${Math.round(ageDays)}d — idle and broken look identical from here; check the trigger's source data before assuming either`,
    };
  }
  return {
    status: "silent",
    detail: `no action row in ${Math.round(ageDays)}d despite a live policy — investigate the trigger`,
  };
}

/** PURE — mirror resolveHandler's matching (exact · "prefix.*" · "*"). */
export function topicMatchesPattern(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern === topic) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return topic === prefix || topic.startsWith(`${prefix}.`);
  }
  return false;
}

/** PURE — classify one registered bus-topic pattern. Exported for the test. */
export function classifyBusLane(input: {
  pattern: string;
  everCount: number;
  pendingCount: number;
  oldestPendingAt: Date | null;
  lastDoneAt: Date | null;
  now: number;
}): Pick<LaneRow, "status" | "detail"> {
  if (input.everCount === 0) {
    return {
      status: "never",
      detail: "handler registered, zero matching events ever published — consumer waiting on a producer that may not exist",
    };
  }
  if (input.pendingCount > 0) {
    const oldestMin = input.oldestPendingAt
      ? Math.round((input.now - input.oldestPendingAt.getTime()) / 60_000)
      : null;
    // The drain runs every 15 minutes; an hour-old pending row means
    // more than three consecutive cycles failed to clear it.
    if (oldestMin !== null && oldestMin > 60) {
      return {
        status: "backlog",
        detail: `${input.pendingCount} pending, oldest ${oldestMin}m — the 15-min drain is not keeping up (the 393-backlog class)`,
      };
    }
    return { status: "flowing", detail: `${input.pendingCount} pending inside normal drain latency` };
  }
  const ageDays = input.lastDoneAt ? (input.now - input.lastDoneAt.getTime()) / DAY_MS : Infinity;
  if (ageDays <= 2) return { status: "flowing", detail: `last processed ${ageDays.toFixed(1)}d ago · 0 pending` };
  return {
    status: "quiet",
    detail: `0 pending, last processed ${Math.round(ageDays)}d ago — producers idle`,
  };
}

export async function buildWiringCensus(): Promise<WiringCensusView> {
  const now = Date.now();
  const lanes: LaneRow[] = [];

  // ── Lane class 1 · autonomous rules → policy → execution ──
  try {
    const rules = listRuleNames();
    const [policies, rowStats] = await Promise.all([
      prisma.automationPolicy.findMany({
        where: { surface: "autonomous-action", deletedAt: null },
        select: { name: true, approvalClass: true },
      }),
      prisma.autonomousAction.groupBy({
        by: ["ruleName"],
        _count: { id: true },
        _max: { createdAt: true },
      }),
    ]);
    const policyByName = new Map(policies.map((p) => [p.name, p.approvalClass]));
    const statsByRule = new Map(rowStats.map((r) => [r.ruleName, r]));

    for (const rule of rules) {
      const stats = statsByRule.get(rule.name);
      const cls = classifyRuleLane({
        name: rule.name,
        hasPolicy: policyByName.has(rule.name),
        approvalClass: policyByName.get(rule.name) ?? null,
        lastRowAt: stats?._max.createdAt ?? null,
        rowCount: stats?._count.id ?? 0,
        now,
      });
      lanes.push({
        laneClass: "autonomous-rule",
        id: rule.name,
        registry: "lib/brain/autonomous-engine.ts RULES",
        lastObservedFlow: stats?._max.createdAt?.toISOString() ?? null,
        ...cls,
      });
    }

    // Reverse orphans: DB producers whose registry entry is gone.
    const ruleNames = new Set(rules.map((r) => r.name));
    for (const stat of rowStats) {
      if (!ruleNames.has(stat.ruleName)) {
        lanes.push({
          laneClass: "orphan",
          id: stat.ruleName,
          registry: "(absent from RULES — retired producer)",
          lastObservedFlow: stat._max.createdAt?.toISOString() ?? null,
          status: "quiet",
          detail: `${stat._count.id} rows from a name absent from the RULES registry — either a retired rule, or a DIFFERENT producer writing autonomousAction rows (verified 2026-08-12: the nick_action_* names come from the nick-action crons, not from a retirement)`,
        });
      }
    }
  } catch (err) {
    lanes.push({
      laneClass: "autonomous-rule",
      id: "(probe failed)",
      registry: "lib/brain/autonomous-engine.ts RULES",
      lastObservedFlow: null,
      status: "unknown",
      detail: `rule-lane probe failed: ${err instanceof Error ? err.message : String(err)} — unknown, not healthy`,
    });
  }

  // ── Lane class 2 · brain-bus topics → handler registry ──
  try {
    const patterns = listRegisteredTopics();
    const [pendingStats, doneStats] = await Promise.all([
      prisma.brainBusEvent.groupBy({
        by: ["topic"],
        where: { status: "pending" },
        _count: { id: true },
        _min: { availableAt: true },
      }),
      prisma.brainBusEvent.groupBy({
        by: ["topic"],
        _count: { id: true },
        _max: { processedAt: true },
      }),
    ]);

    for (const pattern of patterns) {
      let everCount = 0;
      let pendingCount = 0;
      let oldestPendingAt: Date | null = null;
      let lastDoneAt: Date | null = null;
      for (const d of doneStats) {
        if (!topicMatchesPattern(pattern, d.topic)) continue;
        everCount += d._count.id;
        if (d._max.processedAt && (!lastDoneAt || d._max.processedAt > lastDoneAt)) {
          lastDoneAt = d._max.processedAt;
        }
      }
      for (const p of pendingStats) {
        if (!topicMatchesPattern(pattern, p.topic)) continue;
        pendingCount += p._count.id;
        if (p._min.availableAt && (!oldestPendingAt || p._min.availableAt < oldestPendingAt)) {
          oldestPendingAt = p._min.availableAt;
        }
      }
      const cls = classifyBusLane({ pattern, everCount, pendingCount, oldestPendingAt, lastDoneAt, now });
      lanes.push({
        laneClass: "brain-bus-topic",
        id: pattern,
        registry: "lib/db/brain-bus-handlers.ts HANDLERS",
        lastObservedFlow: lastDoneAt?.toISOString() ?? null,
        ...cls,
      });
    }

    // Reverse orphans: published topics no specific pattern matches
    // (wildcard-only consumption is weak consumption — say so).
    const specific = patterns.filter((p) => p !== "*");
    for (const d of doneStats) {
      if (!specific.some((p) => topicMatchesPattern(p, d.topic))) {
        lanes.push({
          laneClass: "orphan",
          id: d.topic,
          registry: "(no specific handler — wildcard fallback only)",
          lastObservedFlow: d._max.processedAt?.toISOString() ?? null,
          status: "quiet",
          detail: `${d._count.id} events consumed only by the wildcard handler — a producer without a real consumer`,
        });
      }
    }
  } catch (err) {
    lanes.push({
      laneClass: "brain-bus-topic",
      id: "(probe failed)",
      registry: "lib/db/brain-bus-handlers.ts HANDLERS",
      lastObservedFlow: null,
      status: "unknown",
      detail: `bus-lane probe failed: ${err instanceof Error ? err.message : String(err)} — unknown, not healthy`,
    });
  }

  const SEVERITY: Record<LaneStatus, number> = {
    severed: 0,
    backlog: 1,
    unknown: 2,
    never: 3,
    silent: 4,
    quiet: 5,
    flowing: 6,
  };
  lanes.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.id.localeCompare(b.id));

  return {
    lanes,
    notCovered: [
      { laneClass: "cron → artifact", coveredBy: "/system/crons deck + the cron silence detector" },
      { laneClass: "URL param → handler", coveredBy: "pinned by tests (e.g. use-chat-deep-link-prefill.test.ts)" },
      { laneClass: "client event/store lanes", coveredBy: "not server-censusable — component tests" },
      { laneClass: "page-context bridge → chat", coveredBy: "context_manifest log lines (contextRoute arrival rate)" },
    ],
    computedAt: new Date().toISOString(),
  };
}
