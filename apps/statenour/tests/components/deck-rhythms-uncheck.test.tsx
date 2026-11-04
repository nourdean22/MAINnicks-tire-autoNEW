// @vitest-environment jsdom
/**
 * /missions rhythms · two-tap uncheck (2026-11-03). A done DAILY circle used to
 * be disabled: a mis-tap could only be undone from the chat. Now the first tap
 * arms it, the second unchecks; the arm lapses after 4 s; a weekly rhythm (the
 * server refuses its uncheck) stays disabled; window.confirm is never called
 * (suppressed in the iOS PWA).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DeckRhythms } from "@/components/missions/deck-rhythms";
import type { MissionsDeck } from "@/lib/missions/deck";

const ROWS: MissionsDeck["rhythms"] = [
  { id: "d1", title: "Journal", loopKind: "DAILY", dueToday: true, doneToday: true, windowDone: 5, windowOf: 7 },
  { id: "w1", title: "Weigh in", loopKind: "WEEKLY", recurringDays: [2], dueToday: true, doneToday: true, windowDone: 1, windowOf: 7 },
];

let container: HTMLDivElement;
let root: Root;
const onComplete = vi.fn(async () => true);
const onUncheck = vi.fn(async (_id: string) => true);

const render = () =>
  act(() => {
    root.render(<DeckRhythms rhythms={ROWS} onComplete={onComplete} onUncheck={onUncheck} onEdit={vi.fn()} onAdd={vi.fn(async () => true)} />);
  });
const circle = (title: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    new RegExp(`(uncheck|done|Mark) .*${title}|${title}, done`).test(b.getAttribute("aria-label") ?? ""),
  )!;
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onComplete.mockClear();
  onUncheck.mockClear();
  onUncheck.mockResolvedValue(true);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("DeckRhythms · two-tap uncheck", () => {
  it("the first tap arms, the second unchecks; window.confirm is never called", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render();
    const c = circle("Journal");
    expect(c.disabled).toBe(false);
    expect(c.getAttribute("aria-label")).toBe("Journal, done today. Tap to uncheck");

    await click(c);
    expect(onUncheck).not.toHaveBeenCalled();
    expect(circle("Journal").getAttribute("aria-label")).toBe("Confirm: uncheck Journal for today");
    expect(container.textContent).toContain("tap again to uncheck");

    await click(circle("Journal"));
    expect(onUncheck).toHaveBeenCalledTimes(1);
    expect(onUncheck).toHaveBeenCalledWith("d1");
    expect(onComplete).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    // Unchecked in place before the deck refetches: the circle offers the tick again.
    expect(circle("Journal").getAttribute("aria-label")).toBe("Mark Journal done");
  });

  it("the arm lapses after 4 s: a late tap re-arms instead of unchecking", async () => {
    vi.useFakeTimers();
    render();
    await click(circle("Journal"));
    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    expect(circle("Journal").getAttribute("aria-label")).toBe("Journal, done today. Tap to uncheck");
    await click(circle("Journal"));
    expect(onUncheck).not.toHaveBeenCalled();
  });

  it("a failed uncheck leaves the day done", async () => {
    onUncheck.mockResolvedValue(false);
    render();
    await click(circle("Journal"));
    await click(circle("Journal"));
    expect(onUncheck).toHaveBeenCalledTimes(1);
    expect(circle("Journal").getAttribute("aria-label")).toBe("Journal, done today. Tap to uncheck");
    expect(container.textContent).toContain("could not be unchecked");
  });

  it("while the uncheck is in flight the circle is disabled, so a second tap cannot re-tick it", async () => {
    let release!: (ok: boolean) => void;
    onUncheck.mockImplementation(() => new Promise<boolean>((r) => (release = r)));
    render();
    await click(circle("Journal"));
    await click(circle("Journal"));
    const pending = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => /Journal/.test(b.getAttribute("aria-label") ?? "") && !/^Edit/.test(b.getAttribute("aria-label") ?? ""))!;
    expect(pending.disabled).toBe(true);
    await click(pending);
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => release(true));
  });

  it("a weekly rhythm cannot be unchecked here (the server refuses it): its done circle stays disabled", async () => {
    render();
    const w = circle("Weigh in");
    expect(w.disabled).toBe(true);
    expect(w.getAttribute("aria-label")).toBe("Weigh in, done today");
  });

  it("the circle keeps the 44 px floor", () => {
    render();
    expect(circle("Journal").className).toMatch(/min-h-\[44px\]/);
    expect(circle("Journal").className).toMatch(/min-w-\[44px\]/);
  });
});
