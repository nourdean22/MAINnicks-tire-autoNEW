// @vitest-environment jsdom
/**
 * Task notes autosave and the photo viewer's two-tap delete (2026-10-29).
 * Notes: one save 800 ms after the last key, a visible saved or failed state,
 * and a save when the panel closes. Photos: delete never calls
 * window.confirm (silent in the iOS PWA), the first tap only arms, and a
 * photo that fails to load is a retry tile, not a gap. Rendered with
 * react-dom/client in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  saveNotes: vi.fn(async (_: { id: string; notes: string }) => ({ notes: "x", savedAt: "2026-10-29T16:05:00.000Z" })),
  deletePhoto: vi.fn(),
  setByIdData: vi.fn(),
  photos: [{ id: "a1" }] as Array<{ id: string }>,
}));

vi.mock("@/lib/trpc/client", () => {
  const invalidate = { invalidate: async () => {} };
  return {
    trpc: {
      task: {
        notesSave: { useMutation: () => ({ mutateAsync: h.saveNotes }) },
        attachments: { useQuery: () => ({ data: h.photos, isLoading: false, isError: false, refetch: async () => {} }) },
        attachmentDelete: {
          useMutation: () => ({ mutate: h.deletePhoto, isPending: false, isError: false, error: null }),
        },
      },
      useUtils: () => ({ task: { attachments: invalidate, byId: { setData: h.setByIdData } } }),
    },
  };
});

import { TaskNotes } from "@/components/inspector/panels/task-notes";
import { TaskPhotos } from "@/components/inspector/panels/task-photos";

let root: Root;
let host: HTMLDivElement;
const mount = (el: React.ReactElement) => act(() => root.render(el));
const type = (el: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (text: string) =>
  // document.body, not host: the photo viewer renders through a portal.
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("TaskNotes", () => {
  it("saves once, 800 ms after the last keystroke, and says saved", async () => {
    await mount(<TaskNotes taskId="t1" initial={null} />);
    const area = host.querySelector("textarea")!;
    await act(async () => type(area, "a"));
    await act(async () => type(area, "ab"));
    await act(async () => vi.advanceTimersByTime(799));
    expect(h.saveNotes).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(h.saveNotes).toHaveBeenCalledTimes(1);
    expect(h.saveNotes).toHaveBeenCalledWith({ id: "t1", notes: "ab" });
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/^saved /);
    // The cached task.byId carries the saved text, so reopening never shows (and re-saves over) an older copy.
    const [key, updater] = h.setByIdData.mock.calls[0];
    expect(key).toEqual({ id: "t1" });
    expect(updater({ id: "t1", notes: "old" })).toEqual({ id: "t1", notes: "x" });
  });

  it("a failed save says not saved and offers a retry that sends the same text", async () => {
    h.saveNotes.mockRejectedValueOnce(new Error("offline"));
    await mount(<TaskNotes taskId="t1" initial="" />);
    await act(async () => type(host.querySelector("textarea")!, "keep me"));
    await act(async () => vi.advanceTimersByTime(800));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("not saved: offline");
    await act(async () => button("Retry save")!.click());
    expect(h.saveNotes).toHaveBeenLastCalledWith({ id: "t1", notes: "keep me" });
  });

  it("closing the panel saves the last keystrokes instead of dropping them", async () => {
    await mount(<TaskNotes taskId="t1" initial="" />);
    await act(async () => type(host.querySelector("textarea")!, "typed then closed"));
    await act(async () => root.unmount());
    root = createRoot(host);
    expect(h.saveNotes).toHaveBeenCalledWith({ id: "t1", notes: "typed then closed" });
  });

  it("saves run one at a time, in order: a slow save cannot land after a newer one", async () => {
    let releaseFirst!: () => void;
    h.saveNotes.mockImplementationOnce(
      () => new Promise((r) => (releaseFirst = () => r({ notes: "x", savedAt: "2026-10-29T16:05:00.000Z" }))),
    );
    await mount(<TaskNotes taskId="t1" initial="" />);
    const area = host.querySelector("textarea")!;
    await act(async () => type(area, "first"));
    await act(async () => vi.advanceTimersByTime(800));
    await act(async () => type(area, "second"));
    await act(async () => vi.advanceTimersByTime(800));
    expect(h.saveNotes).toHaveBeenCalledTimes(1); // the second waits for the first
    await act(async () => releaseFirst());
    expect(h.saveNotes).toHaveBeenCalledTimes(2);
    expect(h.saveNotes.mock.calls.map((c) => c[0].notes)).toEqual(["first", "second"]);
  });

  it("an unchanged note is never re-saved", async () => {
    await mount(<TaskNotes taskId="t1" initial="same" />);
    await act(async () => host.querySelector("textarea")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(h.saveNotes).not.toHaveBeenCalled();
  });
});

describe("TaskPhotos viewer", () => {
  it("delete takes two taps in the page and never calls window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await mount(<TaskPhotos taskId="t1" />);
    await act(async () => (host.querySelector('button[aria-label="Open photo"]') as HTMLButtonElement).click());
    await act(async () => button("Delete")!.click());
    expect(h.deletePhoto).not.toHaveBeenCalled();
    expect(button("Tap again to delete")).toBeTruthy();
    await act(async () => button("Tap again to delete")!.click());
    expect(h.deletePhoto).toHaveBeenCalledWith({ taskId: "t1", attachmentId: "a1" });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("an armed delete disarms itself after 4 s", async () => {
    await mount(<TaskPhotos taskId="t1" />);
    await act(async () => (host.querySelector('button[aria-label="Open photo"]') as HTMLButtonElement).click());
    await act(async () => button("Delete")!.click());
    await act(async () => vi.advanceTimersByTime(4000));
    expect(button("Delete")).toBeTruthy();
  });

  it("a photo that fails to load becomes a retry tile", async () => {
    await mount(<TaskPhotos taskId="t1" />);
    const img = host.querySelector("img")!;
    await act(async () => img.dispatchEvent(new Event("error")));
    const tile = host.querySelector('button[aria-label="Photo did not load. Tap to retry"]') as HTMLButtonElement;
    expect(tile).toBeTruthy();
    await act(async () => tile.click());
    expect(host.querySelector("img")?.getAttribute("src")).toContain("?r=1");
  });
});
