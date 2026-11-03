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
    skippedMaximIds: [] as string[] | null,
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
  const fetchGoals = vi.fn(async () => ({ goals: goals as typeof goals }));
  // One utils object for the whole run, as the real hook gives (a new object per render re-fires load()).
  const utils = { task: { goals: { invalidate: async () => {}, fetch: fetchGoals } } };
  return { goals, fetchGoals, utils };
});

vi.mock("@/lib/trpc/client", () => {
  const idle = () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false });
  return {
    trpc: {
      useUtils: () => h.utils,
      task: {
        goalsCreate: { useMutation: idle },
        goalsUpdate: { useMutation: idle },
        create: { useMutation: idle },
        goalSinceCheckIn: {
          useQuery: () => ({
            data: { found: true, since: "2026-10-01T12:00:00.000Z", total: 1, items: [{ at: new Date(Date.now() - 2 * 86_400_000).toISOString(), kind: "task", title: "x" }], failed: [] },
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
// W8a: the board reads ?goalId= / ?checkin= (Home deep link); outside Next the router context is absent.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GoalBoard } from "@/components/goals/goal-board";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";

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
    expect(onFocusGoal).toHaveBeenLastCalledWith(expect.objectContaining({ id: "g-run", title: "Run a 10k" }));
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(onFocusGoal).toHaveBeenLastCalledWith(expect.objectContaining({ id: "g-life", title: "Write a book" }));
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

  it("the expanded card shows the maxim for its moment (no check-in yet: a focus maxim)", async () => {
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(container.querySelector("#goal-g-life blockquote")?.textContent?.length ?? 0).toBeGreaterThan(10);
  });
});

describe("GoalBoard · W5 board behaviour from the silent-failure read (2026-11-03)", () => {
  it("leaving the Goals tab clears Nick's open goal", () => {
    expect(onFocusGoal).toHaveBeenLastCalledWith(expect.objectContaining({ id: "g-run" }));
    act(() => root.unmount());
    expect(onFocusGoal).toHaveBeenLastCalledWith(null);
    root = createRoot(container);
  });

  it("the page hears whether the goal was opened or is only today's hero", async () => {
    expect(onFocusGoal).toHaveBeenLastCalledWith({ id: "g-run", title: "Run a 10k", opened: false });
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(onFocusGoal).toHaveBeenLastCalledWith({ id: "g-life", title: "Write a book", opened: true });
  });

  it("coming back to the app (tab visible again) reloads the goals, so an overnight deadline is read fresh", async () => {
    const before = h.fetchGoals.mock.calls.length;
    await flush();
    expect(h.fetchGoals.mock.calls.length, "no read without a trigger (stable control)").toBe(before);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(h.fetchGoals.mock.calls.length, "hiding the app reads nothing").toBe(before);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    await flush();
    expect(h.fetchGoals.mock.calls.length).toBeGreaterThan(before);
  });

  it("an unread missions list shows 'Milestones couldn't load' on the card, not an empty ladder", async () => {
    act(() => root.unmount());
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals.map((g) => ({ ...g, missions: null })) }));
    root = createRoot(container);
    act(() => root.render(<GoalBoard onFocusGoal={onFocusGoal} />));
    await flush();
    await flush();
    expect(container.querySelector("#goal-g-run")!.textContent).toMatch(/Milestones couldn.t load/);
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals }));
  });

  it("the ladder follows the newest ACTIVE mission, not a newer finished one", async () => {
    act(() => root.unmount());
    const done = { id: "m0", title: "Old plan", status: "DONE", phaseCount: 1, tasksDone: 1, tasksTotal: 1, phases: [{ name: "Old phase", done: true, current: false }] };
    h.fetchGoals.mockImplementation(async () => ({
      goals: h.goals.map((g) => (g.id === "g-run" ? { ...g, missions: [done, ...(g.missions ?? [])] } : g)),
    }));
    root = createRoot(container);
    act(() => root.render(<GoalBoard onFocusGoal={onFocusGoal} />));
    await flush();
    await flush();
    const run = container.querySelector("#goal-g-run")!.textContent ?? "";
    expect(run).toContain("now: Race week");
    expect(run).not.toContain("Old phase");
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals }));
  });
});

describe("GoalBoard · W5 with no deadline on any goal (prod's shape on 2026-11-02: 3 goals, 0 deadlines)", () => {
  it("the hero still leads, says health picked it, and the pace line says why it is unscored", async () => {
    act(() => root.unmount());
    h.fetchGoals.mockImplementation(async () => ({
      goals: h.goals.map((g) => ({ ...g, deadline: null, horizon: null, nextMove: null, missions: [] })),
    }));
    root = createRoot(container);
    act(() => root.render(<GoalBoard onFocusGoal={onFocusGoal} />));
    await flush();
    await flush();
    const hero = container.querySelector(`section[aria-label="Today's goal"]`);
    expect(hero?.textContent).toContain("Needs you most: no check-in");
    expect(hero?.textContent).toContain("Write a book");
    expect(hero?.textContent).toContain("unscored: no deadline or horizon set");
    expect(hero?.textContent).toContain("No next step yet: add one");
    expect(container.textContent).not.toContain("Milestones");
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals }));
  });
});

describe("GoalBoard · W5 maxims Nour skipped on Home never show", () => {
  it("with every focus maxim but one skipped, the hero and the open card both show that one", async () => {
    const focus = MAXIM_POOL.filter((m) => m.tags.includes("focus"));
    const keep = focus[0]!;
    const skipped = focus.slice(1).map((m) => m.id);
    act(() => root.unmount());
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals.map((g) => ({ ...g, skippedMaximIds: skipped })) }));
    root = createRoot(container);
    act(() => root.render(<GoalBoard onFocusGoal={onFocusGoal} />));
    await flush();
    await flush();
    // Both goals have no check-in yet: the moment is check_in_due, the tag "focus".
    const heroQuote = container.querySelector(`section[aria-label="Today's goal"] blockquote`);
    expect(heroQuote?.textContent, "the hero shows the one focus maxim not skipped").toBe(keep.text);
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(container.querySelector("#goal-g-life blockquote")?.textContent).toBe(keep.text);
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals }));
  });
});

describe("GoalBoard · W5 maxim when the skip list could not be read", () => {
  it("a null skip list renders no maxim anywhere (never a skipped one)", async () => {
    act(() => root.unmount());
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals.map((g) => ({ ...g, skippedMaximIds: null })) }));
    root = createRoot(container);
    act(() => root.render(<GoalBoard onFocusGoal={onFocusGoal} />));
    await flush();
    await flush();
    expect(container.textContent, "the board loaded (positive control)").toContain("Run a 10k");
    await click(container.querySelector("#goal-g-life [role='button']")!);
    expect(container.querySelector("blockquote")).toBeNull();
    h.fetchGoals.mockImplementation(async () => ({ goals: h.goals }));
  });
});
