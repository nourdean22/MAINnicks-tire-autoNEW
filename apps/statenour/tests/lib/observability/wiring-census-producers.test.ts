/**
 * The census tells a live producer, a retired rule and a real stray apart.
 *
 * THE DEFECT (audit 2026-10-10, report 13). Every autonomousAction ruleName
 * outside RULES was filed as "orphan / retired producer". Two of those are
 * live producers with their own writers (nick_action_* from
 * lib/ai/propose-actions.ts, nick_event_* from
 * lib/inngest/functions/event-triggers.ts); others are rules deleted on
 * purpose. A genuinely new stray read the same as both, so it could never
 * stand out.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  ruleStats: [] as Array<{ ruleName: string; _count: { id: number }; _max: { createdAt: Date | null } }>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationPolicy: { findMany: vi.fn(async () => []) },
    autonomousAction: { groupBy: vi.fn(async () => h.ruleStats) },
    brainBusEvent: { groupBy: vi.fn(async () => []) },
  },
}));

import { buildWiringCensus, classifyOrphan, KNOWN_PRODUCERS } from "@/lib/observability/wiring-census";
import { RETIRED_RULE_NAMES, listRuleNames } from "@/lib/brain/autonomous-engine";

const NOW = Date.parse("2026-10-10T18:00:00.000Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000);

describe("classifyOrphan", () => {
  it("files nick_action_* as a live producer, with its writer named", () => {
    const out = classifyOrphan({ name: "nick_action_nudge_task", lastRowAt: ago(1), rowCount: 12, now: NOW });
    expect(out.laneClass).toBe("producer");
    expect(out.status).toBe("flowing");
    expect(out.registry).toMatch(/propose-actions\.ts/);
  });

  it("files nick_event_drift as a live producer", () => {
    const out = classifyOrphan({ name: "nick_event_drift", lastRowAt: ago(2), rowCount: 4, now: NOW });
    expect(out.laneClass).toBe("producer");
    expect(out.registry).toMatch(/event-triggers\.ts/);
  });

  it("files the deleted rules as retired history, not attention", () => {
    for (const name of ["dania_neglect_nudge", "loop_overload_alert", "morning_brief_push"]) {
      const out = classifyOrphan({ name, lastRowAt: ago(120), rowCount: 3, now: NOW });
      expect(out.laneClass, name).toBe("retired");
      expect(out.status, name).toBe("quiet");
    }
  });

  it("a name in no registry is an unknown stray, so it stands out", () => {
    const out = classifyOrphan({ name: "brand_new_x", lastRowAt: ago(0.5), rowCount: 2, now: NOW });
    expect(out.laneClass).toBe("orphan");
    expect(out.status).toBe("unknown");
  });
});

describe("the registries the census trusts are real", () => {
  it("each known producer prefix has a writer in the file it names", () => {
    for (const p of KNOWN_PRODUCERS) {
      const src = readFileSync(p.source, "utf8");
      expect(src, `${p.prefix} in ${p.source}`).toMatch(new RegExp(`ruleName:\\s*[\`"]${p.prefix}`));
    }
  });

  it("no retired name is still a live rule", () => {
    const live = new Set(listRuleNames().map((r) => r.name));
    expect(RETIRED_RULE_NAMES.filter((n) => live.has(n))).toEqual([]);
  });
});

describe("buildWiringCensus wires the classification", () => {
  it("renders producer, retired and stray rows with their own classes", async () => {
    h.ruleStats = [
      { ruleName: "nick_action_nudge_task", _count: { id: 12 }, _max: { createdAt: new Date() } },
      { ruleName: "dania_neglect_nudge", _count: { id: 3 }, _max: { createdAt: ago(120) } },
      { ruleName: "brand_new_x", _count: { id: 2 }, _max: { createdAt: new Date() } },
    ];
    const view = await buildWiringCensus();
    const byId = new Map(view.lanes.map((l) => [l.id, l]));
    expect(byId.get("nick_action_nudge_task")?.laneClass).toBe("producer");
    expect(byId.get("dania_neglect_nudge")?.laneClass).toBe("retired");
    expect(byId.get("brand_new_x")).toMatchObject({ laneClass: "orphan", status: "unknown" });
  });
});
