// @vitest-environment jsdom
/**
 * W8a round 2 (verification reader, P1-6 leftover): a failed weekly-completes read is loopsThisWeek null. The
 * "N this week" chip must hide on null (unknown), and still show a real 0. Round 1 put the null guard on the
 * done/total span instead, so the card kept saying "0 this week" on a failed read.
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
    linkedTaskCount: 3,
    linkedDoneCount: 1,
    linkedNextStepCount: 0,
    loopsThisWeek: null as number | null,
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
        // W2 2026-11-02 · the expanded card's check-in panel.
        goalSinceCheckIn: { useQuery: () => ({ data: undefined, isError: false, refetch: async () => {} }) },
        draftGoalCheckIn: { useMutation: idle },
        goalCheckIn: { useMutation: idle },
      },
      ai: { suggestGoals: { useMutation: idle }, coachGoal: { useMutation: idle } },
    },
  };
});
vi.mock("@/components/goals/execution-coach-sandbox", () => ({ ExecutionCoachSandbox: () => null }));
vi.mock("@/components/actions/milestones-flow", () => ({ MilestonesFlow: () => null }));
// W8a: the board reads ?goalId= / ?checkin= (Home deep link); outside Next the router context is absent.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GoalBoard } from "@/components/goals/goal-board";

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<GoalBoard />));
  await flush();
  await flush();
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("GoalBoard · the this-week chip on an unread weekly count", () => {
  it("loopsThisWeek null renders no \"0 this week\"; the done/total count still shows", async () => {
    h.goal.loopsThisWeek = null;
    await mount();
    expect(container.textContent, "the goal loaded (positive control)").toContain("Lose 20 lbs");
    expect(container.textContent).not.toMatch(/\d+ this week/);
    expect(container.textContent).toMatch(/1\/3 loops/);
  });

  it("a real zero still says 0 this week", async () => {
    h.goal.loopsThisWeek = 0;
    await mount();
    expect(container.textContent).toMatch(/0 this week/);
  });
});
