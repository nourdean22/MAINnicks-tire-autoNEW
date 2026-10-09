/**
 * intelligence.chatFunnel answers a failed read with an error, never an empty funnel (2026-10-09).
 *
 * analyzeChatFunnel now marks a failed read `unavailable: true`. The Admin AI Ideas page labels
 * its "From Intelligence" count "(not read)" only when the query ERRORS; an empty funnel reads as
 * "(payloads carry no topics)". So the procedure turns the marker into an error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db", () => ({ getDb: async () => ({ execute: h.execute }) }));

import { intelligenceRouter } from "./intelligence";

function adminContext() {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin User", loginMethod: "manus",
      role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

afterEach(() => h.execute.mockReset());

describe("intelligence.chatFunnel", () => {
  it("a failed read is an error, not an empty funnel", async () => {
    h.execute.mockRejectedValue(new Error("TiDB timeout"));
    await expect(intelligenceRouter.createCaller(adminContext()).chatFunnel()).rejects.toThrow(/chat funnel read failed/);
  });

  it("a readable quiet period is an empty funnel (control)", async () => {
    h.execute.mockResolvedValue([[], []]);
    const out = await intelligenceRouter.createCaller(adminContext()).chatFunnel();
    expect(out).toMatchObject({ opened: 0, booked: 0 });
    expect(out).not.toHaveProperty("unavailable");
  });
});
