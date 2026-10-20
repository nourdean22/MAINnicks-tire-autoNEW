/**
 * referrals.submit and qa.ask save public submissions ("$25 off", "our team will
 * answer"), but the admin screens that listed them were retired in admin-prune
 * W2a, so nothing told the shop. Each submit now sends one staff Telegram:
 * first names and the question only, never a phone or email, and a Telegram
 * failure never fails the customer's submit. The send is detached (Codex on #3185): the response
 * does not wait for Telegram, so a hung transport cannot hold a saved submission open.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const h = vi.hoisted(() => ({
  createReferral: vi.fn(),
  createQuestion: vi.fn(),
  sendTelegram: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  createReferral: h.createReferral,
  createQuestion: h.createQuestion,
}));
vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegram: h.sendTelegram,
}));

import { appRouter } from "./routers";

const publicCaller = () => appRouter.createCaller({
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
} as TrpcContext);

const REFERRAL = {
  referrerName: "Dana Smith", referrerPhone: "2165550101", referrerEmail: "dana@example.com",
  refereeName: "Lee Jones", refereePhone: "2165550102",
};
const QUESTION = { questionerName: "Pat Doe", questionerEmail: "pat@example.com", question: "How often should I rotate my tires?" };

// Codex on #3185: the two factories above spread the real modules, but give the registry back anyway.
afterAll(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./services/telegram");
});

const flush = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  h.createReferral.mockReset().mockResolvedValue({ success: true, id: 1 });
  h.createQuestion.mockReset().mockResolvedValue({ success: true, id: 2 });
  h.sendTelegram.mockReset().mockResolvedValue(true);
});

describe("a public referral reaches the shop", () => {
  it("saves it and sends one staff Telegram with first names only", async () => {
    await expect(publicCaller().referrals.submit(REFERRAL)).resolves.toEqual({ success: true, id: 1 });
    await vi.waitFor(() => expect(h.sendTelegram).toHaveBeenCalledTimes(1));
    const text = String(h.sendTelegram.mock.calls[0][0]);
    expect(text).toContain("Dana referred Lee");
    expect(text).not.toMatch(/Smith|Jones|2165550101|2165550102|dana@example\.com/);
  });

  it("a Telegram failure does not fail the submit", async () => {
    h.sendTelegram.mockRejectedValue(new Error("telegram down"));
    await expect(publicCaller().referrals.submit(REFERRAL)).resolves.toEqual({ success: true, id: 1 });
    await vi.waitFor(() => expect(h.sendTelegram).toHaveBeenCalledTimes(1));
  });

  it("a Telegram that never answers does not hold the response", async () => {
    h.sendTelegram.mockReturnValue(new Promise(() => {}));
    const settled = await Promise.race([
      publicCaller().referrals.submit(REFERRAL).then(() => "resolved"),
      new Promise((r) => setTimeout(() => r("held"), 1000)),
    ]);
    expect(settled).toBe("resolved");
  });

  it("a blocked self-referral saves nothing and sends nothing", async () => {
    await publicCaller().referrals.submit({ ...REFERRAL, refereePhone: REFERRAL.referrerPhone });
    expect(h.createReferral).not.toHaveBeenCalled();
    await flush();
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });
});

describe("a public question reaches the shop", () => {
  it("saves it and sends one staff Telegram with the first name and the question", async () => {
    await expect(publicCaller().qa.ask(QUESTION)).resolves.toEqual({ success: true, id: 2 });
    await vi.waitFor(() => expect(h.sendTelegram).toHaveBeenCalledTimes(1));
    const text = String(h.sendTelegram.mock.calls[0][0]);
    expect(text).toContain("Pat");
    expect(text).toContain("How often should I rotate my tires?");
    expect(text).not.toMatch(/Doe|pat@example\.com/);
  });

  it("a Telegram failure does not fail the submit", async () => {
    h.sendTelegram.mockRejectedValue(new Error("telegram down"));
    await expect(publicCaller().qa.ask(QUESTION)).resolves.toEqual({ success: true, id: 2 });
    await vi.waitFor(() => expect(h.sendTelegram).toHaveBeenCalledTimes(1));
  });

  it("a Telegram that never answers does not hold the response", async () => {
    h.sendTelegram.mockReturnValue(new Promise(() => {}));
    const settled = await Promise.race([
      publicCaller().qa.ask(QUESTION).then(() => "resolved"),
      new Promise((r) => setTimeout(() => r("held"), 1000)),
    ]);
    expect(settled).toBe("resolved");
  });
});
