/**
 * Autopilot Wave 3 — Decision-Inbox texting pair (2026-07-29).
 *
 * Pinned:
 *   1. draftOpportunitySms is a pure bridge read (queryNick draft action),
 *      surfaces bridge errors as { ok:false }.
 *   2. sendOpportunitySms NEVER sends: it stages a PENDING ActionReceipt
 *      with the §8 payload (opportunityId + exact body + content-derived
 *      idempotency key — NO phone number) and a Telegram Approve prompt.
 *      queryNick is never called from the staging path.
 *   3. Re-staging the same text for the same opportunity dedupes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryNickSpy = vi.fn(async (): Promise<Record<string, unknown>> => ({
  data: { ok: true, draft: "Hey, it's Nick's Tire & Auto…", riskLabel: "low" },
  query: "draft_opportunity_sms",
  timestamp: "t",
}));
vi.mock("@/lib/nickstire/query", () => ({
  queryNick: (...args: unknown[]) => queryNickSpy(...args),
}));

const receiptCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "receipt-1", ...args.data }));
/** In-memory BrainMemory emulating the @@unique([category,key]) constraint the
 *  idempotency layer claims markers through (P2002 on duplicate). */
const markers = new Map<string, { expiresAt: Date }>();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    actionReceipt: { create: (args: never) => receiptCreate(args) },
    brainMemory: {
      create: async ({ data }: { data: { category: string; key: string; expiresAt: Date } }) => {
        const k = `${data.category}:${data.key}`;
        if (markers.has(k)) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        markers.set(k, { expiresAt: data.expiresAt });
        return { id: "m1" };
      },
      findUnique: async ({ where }: { where: { category_key: { category: string; key: string } } }) => {
        const k = `${where.category_key.category}:${where.category_key.key}`;
        return markers.has(k) ? { expiresAt: markers.get(k)!.expiresAt } : null;
      },
      update: async () => ({}),
      delete: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
  },
}));

const buttonsSpy = vi.fn(async () => true);
vi.mock("@/lib/services/telegram", () => ({
  sendTelegramWithButtons: (...args: unknown[]) => buttonsSpy(...args),
  sendTelegram: async () => true,
  formatTelegramNotification: (t: string, m: string) => `${t}\n${m}`,
}));

vi.mock("@/lib/utils/error-log", () => ({
  logError: vi.fn(),
}));

import { socialTools } from "@/lib/ai/tools/social";

const OPP_ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  queryNickSpy.mockClear();
  receiptCreate.mockClear();
  buttonsSpy.mockClear();
  markers.clear();
});

describe("draftOpportunitySms", () => {
  it("reads the bridge draft action and returns its payload", async () => {
    const res = await (socialTools.draftOpportunitySms.execute as (a: unknown, b: unknown) => Promise<Record<string, unknown>>)(
      { opportunityId: OPP_ID },
      {},
    );
    expect(res.ok).toBe(true);
    expect(res.draft).toContain("Nick's Tire");
    expect(queryNickSpy).toHaveBeenCalledWith("draft_opportunity_sms", { opportunityId: OPP_ID });
  });

  it("surfaces a bridge error as ok:false (never throws into the chat loop)", async () => {
    queryNickSpy.mockResolvedValueOnce({ error: "No sync key configured." });
    const res = await (socialTools.draftOpportunitySms.execute as (a: unknown, b: unknown) => Promise<Record<string, unknown>>)(
      { opportunityId: OPP_ID },
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sync key/i);
  });
});

describe("sendOpportunitySms (staging only)", () => {
  it("stages a PENDING receipt with the §8 payload and Telegram buttons — and NEVER calls the bridge", async () => {
    const res = await (socialTools.sendOpportunitySms.execute as (a: unknown, b: unknown) => Promise<Record<string, unknown>>)(
      { opportunityId: OPP_ID, body: "Hey Sam — Nick's Tire here. Still want a hand?", customerLabel: "Sam (stale lead)" },
      {},
    );
    expect(res.status).toBe("STAGED");
    expect(res.receiptId).toBe("receipt-1");

    expect(receiptCreate).toHaveBeenCalledTimes(1);
    const data = receiptCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.action).toBe("shop.sendOpportunitySms");
    expect(data.status).toBe("PENDING");
    const payload = data.verificationPayload as Record<string, unknown>;
    expect(payload.kind).toBe("opportunity_sms");
    expect(payload.opportunityId).toBe(OPP_ID);
    expect(String(payload.idempotencyKey)).toMatch(/^opp-11111111-[0-9a-f]{16}$/);
    // §8: identity = the opportunity row. The staged payload must carry NO
    // phone number for the webhook to free-form target.
    expect(payload.phone).toBeUndefined();

    expect(buttonsSpy).toHaveBeenCalledTimes(1);
    const [text, buttons] = buttonsSpy.mock.calls[0] as [string, Array<Array<{ callback_data: string }>>];
    expect(text).toContain("Hey Sam — Nick's Tire here. Still want a hand?");
    expect(buttons[0][0].callback_data).toBe("oppsms:approve:receipt-1");
    expect(buttons[0][1].callback_data).toBe("oppsms:deny:receipt-1");

    // the send action is the webhook's job (on the Approve tap) — never staging's
    expect(queryNickSpy).not.toHaveBeenCalled();
  });

  it("dedupes an identical re-stage (same opportunity + same exact text)", async () => {
    const args = { opportunityId: OPP_ID, body: "Same text", customerLabel: "Sam" };
    const exec = socialTools.sendOpportunitySms.execute as (a: unknown, b: unknown) => Promise<Record<string, unknown>>;
    const first = await exec(args, {});
    const second = await exec(args, {});
    expect(first.status).toBe("STAGED");
    expect(second.status).toBe("DEDUPED");
    expect(receiptCreate).toHaveBeenCalledTimes(1);
    expect(buttonsSpy).toHaveBeenCalledTimes(1);
  });
});
