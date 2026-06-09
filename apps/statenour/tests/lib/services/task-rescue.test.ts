import { describe, it, expect } from "vitest";
import {
  classifyRescue,
  scanRescue,
  buildTaskRescue,
  summarizeAnchorRows,
  buildDomainAnchors,
  type RescueTaskInput,
  type AnchorRow,
} from "@/lib/services/task-rescue";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function task(over: Partial<RescueTaskInput>): RescueTaskInput {
  return {
    id: "t", title: "A task", status: "READY", loopKind: "ONCE",
    missionTitle: "Real Project", missionSystemKind: null,
    hasNextPhysicalAction: true, hasPendingClassification: false,
    lastActivityAt: daysAgo(1),
    ...over,
  };
}

describe("classifyRescue", () => {
  it("flags a legacy Inbox task", () => {
    const f = classifyRescue(task({ missionTitle: "Inbox" }), NOW);
    expect(f?.issue).toBe("legacy_inbox");
  });

  it("flags a domain Inbox variant", () => {
    expect(classifyRescue(task({ missionTitle: "Inbox - business" }), NOW)?.issue).toBe("legacy_inbox");
  });

  it("flags a stale (untouched 30+ days) open task", () => {
    const f = classifyRescue(task({ lastActivityAt: daysAgo(45) }), NOW);
    expect(f?.issue).toBe("stale");
    expect(f?.reason).toContain("45");
  });

  it("flags an actionable task with no next physical action", () => {
    expect(classifyRescue(task({ hasNextPhysicalAction: false }), NOW)?.issue).toBe("no_next_action");
  });

  it("flags a parked pending-classification task (highest priority)", () => {
    const f = classifyRescue(task({ hasPendingClassification: true, hasNextPhysicalAction: false }), NOW);
    expect(f?.issue).toBe("pending_classification"); // beats no_next_action
  });

  it("suggests a specific project for a task actively worked in a GENERAL anchor (low confidence)", () => {
    const f = classifyRescue(task({ status: "DOING", missionTitle: "GENERAL BUSINESS", missionSystemKind: "GENERAL" }), NOW);
    expect(f?.issue).toBe("general_maybe_specific");
    expect(f?.confidence).toBeLessThan(0.5);
  });

  it("PROTECTS GENERAL anchors — a healthy GENERAL-anchored READY task is not flagged misfiled", () => {
    const f = classifyRescue(task({ status: "READY", missionTitle: "GENERAL HEALTH", missionSystemKind: "GENERAL" }), NOW);
    expect(f).toBeNull(); // not legacy_inbox, not misfiled
  });

  it("never flags a GENERAL-anchored task as legacy_inbox", () => {
    const f = classifyRescue(task({ status: "DOING", missionTitle: "GENERAL BUSINESS", missionSystemKind: "GENERAL", hasNextPhysicalAction: false }), NOW);
    expect(f?.issue).not.toBe("legacy_inbox");
  });

  it("ignores terminal + daily tasks", () => {
    expect(classifyRescue(task({ status: "DONE" }), NOW)).toBeNull();
    expect(classifyRescue(task({ status: "ARCHIVED" }), NOW)).toBeNull();
    expect(classifyRescue(task({ loopKind: "DAILY", lastActivityAt: daysAgo(99) }), NOW)).toBeNull();
  });

  it("returns null for a healthy task", () => {
    expect(classifyRescue(task({}), NOW)).toBeNull();
  });
});

describe("scanRescue", () => {
  it("aggregates one finding per task, sorted by priority, with counts", () => {
    const r = scanRescue(
      [
        task({ id: "1", missionTitle: "Inbox" }), // legacy_inbox
        task({ id: "2", lastActivityAt: daysAgo(60) }), // stale
        task({ id: "3", hasPendingClassification: true }), // pending (top)
        task({ id: "4" }), // healthy → no finding
      ],
      NOW,
    );
    expect(r.scanned).toBe(4);
    expect(r.findings).toHaveLength(3);
    expect(r.findings[0].issue).toBe("pending_classification"); // highest priority first
    expect(r.byIssue.legacy_inbox).toBe(1);
  });
});

describe("buildTaskRescue (injected loader — no DB)", () => {
  it("is read-only and returns findings", async () => {
    const r = await buildTaskRescue({
      loadTasks: async () => [task({ id: "x", missionTitle: "Inbox" })],
      now: NOW,
    });
    expect(r.findings[0].issue).toBe("legacy_inbox");
  });
});

describe("GENERAL-anchor visibility (Wire 2)", () => {
  const row = (over: Partial<AnchorRow>): AnchorRow => ({
    id: "m", title: "GENERAL BUSINESS", canonicalDomain: "business", domain: "BUSINESS",
    tasks: [],
    ...over,
  });

  it("summarizes open-counts busiest-first with a domain fallback", () => {
    const out = summarizeAnchorRows([
      row({ id: "a", title: "GENERAL HEALTH", canonicalDomain: "health", tasks: [{ id: "1" }, { id: "2" }] }),
      row({ id: "b", title: "GENERAL BUSINESS", canonicalDomain: null, domain: "BUSINESS", tasks: [{ id: "3" }, { id: "4" }, { id: "5" }] }),
      row({ id: "c", title: "GENERAL SOCIAL", canonicalDomain: null, domain: null, tasks: [] }),
    ]);
    expect(out.map((a) => a.missionId)).toEqual(["b", "a", "c"]); // 3 > 2 > 0 open
    expect(out[0].openCount).toBe(3);
    expect(out[1].domain).toBe("health");
    expect(out[0].domain).toBe("BUSINESS"); // falls back to legacy domain when canonical null
    expect(out[2].domain).toBeNull();
  });

  it("buildDomainAnchors returns summaries via an injected loader (no DB)", async () => {
    const out = await buildDomainAnchors({
      loadAnchorRows: async () => [row({ id: "z", tasks: [{ id: "1" }] })],
    });
    expect(out[0].missionId).toBe("z");
    expect(out[0].openCount).toBe(1);
  });
});
