// @vitest-environment jsdom
/**
 * W5 2026-11-02 (job nour-os-interconnect): the board as Nour meets it. The hero leads with the one goal,
 * each card shows its mission's milestone ladder, the open goal (else the hero goal) reaches the page for
 * Nick's side pane, "Ask Nick about this goal" prefills the pane, and the coach sandbox waits behind one tap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
  const base = {
    domain: "health",
    metric: "km",
    targetValue: 0,
    currentValue: 0,
    unit: "",
    progress: 0,
    status: "active",
    why: null,
    estimatedHours: null,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-30T12:00:00Z",
    linkedTaskCount: 2,
    linkedNextStepCount: 1,
    health: { state: "no_check_in", at: null, note: null },
  };
  const goals = [
    // No date: not the hero.
    { ...base, id: "g-life", title: "Write a book", horizon: "LIFE", deadline: null },
    // A deadline ahead: due soonest, the hero.
    {
      ...base,
      id: "g-run",
      title: "Run a 10k",
      horizon: null,
      deadline: "2099-01-01T00:00:00.000Z",
      nextMove: { id: "t-race", title: "Book the race", status: "READY" },
      missions: [
        {
          id: "m1",
          title: "Run a 10k",
          status: "ACTIVE",
          phaseCount: 2,
          tasksDone: 1,
          tasksTotal: 2,
          phases: [
            { name: "Base miles", done: true, current: false },
            { name: "Race week", done: false, current: true },
          ],
        },
      ],
    },
  ];
  return { goals, fetchGoals: vi.fn(async () => ({ goals })) };
});

vi.mock("@/lib/trpc/client", () => {
  const idle = () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false });
  return {
    trpc: {
      useUtils: () => ({ task: { goals: { invalidate: async () => {}, fetch: h.fetchGoals } } }),
      task: {
        goalsCreate: { useMutation: idle },
        goalsUpdate: { useMutation: idle },
        create: { useMutation: idle },
        goalSinceCheckIn: {
          useQuery: () => ({
            data: { found: true, since: "2026-10-01T12:00:00.000Z", total: 1, items: [{ at: new Date(Date.now() - 2.5 * 86_400_000).toISOString(), kind: "task", title: "x" }], failed: [] },
            isError: false,
            refetch: async () => {},
          }),
        },
        draftGoalCheckIn: { useMutation: idle },
        goalCheckIn: { useMutation: idle },
      },
      ai: { suggestGoals: { useMutation: idle } },
    },
  };
});
vi.mock("@/components/goals/execution-coach-sandbox", () => ({ ExecutionCoachSandbox: () => <p>SANDBOX</p> }));
vi.mock("@/components/actions/milestones-flow", () => ({ MilestonesFlow: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GoalBoard } from "@/components/goals/goal-board";

let container: HTMLDivElement;
let root: Root;
const onFocusGoal = vi.fn();

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const buttons = (re: RegExp) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) => re.test((b.textContent ?? "").trim()));
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(async () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Element.prototype.scrollIntoView = vi.fn();
  onFocusGoal.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<GoalBoard onFocusGoal={onFocusGoal} />));
  await flush();
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("GoalBoard · W5 hero, ladder and focus", () => {
  it("the hero leads with the goal due soonest, its one move and whether it moved", () => {
    const hero = container.querySelector('section[aria-label="Today\'s goal"]');
    expect(hero, "the hero rendered").toBeTruthy();
    expect(hero!.textContent).toContain("Run a 10k");
    expect(hero!.textContent).toContain("Next: Book the race");
    expect(hero!.textContent).toContain("Moved 2d ago");
    expect(hero!.textContent).toContain("2 goals");
    // The hero sits above the first card.
    const firstCard = container.querySelector('[id^="goal-"]')!;
    expect(hero!.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a card with a planned mission shows its milestone ladder; one without shows none", () => {
    const run = container.querySelector("#goal-g-run")!;
    expect(run.textContent).toContain("✓ Base miles");
    expect(run.textContent).toContain("now: Race week");
    expect(container.querySelector("#goal-g-life")!.textContent).not.toContain("Milestones");
  });

  it("the page hears the hero goal, then the card Nour opens", async () => {
    expect(onFocusGoal).toHaveBeenLastCalledWith({ id: "g-run", title: "Run a 10k" });
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(onFocusGoal).toHaveBeenLastCalledWith({ id: "g-life", title: "Write a book" });
  });

  it("the open card offers Ask Nick (prefill, never sent) and keeps the sandbox behind Focus session", async () => {
    const events: CustomEvent[] = [];
    const listen = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("statenour:open-nick", listen);
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(container.textContent, "the coachLog panel is gone").not.toMatch(/Show legacy details|Nick's read/);
    expect(container.textContent).not.toContain("SANDBOX");
    const ask = buttons(/^Ask Nick about this goal$/).find((b) => container.querySelector("#goal-g-life")!.contains(b))!;
    await click(ask);
    expect(events.at(-1)?.detail).toMatchObject({ submitOnMount: false });
    expect(events.at(-1)?.detail.pendingPrompt).toContain("[id:g-life]");
    await click(buttons(/^Focus session$/)[0]);
    expect(container.textContent).toContain("SANDBOX");
    window.removeEventListener("statenour:open-nick", listen);
  });

  it("the expanded card shows the maxim for its moment (no check-in yet: a timing maxim)", async () => {
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(container.querySelector("#goal-g-life blockquote")?.textContent?.length ?? 0).toBeGreaterThan(10);
  });
});
