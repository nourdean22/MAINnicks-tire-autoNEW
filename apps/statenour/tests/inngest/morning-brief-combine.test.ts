/**
 * morning-brief · combine hand-off + backstop · 2026-08-21.
 *
 * Operator complaint: two separate 10:00/10:15 pushes for what is
 * conceptually ONE morning briefing. `handOffForCombine` hands morning's
 * highlight to intelligence-brief (10:15 UTC) instead of pushing it
 * directly; `sendStandaloneIfUnconsumed` is the durable backstop that
 * fires ~35min later if intelligence-brief never picked it up — a
 * scheduling failure on the OTHER function must never silently cost the
 * operator their morning brief.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  delete: vi.fn(),
  sendPush: vi.fn(),
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: h.upsert,
      findUnique: h.findUnique,
      delete: h.delete,
    },
  },
}));
vi.mock("@/lib/notifications/push", () => ({
  sendPush: h.sendPush,
}));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
}));

import { handOffForCombine, sendStandaloneIfUnconsumed } from "@/lib/inngest/functions/morning-brief";

const BRIEF = { date: "2026-08-21", text: "Drift: CRITICAL\nOpen tasks: 14", sectionCount: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  h.upsert.mockResolvedValue({ id: "row-1" });
  h.findUnique.mockResolvedValue(null);
  h.delete.mockResolvedValue({ id: "row-1" });
  h.sendPush.mockResolvedValue({ sent: 1, failed: 0 });
  h.sendTelegram.mockResolvedValue(true);
});

describe("handOffForCombine", () => {
  it("upserts the FULL brief text (not a truncated teaser) keyed by date instead of pushing directly", async () => {
    // The whole point of combining is a landing page (/intelligence/brief)
    // where the operator can read both briefs in full — truncating here
    // would leave morning's half permanently clipped to 200 chars even
    // on the page built to show it.
    const result = await handOffForCombine(BRIEF);

    expect(h.sendPush).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category_key: { category: "pending_morning_highlight", key: "2026-08-21" } },
        create: expect.objectContaining({
          category: "pending_morning_highlight",
          key: "2026-08-21",
          content: BRIEF.text,
        }),
      }),
    );
    // {sent:1} on purpose — content WILL reach the device (combined or
    // backstopped), so the outcome ledger + telegram-fallback steps
    // downstream correctly treat this as delivered, not lost.
    expect(result).toEqual({ sent: 1, failed: 0 });
  });
});

describe("sendStandaloneIfUnconsumed", () => {
  it("no-ops when intelligence-brief already consumed the hand-off", async () => {
    h.findUnique.mockResolvedValue(null);

    const result = await sendStandaloneIfUnconsumed(BRIEF);

    expect(result).toEqual({ status: "combined" });
    expect(h.sendPush).not.toHaveBeenCalled();
    expect(h.delete).not.toHaveBeenCalled();
  });

  it("delivers standalone when the pending row is still there — the backstop", async () => {
    h.findUnique.mockResolvedValue({ id: "row-1" });
    h.sendPush.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await sendStandaloneIfUnconsumed(BRIEF);

    expect(h.sendPush).toHaveBeenCalledTimes(1);
    expect(h.delete).toHaveBeenCalledWith({ where: { id: "row-1" } });
    expect(result).toEqual({ status: "standalone_sent", push: { sent: 1, failed: 0 } });
  });

  it("deletes the row even when the backstop push itself fails — never retries forever", async () => {
    h.findUnique.mockResolvedValue({ id: "row-1" });
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });

    const result = await sendStandaloneIfUnconsumed(BRIEF);

    expect(h.delete).toHaveBeenCalledWith({ where: { id: "row-1" } });
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("standalone_failed");
  });

  it("clears the row on a failed backstop delete without throwing — best-effort cleanup", async () => {
    h.findUnique.mockResolvedValue({ id: "row-1" });
    h.delete.mockRejectedValue(new Error("db hiccup"));
    h.sendPush.mockResolvedValue({ sent: 1, failed: 0 });

    await expect(sendStandaloneIfUnconsumed(BRIEF)).resolves.toEqual({
      status: "standalone_sent",
      push: { sent: 1, failed: 0 },
    });
  });
});
