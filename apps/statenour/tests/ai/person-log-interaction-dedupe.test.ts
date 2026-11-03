/**
 * tests/ai/person-log-interaction-dedupe.test.ts · 2026-11-03
 *
 * Two chat writers now reach the relationship ledger: the in-turn
 * logPersonInteraction tool and the person.logInteraction action block, which
 * runs AFTER the reply. One reported contact must be one row: the block skips
 * when the tool already wrote this person minutes ago.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ resolve: vi.fn(), record: vi.fn(), ledgerFindFirst: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { relationshipLedger: { findMany: m.ledgerFindFirst } } }));
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: m.resolve }));
vi.mock("@/lib/services/people/record-interaction", () => ({ recordInteraction: m.record }));
vi.mock("@/lib/utils/error-log", () => ({ logError: m.logError }));

import { handlePersonLogInteraction } from "@/lib/ai/agent-actions/person-actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.resolve.mockResolvedValue({ person: { id: "p-mash", name: "Mash" }, matched: true, matchTier: "exact" });
  m.record.mockResolvedValue({
    ledgerId: "L2", personId: "p-mash", personName: "Mash", amount: 5, note: "covered the counter",
    source: "chat", at: new Date(), lastInteraction: new Date(), interactionCount: 10,
  });
});

describe("person.logInteraction · one contact, one row", () => {
  it("skips when logPersonInteraction already wrote this person this turn", async () => {
    m.ledgerFindFirst.mockResolvedValue([{ id: "L1", metadata: { via: "chat_tool" } }]);
    const res = await handlePersonLogInteraction({ name: "Mash", note: "covered the counter", amount: 5 }, "person.logInteraction");
    expect(m.record).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: true, result: { ledgerId: "L1", deduped: true } });
    const where = m.ledgerFindFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ personId: "p-mash", source: "chat", metadata: { path: ["via"], equals: "chat_tool" } });
    const ageMs = Date.now() - where.createdAt.gte.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(ageMs).toBeLessThanOrEqual(10 * 60_000 + 1000);
    // Only the SAME report collapses: the amount is part of the match.
    expect(where.OR).toEqual([{ amount: 5 }]);
  });

  it("a capped block (+25) matches a tool row beyond the cap (+40), the same report", async () => {
    m.ledgerFindFirst.mockResolvedValue([{ id: "L1", metadata: { via: "chat_tool" } }]);
    await handlePersonLogInteraction({ name: "Mash", note: "big help", amount: 40 }, "person.logInteraction");
    expect(m.ledgerFindFirst.mock.calls[0][0].where.OR).toEqual([{ amount: 25 }, { amount: { gt: 25 } }]);
  });

  it("writes when no tool row exists (positive control)", async () => {
    m.ledgerFindFirst.mockResolvedValue([]);
    const res = await handlePersonLogInteraction({ name: "Mash", note: "covered the counter", amount: 5 }, "person.logInteraction");
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it("a non-contact row (a synthetic mention) never counts as the tool's row", async () => {
    m.ledgerFindFirst.mockResolvedValue([{ id: "L9", metadata: { via: "chat_tool", synthetic: true } }]);
    await handlePersonLogInteraction({ name: "Mash", note: "covered the counter", amount: 5 }, "person.logInteraction");
    expect(m.record).toHaveBeenCalledTimes(1);
  });

  it("a failed dedupe read still writes (it proves no duplicate) and is logged", async () => {
    m.ledgerFindFirst.mockRejectedValue(new Error("db"));
    await handlePersonLogInteraction({ name: "Mash", note: "covered the counter", amount: 5 }, "person.logInteraction");
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.logError).toHaveBeenCalled();
  });
});
