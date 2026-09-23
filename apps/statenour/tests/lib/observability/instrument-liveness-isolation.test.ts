/**
 * 2026-09-22 · review on #2482 (P1): buildInstrumentHealth used one Promise.all over
 * every liveness read, so a single rejecting source - here tool_selection_turns absent
 * during schema drift - rejected the WHOLE view, and the panel rendered missing data
 * as no warning. Each read now degrades on its own into an UNKNOWN row.
 */
import { describe, it, expect, vi } from "vitest";

const db = vi.hoisted(() => ({
  systemMetric: {
    findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-09-22T10:00:00Z") }),
    count: vi.fn().mockResolvedValue(120),
  },
  toolSelectionTurn: {
    findFirst: vi.fn().mockRejectedValue(new Error("relation \"tool_selection_turns\" does not exist")),
    count: vi.fn().mockResolvedValue(0),
  },
  toolTelemetry: {
    findFirst: vi.fn().mockResolvedValue({ lastCallAt: new Date("2026-09-22T09:00:00Z") }),
    count: vi.fn().mockResolvedValue(8),
  },
  chatMessage: { count: vi.fn().mockResolvedValue(253) },
  errorLog: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { buildInstrumentHealth } from "@/lib/observability/instrument-liveness";

describe("buildInstrumentHealth · one rejected source degrades to one UNKNOWN row (review on #2482)", () => {
  it("resolves, names the failed read on its row, and still reads the healthy sources", async () => {
    const view = await buildInstrumentHealth(24);
    const broken = view.rows.find((r) => r.instrument === "tool_selection_turn")!;
    expect(broken.status).toBe("UNKNOWN");
    expect(broken.reason).toContain("does not exist");
    const surfaced = view.rows.find((r) => r.instrument === "tool.surfaced")!;
    expect(surfaced.status).toBe("HEALTHY");
    expect(view.assistantTurns).toBe(253);
    expect(view.sourceErrors).toEqual([]);
  });
});
