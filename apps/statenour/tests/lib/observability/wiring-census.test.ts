/**
 * BDN-101 · the census must catch the defect class that motivated it.
 *
 * The scan's cheap test was "backtest it — would this have caught the
 * week's five finds?" These pin the two server-censusable classes with
 * the REAL shapes measured on 2026-08-12:
 *   · memory_promotion / decision_replay_due: rule live, policy row
 *     MISSING → the deferred-action deadlock → must read `severed`.
 *   · brain-bus: 393 pending events with the drain dead for two months
 *     → must read `backlog`, not "flowing" and not silence.
 * Plus the honest-state rules: a failed probe is `unknown` (never
 * healthy), idle is `quiet` (not "broken"), and a registered consumer
 * that has never seen an event is `never`.
 */
import { describe, it, expect } from "vitest";
import {
  classifyRuleLane,
  classifyBusLane,
  topicMatchesPattern,
} from "@/lib/observability/wiring-census";

const NOW = Date.parse("2026-08-12T18:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);

describe("classifyRuleLane · autonomous rule → policy → execution", () => {
  it("SEVERED: rule live, rows minting nightly, but NO policy row (the 2026-08-12 deadlock)", () => {
    const out = classifyRuleLane({
      name: "memory_promotion",
      hasPolicy: false,
      approvalClass: null,
      lastRowAt: daysAgo(0.2),
      rowCount: 431,
      now: NOW,
    });
    expect(out.status).toBe("severed");
    expect(out.detail).toMatch(/AutomationPolicy/);
  });

  it("does NOT call a policy-backed, recently-firing rule severed", () => {
    const out = classifyRuleLane({
      name: "memory_promotion",
      hasPolicy: true,
      approvalClass: "auto",
      lastRowAt: daysAgo(0.5),
      rowCount: 431,
      now: NOW,
    });
    expect(out.status).toBe("flowing");
  });

  it("NEVER: registered + policy present, but no row has ever existed", () => {
    const out = classifyRuleLane({
      name: "some_rule",
      hasPolicy: true,
      approvalClass: "auto",
      lastRowAt: null,
      rowCount: 0,
      now: NOW,
    });
    expect(out.status).toBe("never");
  });

  it("QUIET (not broken) at 2 weeks idle, SILENT past a month", () => {
    const base = { name: "r", hasPolicy: true, approvalClass: "auto", rowCount: 5, now: NOW };
    expect(classifyRuleLane({ ...base, lastRowAt: daysAgo(14) }).status).toBe("quiet");
    expect(classifyRuleLane({ ...base, lastRowAt: daysAgo(45) }).status).toBe("silent");
  });

  it("forbidden-by-policy reads as an intentional off state, not a fault", () => {
    const out = classifyRuleLane({
      name: "r",
      hasPolicy: true,
      approvalClass: "forbidden",
      lastRowAt: daysAgo(90),
      rowCount: 1,
      now: NOW,
    });
    expect(out.status).toBe("quiet");
    expect(out.detail).toMatch(/forbidden/);
  });
});

describe("classifyBusLane · brain-bus topic → handler", () => {
  it("BACKLOG: the 393-pending / dead-drain shape", () => {
    const out = classifyBusLane({
      pattern: "task.*",
      everCount: 400,
      pendingCount: 393,
      oldestPendingAt: daysAgo(60),
      lastDoneAt: daysAgo(60),
      now: NOW,
    });
    expect(out.status).toBe("backlog");
  });

  it("today's real shape (0 pending, drained hours ago) is flowing", () => {
    const out = classifyBusLane({
      pattern: "task.*",
      everCount: 1558,
      pendingCount: 0,
      oldestPendingAt: null,
      lastDoneAt: daysAgo(0.1),
      now: NOW,
    });
    expect(out.status).toBe("flowing");
  });

  it("pending inside normal drain latency is NOT a backlog alarm", () => {
    const out = classifyBusLane({
      pattern: "task.*",
      everCount: 100,
      pendingCount: 3,
      oldestPendingAt: new Date(NOW - 5 * 60_000),
      lastDoneAt: daysAgo(0.05),
      now: NOW,
    });
    expect(out.status).toBe("flowing");
  });

  it("NEVER: handler registered, zero matching events ever", () => {
    const out = classifyBusLane({
      pattern: "ghost.*",
      everCount: 0,
      pendingCount: 0,
      oldestPendingAt: null,
      lastDoneAt: null,
      now: NOW,
    });
    expect(out.status).toBe("never");
  });
});

describe("topicMatchesPattern · mirrors resolveHandler", () => {
  it("matches exact, prefix-wildcard, and global wildcard the same way dispatch does", () => {
    expect(topicMatchesPattern("task.completed", "task.completed")).toBe(true);
    expect(topicMatchesPattern("task.*", "task.completed")).toBe(true);
    expect(topicMatchesPattern("task.*", "task")).toBe(true);
    expect(topicMatchesPattern("task.*", "taskish.completed")).toBe(false);
    expect(topicMatchesPattern("*", "anything.at.all")).toBe(true);
    expect(topicMatchesPattern("goal.*", "task.completed")).toBe(false);
  });
});
