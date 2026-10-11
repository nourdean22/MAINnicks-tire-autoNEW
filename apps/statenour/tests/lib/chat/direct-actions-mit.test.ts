/**
 * /mit in chat (audit 03-F1, 2026-10-10).
 *
 * The chat slash command wrote the MIT to localStorage only and toasted "MIT
 * locked", so the server MIT (operator.mit: MITSlot, Telegram, every brief)
 * never saw it, and a failed write could not exist. Now it saves through
 * operator.setMit and claims success only after the server answered.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setMit: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: h.notify }));
vi.mock("@/lib/trpc/vanilla-client", () => ({
  trpcVanilla: { operator: { setMit: { mutate: h.setMit } } },
}));

import { runDirectAction } from "@/lib/chat/direct-actions";

const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
const dispatchEvent = vi.fn();

beforeEach(() => {
  for (const f of [h.setMit, h.success, h.error, h.notify, storage.setItem, dispatchEvent]) f.mockReset();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent });
});
afterEach(() => vi.unstubAllGlobals());

describe("/mit", () => {
  it("saves through operator.setMit, never localStorage, then confirms", async () => {
    h.setMit.mockResolvedValue({ ok: true, text: "Call Mike", key: "2026-10-10" });
    const res = await runDirectAction("/mit Call Mike");
    expect(h.setMit).toHaveBeenCalledWith({ text: "Call Mike" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: true, status: "ok" });
    expect(h.success).toHaveBeenCalledWith(expect.stringContaining("Call Mike"));
    // the in-page listeners (@mit, MIT surfaces) still hear about it
    expect(dispatchEvent).toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith("mit", expect.anything());
  });

  it("a rejected save is an error with no success toast", async () => {
    h.setMit.mockRejectedValue(new Error("UNAUTHORIZED"));
    const res = await runDirectAction("/mit Call Mike");
    expect(res).toEqual({ handled: true, status: "error" });
    expect(h.success).not.toHaveBeenCalled();
    expect(h.error).toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("CONTROL: /mit with no text never calls the server", async () => {
    await runDirectAction("/mit");
    expect(h.setMit).not.toHaveBeenCalled();
    expect(h.error).toHaveBeenCalled();
  });
});
