// @vitest-environment jsdom
/**
 * U6c (2026-10-31) · Nour asked for "full controls over ... any other pop ups". The chat showed 30+
 * kinds of toast with no way to quiet the routine ones. Now the More sheet holds a pop-ups list,
 * saved per viewer in this browser: "done" confirmations and the live-context fallback note can be
 * muted; errors, Undo and "that did not happen" notes cannot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const t = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() });
  return { toast: fn };
});
vi.mock("sonner", () => ({ toast: t.toast }));

import { MUTED_POPUPS_KEY, doneToast, fallbackToast, readMutedPopups, setPopupMuted } from "@/features/chat-v2/lib/popup-mutes";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("pop-up mute list (U6c)", () => {
  it("nothing saved: every pop-up shows", () => {
    expect(readMutedPopups()).toEqual([]);
    doneToast("Copied to clipboard");
    fallbackToast("went local");
    expect(t.toast.success).toHaveBeenCalledWith("Copied to clipboard", undefined);
    expect(t.toast).toHaveBeenCalledWith("went local", undefined);
  });

  it("muting done hides confirmations only; the fallback note still shows", () => {
    expect(setPopupMuted("done", true)).toEqual(["done"]);
    doneToast("Saved as belief");
    fallbackToast("went local");
    expect(t.toast.success).not.toHaveBeenCalled();
    expect(t.toast).toHaveBeenCalledTimes(1);
  });

  it("unmuting brings it back, and the choice is saved for this browser", () => {
    setPopupMuted("fallback", true);
    setPopupMuted("done", true);
    expect(JSON.parse(window.localStorage.getItem(MUTED_POPUPS_KEY)!)).toEqual(["done", "fallback"]);
    expect(setPopupMuted("done", false)).toEqual(["fallback"]);
    doneToast("Feedback saved");
    expect(t.toast.success).toHaveBeenCalledTimes(1);
  });

  it("garbage or unknown kinds in storage mute nothing", () => {
    window.localStorage.setItem(MUTED_POPUPS_KEY, "{not json");
    expect(readMutedPopups()).toEqual([]);
    window.localStorage.setItem(MUTED_POPUPS_KEY, JSON.stringify(["error", "undo", "done"]));
    expect(readMutedPopups()).toEqual(["done"]);
  });

  it("storage blocked: the read says nothing is muted and the write does not claim a mute", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(setPopupMuted("done", true)).toEqual([]);
    doneToast("Copied to clipboard");
    expect(t.toast.success).toHaveBeenCalledTimes(1);
  });
});

// The consumer end: a mute that only some confirmations read is a switch that half works. Every
// success toast in the chat feature goes through doneToast, and the live-context note through
// fallbackToast. Errors are never routed through either helper.
describe("chat confirmations read the mute list", () => {
  const root = join(__dirname, "..", "..", "features", "chat-v2");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
    });
  const code = (p: string) => readFileSync(p, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");

  it("found the chat sources it guards (a scan of nothing proves nothing)", () => {
    expect(files(root).length).toBeGreaterThan(20);
    expect(files(root).filter((p) => code(p).includes("doneToast(")).length).toBeGreaterThanOrEqual(4);
  });

  it("no chat file calls toast.success directly", () => {
    const direct = files(root).filter((p) => !p.endsWith("popup-mutes.ts") && /\btoast\.success\(/.test(code(p)));
    expect(direct).toEqual([]);
  });

  it("the live-context fallback note is muteable; no error goes through a mute helper", () => {
    const composer = code(join(root, "components", "chat-composer.tsx"));
    expect(composer).toMatch(/fallbackToast\("Live context took too long/);
    for (const p of files(root)) expect(code(p)).not.toMatch(/(doneToast|fallbackToast)\([^)]*(Couldn't|failed|blocked|error)/i);
  });
});
