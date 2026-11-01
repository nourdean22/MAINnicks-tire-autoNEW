// @vitest-environment jsdom
/**
 * Nour 2026-11-01 13:12Z: "https://bdnick.info/stats?tab=goals ... i cant edit the goals or do anything".
 * The edit form existed, but its only door was two taps deep and badly named: tap the card to expand it, then
 * "Show Legacy Details", then "Edit". Each card now carries its own Edit button, closed or open, at the 44 px floor,
 * and the form saves title, target, deadline. The Archive in that panel archived on one tap; it now asks first
 * (in-DOM confirm: window.confirm is silent in the iOS PWA).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
  const goal = {
    id: "g1",
    domain: "health",
    title: "Lose 20 lbs",
    metric: "lbs",
    targetValue: 0,
    currentValue: 0,
    unit: "lbs",
    progress: 0,
    status: "active",
    horizon: "YEAR",
    why: null,
    estimatedHours: null,
    coachLog: null,
    deadline: null,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-30T12:00:00Z",
    linkedTaskCount: 0,
    linkedNextStepCount: 0,
  };
  return {
    goal,
    update: vi.fn(async (_input: Record<string, unknown>) => ({})),
    fetchGoals: vi.fn(async () => ({ goals: [goal] })),
  };
});

vi.mock("@/lib/trpc/client", () => {
  const idle = () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false });
  return {
    trpc: {
      useUtils: () => ({ task: { goals: { invalidate: async () => {}, fetch: h.fetchGoals } } }),
      task: {
        goalsCreate: { useMutation: idle },
        goalsUpdate: { useMutation: () => ({ mutateAsync: h.update, isPending: false }) },
        create: { useMutation: idle },
      },
      ai: { suggestGoals: { useMutation: idle }, coachGoal: { useMutation: idle } },
    },
  };
});
vi.mock("@/components/goals/execution-coach-sandbox", () => ({ ExecutionCoachSandbox: () => null }));
vi.mock("@/components/actions/milestones-flow", () => ({ MilestonesFlow: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GoalBoard } from "@/components/goals/goal-board";

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const buttons = (re: RegExp) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
    re.test(b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()),
  );
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(async () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  h.update.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<GoalBoard />));
  await flush();
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("GoalBoard · edit a goal in place", () => {
  it("a closed card has its own Edit button at the 44 px floor", () => {
    expect(container.textContent, "the goal loaded (positive control)").toContain("Lose 20 lbs");
    const edit = buttons(/^Edit Lose 20 lbs$/);
    expect(edit.length, "one Edit door on the closed card").toBe(1);
    expect(edit[0].className).toMatch(/min-h-11/);
    expect(edit[0].className).toMatch(/min-w-11/);
  });

  it("Edit opens the form; title, target and deadline save in one write", async () => {
    await click(buttons(/^Edit Lose 20 lbs$/)[0]);
    const title = container.querySelector<HTMLInputElement>('input[aria-label="Goal title"]')!;
    const target = container.querySelector<HTMLInputElement>('input[aria-label="Target value"]')!;
    const deadline = container.querySelector<HTMLInputElement>('input[aria-label="Deadline"]')!;
    expect(title && target && deadline, "the form has labelled title, target and deadline fields").toBeTruthy();
    expect(title.className, "16 px: iOS zooms smaller inputs").toMatch(/text-\[16px\]/);
    type(title, "Lose 25 lbs");
    type(target, "25");
    type(deadline, "2027-03-01");
    await act(async () => {
      buttons(/^Save$/)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0]).toMatchObject({
      id: "g1",
      title: "Lose 25 lbs",
      targetValue: 25,
      deadline: "2027-03-01T23:59:59.000Z",
    });
  });

  it("the expanded panel's Archive asks first; nothing is written on one tap", async () => {
    await click(container.querySelector('[role="button"]')!); // expand the card
    await click(buttons(/^Show Legacy Details$/)[0]);
    await click(buttons(/^Archive$/)[0]);
    expect(h.update, "one tap must not archive").not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Archive "Lose 20 lbs"?');
  });

  const openArchiveConfirm = async () => {
    await click(container.querySelector('[role="button"]')!);
    await click(buttons(/^Show Legacy Details$/)[0]);
    await click(buttons(/^Archive$/)[0]);
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
    expect(dialog, "the in-DOM confirm opened").toBeTruthy();
    return [...dialog!.querySelectorAll("button")];
  };

  it("confirming archives exactly that goal", async () => {
    const yes = (await openArchiveConfirm()).find((b) => b.textContent?.trim() === "Archive")!;
    await act(async () => {
      yes.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(h.update).toHaveBeenCalledWith({ id: "g1", archive: true });
  });

  it("cancelling writes nothing", async () => {
    const no = (await openArchiveConfirm()).find((b) => b.textContent?.trim() === "Cancel")!;
    await act(async () => {
      no.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(h.update).not.toHaveBeenCalled();
  });
});
