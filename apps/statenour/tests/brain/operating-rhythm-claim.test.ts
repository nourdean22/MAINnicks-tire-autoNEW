/**
 * operating-rhythm claims its daily slot BEFORE it sends (audit 08-X1, R3-02b, 2026-10-11).
 *
 * The rhythm read its `rhythm_<slot>_<date>` marker, sent the Telegram, then wrote the
 * marker. A failed read looked like "not sent", and two overlapping runs both read "not
 * sent": both paths sent twice. The claim is now a create on the (category, key) unique
 * index (claimPushSlot); the loser and a store that cannot answer never send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queryNick: vi.fn(),
  sendTelegram: vi.fn(),
  keys: new Set<string>(),
  storeDown: false,
  readFails: false,
  db: {} as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick: h.queryNick,
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn(async () => undefined) } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { executeRhythm } from "@/lib/brain/operating-rhythm";
import { today } from "@/lib/utils/datetime";

const unique = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const down = () => new Error("Can't reach database server");
type KeyArgs = { where?: { category_key?: { key: string }; key?: string }; create?: { key: string }; data?: { key: string } };

// A store that honours the (category, key) unique index, so a race is decided by the store.
function resetDb() {
  h.keys.clear();
  h.storeDown = false;
  h.readFails = false;
  for (const k of Object.keys(h.db)) delete h.db[k];
  Object.assign(h.db, {
    userPreference: { findUnique: vi.fn(async () => null) },
    brainMemory: {
      findUnique: vi.fn(async (a: KeyArgs) => {
        if (h.storeDown || h.readFails) throw down();
        return h.keys.has(a.where?.category_key?.key ?? "") ? { id: "m1" } : null;
      }),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (a: KeyArgs) => {
        if (h.storeDown) throw down();
        h.keys.add(a.create!.key);
        return {};
      }),
      create: vi.fn(async (a: KeyArgs) => {
        if (h.storeDown) throw down();
        if (h.keys.has(a.data!.key)) throw unique();
        h.keys.add(a.data!.key);
        return {};
      }),
      deleteMany: vi.fn(async (a: KeyArgs) => {
        if (h.storeDown) throw down();
        return { count: h.keys.delete(a.where!.key!) ? 1 : 0 };
      }),
    },
    task: { count: vi.fn(async () => 3), findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    commitment: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
    auditEvent: { create: vi.fn(async () => ({})) },
  });
}

const KEY = () => `rhythm_mid_morning_${today()}`;

beforeEach(() => {
  resetDb();
  h.queryNick.mockReset().mockResolvedValue({ data: { count: 0, totalDollars: 50, invoiceCount: 1 } });
  // A slow send, so two overlapping runs both finish their dedupe step before either sends.
  h.sendTelegram.mockReset().mockImplementation(() => new Promise((r) => setTimeout(() => r(true), 5)));
});

describe("operating-rhythm: claim the slot before the send", () => {
  it("CONTROL: a fresh slot on a healthy store sends exactly once", async () => {
    const out = await executeRhythm("mid_morning");
    expect(out.sent).toBe(true);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(h.keys.has(KEY())).toBe(true);
  });

  it("two overlapping runs for the same slot send once", async () => {
    const [a, b] = await Promise.all([executeRhythm("mid_morning"), executeRhythm("mid_morning")]);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect([a.message, b.message]).toContain("already_sent_today");
  });

  it("a failed marker read with today's slot already taken does not send again", async () => {
    h.keys.add(KEY());
    h.readFails = true;
    await executeRhythm("mid_morning");
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("a store that cannot answer fails closed: no send", async () => {
    h.storeDown = true;
    const out = await executeRhythm("mid_morning");
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(out.message).toBe("dedupe_unavailable");
  });

  it("a failed send gives the slot back, so the next tick may retry", async () => {
    h.sendTelegram.mockResolvedValue(false);
    await executeRhythm("mid_morning");
    expect(h.keys.has(KEY())).toBe(false);
    h.sendTelegram.mockResolvedValue(true);
    expect((await executeRhythm("mid_morning")).sent).toBe(true);
  });
});
