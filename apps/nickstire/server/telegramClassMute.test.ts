/**
 * Telegram alert diet · every send has a class, and the classes Nour can mute are muteable
 * from the admin feature flags.
 *
 * incident / digest / approval are muted by a PAUSE flag (telegram_<class>_muted, default
 * absent = false = not muted), so an unreadable flag table can never silence an incident.
 * receipt is the one class that is OFF by default: it sends only when telegram_receipt is
 * ON, and an unreadable flag means held. noise is never sent. A muted send is a decision,
 * not a failure: it returns true (callers that throw on false would otherwise fail every
 * muted digest) and is counted per class (getTelegramStats().muted).
 *
 * The REAL transport runs against a stubbed fetch; only the flag reader is faked.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // The transport reads these at import, so they are set before it loads; the originals come back in afterAll.
  const savedEnv = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "4242";
  return { flags: {} as Record<string, boolean>, flagsThrow: false, savedEnv };
});

afterAll(() => {
  if (h.savedEnv.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = h.savedEnv.token;
  if (h.savedEnv.chat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = h.savedEnv.chat;
});

vi.mock("./services/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/featureFlags")>()),
  isEnabled: vi.fn(async (key: string) => {
    if (h.flagsThrow) throw new Error("flag table unreadable");
    return h.flags[key] === true;
  }),
}));

type TelegramModule = typeof import("./services/telegram");
async function load(): Promise<TelegramModule> {
  vi.resetModules();
  return import("./services/telegram");
}
function stubFetch() {
  const calls: Array<{ method: string; text: string }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    calls.push({ method: String(url).split("/").pop() as string, text: String(JSON.parse(init?.body ?? "{}").text ?? "") });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return calls;
}

describe("telegram classes", () => {
  beforeEach(() => {
    h.flags = {};
    h.flagsThrow = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an unclassified send is an incident and goes out with nothing configured", async () => {
    const calls = stubFetch();
    const tg = await load();
    expect(await tg.sendTelegram("plain")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["incident", "telegram_incident_muted"],
    ["digest", "telegram_digest_muted"],
    ["approval", "telegram_approval_muted"],
  ] as const)("%s is sent by default and held when %s is ON", async (cls, flag) => {
    const calls = stubFetch();
    const tg = await load();
    expect(await tg.sendTelegram("one", cls)).toBe(true);
    expect(calls).toHaveLength(1);
    h.flags[flag] = true;
    expect(await tg.sendTelegram("two", cls)).toBe(true); // a decision, not a failure
    expect(calls).toHaveLength(1);
    expect(tg.getTelegramStats().muted[cls]).toBe(1);
    expect(tg.getTelegramStats().sent).toBe(1);
  });

  it("a muted class does not mute the others", async () => {
    const calls = stubFetch();
    h.flags.telegram_digest_muted = true;
    const tg = await load();
    await tg.sendTelegram("brief", "digest");
    await tg.sendTelegram("fire", "incident");
    expect(calls.map((c) => c.text)).toEqual([expect.stringContaining("fire")]);
  });

  it("receipt is held by default and sent when telegram_receipt is ON", async () => {
    const calls = stubFetch();
    const tg = await load();
    expect(await tg.sendTelegram("job done", "receipt")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(tg.getTelegramStats().muted.receipt).toBe(1);
    h.flags.telegram_receipt = true;
    await tg.sendTelegram("job done again", "receipt");
    expect(calls).toHaveLength(1);
  });

  it("noise is never sent, whatever the flags say", async () => {
    const calls = stubFetch();
    h.flags = { telegram_receipt: true };
    const tg = await load();
    expect(await tg.sendTelegram("tick", "noise")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(tg.getTelegramStats().muted.noise).toBe(1);
  });

  it("an unreadable flag table never silences an incident, digest or approval, and holds receipts", async () => {
    const calls = stubFetch();
    h.flagsThrow = true;
    const tg = await load();
    await tg.sendTelegram("a", "incident");
    await tg.sendTelegram("b", "digest");
    await tg.sendTelegram("c", "approval");
    await tg.sendTelegram("d", "receipt");
    expect(calls.map((c) => c.text)).toEqual(["a", "b", "c"]);
  });

  it("an unknown class name at runtime is treated as an incident, never dropped", async () => {
    const calls = stubFetch();
    h.flags = { telegram_digest_muted: true, telegram_receipt: false };
    const tg = await load();
    // @ts-expect-error "chatter" is not a TelegramClass: the compiler rejects it
    await tg.sendTelegram("stray", "chatter");
    expect(calls).toHaveLength(1);
  });

  it("the alert helpers carry their class: the daily summary is a digest, a new lead is an incident", async () => {
    const calls = stubFetch();
    h.flags = { telegram_digest_muted: true };
    const tg = await load();
    await tg.sendDailySummary({ leads: 1, bookings: 1, revenue: 10, reviews: 0 });
    expect(calls).toHaveLength(0);
    await tg.alertNewLead({ name: "Ann", phone: "2165550142" });
    expect(calls).toHaveLength(1);
  });

  it("held receipts show in the daily summary line", async () => {
    const calls = stubFetch();
    const tg = await load();
    await tg.sendTelegram("r1", "receipt");
    await tg.sendTelegram("r2", "receipt");
    await tg.sendDailySummary({ leads: 1, bookings: 1, revenue: 10, reviews: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("2 receipts held");
  });
});
