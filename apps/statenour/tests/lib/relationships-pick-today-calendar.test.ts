/**
 * People W4 S1 (2026-10-30): someone he is about to see is not "gone quiet".
 *
 * Real pickRelationshipsForToday, model failing (heuristic fallback). Person S
 * is silent longer and is a friend, so S ranks first on silence alone. With an
 * event tomorrow that names S, S's silence stops counting, Q ranks first, and
 * S's pick says "seeing them tomorrow". A failed calendar read changes nothing
 * and is reported as unknown (skill empty-vs-error); that is the control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  memFindFirst: vi.fn(),
  memFindMany: vi.fn(),
  memCreate: vi.fn(),
  peopleFindMany: vi.fn(),
  ledgerFindMany: vi.fn(),
  aiChat: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findFirst: h.memFindFirst, findMany: h.memFindMany, create: h.memCreate, update: vi.fn() },
    personProfile: { findMany: h.peopleFindMany },
    relationshipLedger: { findMany: h.ledgerFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: h.aiChat }));
vi.mock("@/lib/services/calendar-api", () => ({ listEvents: h.listEvents }));

import { pickRelationshipsForToday } from "@/lib/ai/relationships-pick-today";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T16:00:00Z"));
  h.memFindFirst.mockResolvedValue(null);
  h.memFindMany.mockResolvedValue([]);
  h.memCreate.mockResolvedValue({});
  h.aiChat.mockRejectedValue(new Error("model down"));
  h.ledgerFindMany.mockResolvedValue([]);
  h.peopleFindMany.mockResolvedValue([
    { id: "s", name: "Sam Rivers", role: "friend", lastInteraction: new Date("2026-07-02T12:00:00Z"), birthday: null },
    { id: "q", name: "Quinn Lake", role: "acquaintance", lastInteraction: new Date("2026-07-22T12:00:00Z"), birthday: null },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("pickRelationshipsForToday calendar signal", () => {
  it("a person named in tomorrow's event is not ranked as quiet, and the pick says when", async () => {
    h.listEvents.mockResolvedValue([{ id: "e1", summary: "Lunch with Sam Rivers", start: "2026-10-31T16:00:00Z" }]);
    const out = await pickRelationshipsForToday();
    expect(out.picks.map((p) => p.personId)).toEqual(["q", "s"]);
    const s = out.picks.find((p) => p.personId === "s");
    expect(s?.seeingOn).toBe("tomorrow");
    // Codex P1 on 3432: the silence SIGNAL goes too, not only its score, or the
    // rationale reads "seeing them tomorrow · 90d+ silent".
    expect(s?.rationale).toContain("seeing them tomorrow");
    expect(s?.rationale).not.toMatch(/silent|no recent touchpoints/);
    // People W4 S2: the facts Nick's tool returns ride on the pick (S silent since 2026-07-02).
    expect(s?.daysQuiet).toBe(120);
    expect(s?.openPromises).toBe(0);
    expect(out.calendar).toBe("ok");
    expect(h.listEvents).toHaveBeenCalledWith(expect.objectContaining({ daysAhead: 3 }));
  });

  it("CONTROL: a failed calendar read leaves the order alone and says the calendar is unknown", async () => {
    h.listEvents.mockRejectedValue(new Error("calendar_not_connected"));
    const out = await pickRelationshipsForToday();
    expect(out.picks.map((p) => p.personId)).toEqual(["s", "q"]);
    expect(out.picks.every((p) => p.seeingOn === undefined)).toBe(true);
    expect(out.calendar).toBe("unknown");
  });
});
