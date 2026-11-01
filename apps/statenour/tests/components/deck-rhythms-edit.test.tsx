// @vitest-environment jsdom
/**
 * /missions rhythms were tick-only (Nour 2026-10-26: "i need to be able to edit the routines, daily,
 * weekly, add subtract"). Each row now has an edit entry (the title, opening the page's TaskEditSheet),
 * says its cadence in words, and the list ends in an add row. Every control is read at the 44 px house
 * floor from its class (jsdom does not lay out Tailwind; same shape as actions-controls-44px.test.tsx).
 *
 * Positive controls: the tick still calls onComplete with the row's id and loopKind; the sweep must locate
 * all the controls it measures (a scanner that matched nothing would pass on a deleted row).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DeckRhythms } from "@/components/missions/deck-rhythms";
import type { MissionsDeck } from "@/lib/missions/deck";

type Rhythms = MissionsDeck["rhythms"];

const ROWS: Rhythms = [
  { id: "d1", title: "10 breaths in bed", loopKind: "DAILY", dueToday: true, doneToday: false, windowDone: 3, windowOf: 7 },
  { id: "w1", title: "Weigh in", loopKind: "WEEKLY", recurringDays: [1, 3, 5], dueToday: true, doneToday: false, windowDone: 1, windowOf: 7 },
  { id: "w2", title: "Plan the week", loopKind: "WEEKLY", recurringDays: [], dueToday: false, doneToday: true, windowDone: 1, windowOf: 7 },
];

/** Height / width floor: min-h-11, min-h-[44px], h-11 or taller. A later, smaller class wins, so it is read last. */
const floor = (cls: string, axis: "h" | "w"): number => {
  const re = axis === "h" ? /(?:^|\s)(?:min-h|h)-(\d+|\[(\d+)px\])(?=\s|$)/g : /(?:^|\s)(?:min-w|w)-(\d+|\[(\d+)px\])(?=\s|$)/g;
  let px = 0;
  for (const m of cls.matchAll(re)) px = m[2] ? Number(m[2]) : Number(m[1]) * 4;
  return px;
};

let container: HTMLDivElement;
let root: Root;
const onComplete = vi.fn(async () => true);
const onEdit = vi.fn();
const onAdd = vi.fn(async (_title: string) => true);

const render = (rhythms: Rhythms = ROWS) =>
  act(() => {
    root.render(<DeckRhythms rhythms={rhythms} onComplete={onComplete} onEdit={onEdit} onAdd={onAdd} />);
  });
const btn = (re: RegExp) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
    re.test(b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()),
  );
const click = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onComplete.mockClear();
  onEdit.mockClear();
  onAdd.mockClear();
  onAdd.mockImplementation(async () => true);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DeckRhythms · edit entry, cadence words, add row", () => {
  it("every row has an edit entry at 44 px, and the list ends in an add row at 44 px", () => {
    render();
    const edits = btn(/^Edit /);
    expect(edits.length, "one edit entry per rhythm row (the scanner located all three)").toBe(3);
    for (const el of edits) {
      expect(floor(el.className, "h"), `edit entry "${el.getAttribute("aria-label")}" height`).toBeGreaterThanOrEqual(44);
    }
    const add = btn(/\+ rhythm/);
    expect(add.length, "the add row rendered").toBe(1);
    expect(floor(add[0].className, "h")).toBeGreaterThanOrEqual(44);
    // The tick keeps its own 44 x 44 target.
    const ticks = btn(/^(Mark .* done|.*, done today)$/);
    expect(ticks.length).toBe(3);
    for (const el of ticks) {
      expect(floor(el.className, "h")).toBeGreaterThanOrEqual(44);
      expect(floor(el.className, "w")).toBeGreaterThanOrEqual(44);
    }
  });

  it("tapping a row's title calls onEdit with THAT task id", () => {
    render();
    click(btn(/^Edit Weigh in$/)[0]);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("w1");
  });

  it("the cadence reads from loopKind + recurringDays: daily, weekly with weekdays, weekly with none known", () => {
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("daily");
    expect(text).toContain("weekly · Mon Wed Fri");
    const plan = btn(/^Edit Plan the week$/)[0].textContent ?? "";
    expect(plan).toContain("weekly");
    expect(plan, "no weekdays on file is not rendered as a made-up day list").not.toMatch(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/);
  });

  it("the tick is unchanged: it calls onComplete(id, loopKind) and the row says done", async () => {
    render();
    await act(async () => {
      btn(/^Mark 10 breaths in bed done$/)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onComplete).toHaveBeenCalledWith("d1", "DAILY");
    expect(onEdit, "ticking never opens the editor").not.toHaveBeenCalled();
    expect(container.textContent).toContain("done");
  });

  it("the add row opens an input, and submitting calls onAdd with the trimmed title, then closes", async () => {
    render();
    click(btn(/\+ rhythm/)[0]);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="new rhythm title"]');
    expect(input, "the inline title input opened").toBeTruthy();
    expect(floor(input!.className, "h")).toBeGreaterThanOrEqual(44);
    type(input!, "  Stretch  ");
    const form = input!.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("Stretch");
    expect(container.querySelector('input[aria-label="new rhythm title"]'), "closed after a confirmed write").toBeNull();
  });

  it("a failed add keeps the typed title so it can be retried, and an empty title never calls onAdd", async () => {
    onAdd.mockImplementation(async () => false);
    render();
    click(btn(/\+ rhythm/)[0]);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="new rhythm title"]')!;
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onAdd, "blank input is not a rhythm").not.toHaveBeenCalled();
    type(input, "Stretch");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    const still = container.querySelector<HTMLInputElement>('input[aria-label="new rhythm title"]');
    expect(still, "the input stays open after a failed write").toBeTruthy();
    expect(still!.value).toBe("Stretch");
  });

  // Nour 2026-11-01, a Sunday: weekly Mon / Mon Wed Fri rhythms sat in today's list and in "2 of 7 today".
  it("rhythms not due today sit under 'not due today' and never count in 'N of M today'", () => {
    render([
      { id: "d1", title: "Stretch", loopKind: "DAILY", dueToday: true, doneToday: true, windowDone: 3, windowOf: 7 },
      { id: "w1", title: "Monday task", loopKind: "WEEKLY", recurringDays: [1], dueToday: false, doneToday: false, windowDone: 0, windowOf: 7 },
      { id: "w2", title: "Work out 3x", loopKind: "WEEKLY", recurringDays: [1, 3, 5], dueToday: false, doneToday: false, windowDone: 1, windowOf: 7 },
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("1 of 1 today");
    const week = container.querySelector('[aria-label="Rhythms not due today"]');
    expect(week, "a separate group for rhythms not due today").toBeTruthy();
    expect(week!.textContent).toContain("Monday task");
    expect(week!.textContent).toContain("Work out 3x");
    expect(week!.textContent).not.toContain("Stretch");
  });

  it("a weekly ticked today stays in today's list even when today is not one of its days", () => {
    render([{ id: "w1", title: "Monday task", loopKind: "WEEKLY", recurringDays: [1], dueToday: false, doneToday: true, windowDone: 1, windowOf: 7 }]);
    expect(container.textContent).toContain("1 of 1 today");
    expect(container.querySelector('[aria-label="Rhythms not due today"]')).toBeNull();
  });

  it("when nothing is due today, there is no 'N of M today' and the add row stays", () => {
    render([{ id: "w1", title: "Monday task", loopKind: "WEEKLY", recurringDays: [1], dueToday: false, doneToday: false, windowDone: 0, windowOf: 7 }]);
    expect(container.textContent).not.toMatch(/of \d+ today/);
    expect(container.querySelector('[aria-label="Rhythms not due today"]')?.textContent).toContain("Monday task");
    expect(btn(/\+ rhythm/).length).toBe(1);
  });
  it("deleting the last rhythm must not remove the way to add one: an empty list still renders the add row", () => {
    render([]);
    expect(btn(/\+ rhythm/).length).toBe(1);
    expect(btn(/^Edit /).length).toBe(0);
  });
});
