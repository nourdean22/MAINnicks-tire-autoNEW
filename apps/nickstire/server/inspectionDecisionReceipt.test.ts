/**
 * A customer's decision on an inspection item leaves a durable receipt that
 * says who decided, when, and for how much (Q-46, 2026-09-29).
 *
 * The share link (/inspection/:token) is the one place a customer approves
 * repair work in this app. decideInspectionItem overwrote `decision`,
 * `decisionAt` and `customerNote` on the item row, so:
 *
 * 1. A change of mind erased the earlier answer. An approval followed by a
 *    decline left no trace that the customer ever approved.
 * 2. Nothing recorded the amount. `estimatedCost` stays editable after the
 *    customer answers (inspection.updateItem), so the row could not say what
 *    price the customer said yes to. OAC 109:4-3-13 ties authorization to the
 *    amount, and the rule does not itself demand a log (see
 *    docs/VOICE-RECOVERY-AUDIT-2026-09-18.md §2b), but an approval with no
 *    amount is not evidence of anything.
 * 3. The owner's Telegram alert divided `estimatedCost` by 100. The column
 *    holds whole dollars (InspectionCapturePanel sends the typed "Est. $"
 *    number; InspectionReport renders it as `$${estimatedCost}`), so a $450
 *    approval reached the owner as "(~$5)".
 *
 * The fix writes one append-only audit_log row per decision through the
 * activity ledger (no new table), with the stored amount and the amount the
 * customer's page showed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./db");

const h = vi.hoisted(() => ({
  /** affectedRows the UPDATE reports. */
  affected: 1,
  /** The item row the post-decision SELECTs read, or null for none. */
  row: null as Record<string, unknown> | null,
  executed: 0,
  recorded: [] as Array<Record<string, unknown>>,
  telegram: [] as string[],
}));

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ end: async () => {} }) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    // First execute() is the UPDATE; every later one is a SELECT of the item.
    execute: async () => {
      h.executed += 1;
      if (h.executed === 1) return [{ affectedRows: h.affected }, []];
      return [h.row ? [h.row] : [], []];
    },
  }),
}));
vi.mock("./services/activityLedger", () => ({
  recordActivity: async (input: Record<string, unknown>) => {
    h.recorded.push(input);
  },
}));
vi.mock("./services/realtime", () => ({ emitToAdmin: () => {} }));
vi.mock("./services/telegram", () => ({
  sendTelegram: async (text: string) => {
    h.telegram.push(text);
  },
}));

const { decideInspectionItem } = await import("./db");

const TOKEN = "a".repeat(32);
const ITEM = {
  inspectionId: 7,
  customerName: "Test Customer",
  vehicleInfo: "2015 Honda Civic",
  component: "Front brake pads",
  recommendedAction: "Replace front pads and resurface rotors",
  estimatedCost: 450,
  decisionAt: "2026-09-29 13:30:00",
};

const savedUrl = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test:3306/db";
  h.affected = 1;
  h.row = { ...ITEM };
  h.executed = 0;
  h.recorded = [];
  h.telegram = [];
});
afterAll(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

/** Let the fire-and-forget owner notification finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("decideInspectionItem receipt", () => {
  it("records an approval with who, when and the amount, awaited before it returns", async () => {
    const res = await decideInspectionItem({ token: TOKEN, itemId: 11, decision: "approved", shownCost: 450 });

    expect(res).toEqual({ ok: true });
    expect(h.recorded).toHaveLength(1);
    const r = h.recorded[0] as {
      action: string;
      entityType: string;
      entityId: number;
      actor: { actor: string; actorType: string };
      after: Record<string, unknown>;
    };
    expect(r.action).toBe("inspection.item_decided");
    expect(r.entityType).toBe("inspection_item");
    expect(r.entityId).toBe(11);
    expect(r.actor).toEqual({ actor: "inspection-link:7", actorType: "public" });
    expect(r.after).toMatchObject({
      inspectionId: 7,
      decision: "approved",
      channel: "inspection_link",
      component: "Front brake pads",
      amountDollars: 450,
      amountShownDollars: 450,
      amountMatchesShown: true,
      decidedAt: "2026-09-29 13:30:00",
    });
  });

  it("keeps each change of mind as its own receipt", async () => {
    await decideInspectionItem({ token: TOKEN, itemId: 11, decision: "approved", shownCost: 450 });
    h.executed = 0;
    await decideInspectionItem({ token: TOKEN, itemId: 11, decision: "declined", note: "too much right now" });

    expect(h.recorded.map((r) => (r.after as { decision: string }).decision)).toEqual(["approved", "declined"]);
    expect((h.recorded[1].after as Record<string, unknown>).customerNote).toBe("too much right now");
  });

  it("flags an approval whose page showed a different price than the row now holds", async () => {
    await decideInspectionItem({ token: TOKEN, itemId: 11, decision: "approved", shownCost: 380 });

    expect(h.recorded[0].after).toMatchObject({ amountDollars: 450, amountShownDollars: 380, amountMatchesShown: false });
  });

  it("says the match is unknown when the page did not send a price", async () => {
    await decideInspectionItem({ token: TOKEN, itemId: 11, decision: "approved" });

    expect(h.recorded[0].after).toMatchObject({ amountDollars: 450, amountShownDollars: null, amountMatchesShown: null });
  });

  it("writes no receipt when the token does not unlock the item", async () => {
    h.affected = 0;
    const res = await decideInspectionItem({ token: TOKEN, itemId: 99, decision: "approved", shownCost: 450 });

    expect(res.ok).toBe(false);
    expect(h.recorded).toHaveLength(0);
  });

  it("tells the owner the amount in dollars, not dollars divided by 100", async () => {
    await decideInspectionItem({ token: TOKEN, itemId: 11, decision: "approved", shownCost: 450 });
    await settle();

    expect(h.telegram).toHaveLength(1);
    expect(h.telegram[0]).toContain("($450)");
    expect(h.telegram[0]).not.toContain("~$5)");
  });
});
