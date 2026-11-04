// @vitest-environment jsdom
/**
 * W8c item 5 · a mission that did not come from "Plan it" (13 of 13 in prod have no planData) gets phases and tasks
 * from its own card: "Plan from milestones" opens the same MilestonesFlow the goal card uses, pre-set to THIS
 * mission, so the server plans into it (trpc.ai.planProject mode "plan" with its id) and no second mission is ever
 * created. A mission WITH planData shows its milestone ladder read-only (components/goals/goal-ladder.tsx +
 * lib/stats/goals-page.ts missionPhaseLadder, the goal card's ladder).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  planProject: vi.fn(),
  createMission: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: { createMission: { useMutation: () => ({ mutateAsync: h.createMission, isPending: false }) } },
    ai: { planProject: { useMutation: () => ({ mutateAsync: h.planProject, isPending: false }) } },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/missions",
}));

import { MilestonesFlow } from "@/components/actions/milestones-flow";
import { MissionCard } from "@/components/missions/mission-card";
import { MissionDispatchProvider } from "@/app/(mastery)/missions/context/mission-dispatch-context";
import type { Project, Task } from "@/components/actions/shared";

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const button = (re: RegExp) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(() => {
  h.planProject.mockReset();
  h.createMission.mockReset().mockResolvedValue({ id: "m_new" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.planProject.mockImplementation(async (input: { mode: string }) =>
    input.mode === "milestones"
      ? { mode: "milestones", milestones: [{ label: "Order the lift", metric: null, estimatedDate: null }, { label: "Lift inspected", metric: null, estimatedDate: null }], rationale: "" }
      : { mode: "plan", plan: {}, flatSteps: [], spawned: 2 },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MilestonesFlow · into an existing mission", () => {
  it("never creates a mission; the plan call carries the given mission id", async () => {
    const onComplete = vi.fn();
    act(() =>
      root.render(<MilestonesFlow goal={{ id: "g1", title: "Bay two lift install" }} missionId="m1" onComplete={onComplete} onCancel={() => {}} />),
    );
    await flush();
    await click(button(/Spin up project/)!);
    await flush();
    expect(h.createMission).not.toHaveBeenCalled();
    const plan = h.planProject.mock.calls.find((c) => c[0].mode === "plan")![0];
    expect(plan.missionId).toBe("m1");
    expect(plan.milestones).toEqual(["Order the lift", "Lift inspected"]);
    expect(onComplete).toHaveBeenCalledWith("m1");
  });

  it("CONTROL: without a mission id it still creates one, under the goal", async () => {
    act(() => root.render(<MilestonesFlow goal={{ id: "g1", title: "Run a 10k" }} onCancel={() => {}} />));
    await flush();
    await click(button(/Spin up project/)!);
    await flush();
    expect(h.createMission).toHaveBeenCalledTimes(1);
    expect(h.createMission.mock.calls[0][0].lifeGoalId).toBe("g1");
  });
});

const mission = (over: Partial<Project> = {}): Project =>
  ({ id: "m1", title: "Bay two lift install", status: "ACTIVE", domain: "BUSINESS", lifeGoal: null, planData: null, ...over }) as Project;
const renderCard = (m: Project, tasks: Task[] = []) =>
  act(() =>
    root.render(
      <MissionDispatchProvider actions={{ handleEditMission: vi.fn() } as never}>
        <MissionCard mission={m} tasks={tasks} defaultExpanded />
      </MissionDispatchProvider>,
    ),
  );

describe("MissionCard · plan from milestones", () => {
  it("a mission with no plan offers Plan from milestones, and tapping it opens the flow pre-set to this mission", async () => {
    renderCard(mission({ lifeGoal: { id: "g1", title: "Grow the shop" } } as Partial<Project>));
    const plan = button(/Plan from milestones/);
    expect(plan).toBeDefined();
    expect(plan!.className).toContain("min-h-[44px]");
    await click(plan!);
    await flush();
    // The flow asks for milestones under the mission's own title, then plans into m1 on Spin up.
    expect(h.planProject.mock.calls[0][0]).toMatchObject({ mode: "milestones", title: "Bay two lift install" });
    await click(button(/Spin up project/)!);
    await flush();
    expect(h.createMission).not.toHaveBeenCalled();
    expect(h.planProject.mock.calls.find((c) => c[0].mode === "plan")![0].missionId).toBe("m1");
  });

  it("a mission WITH a plan shows its ladder read-only and no plan action", () => {
    const planData = { phases: [{ name: "Order" }, { name: "Install" }] };
    renderCard(mission({ planData } as Partial<Project>), [
      { id: "t1", status: "DONE", phaseName: "Order", missionId: "m1", title: "Order lift" } as Task,
      { id: "t2", status: "READY", phaseName: "Install", missionId: "m1", title: "Install lift" } as Task,
    ]);
    expect(container.textContent).toContain("Milestones · 1 of 2 done");
    expect(container.textContent).toContain("now: Install");
    expect(button(/Plan from milestones/)).toBeUndefined();
  });

  it("item 6 · a mission whose goal was deleted (listMissions maps it to null) shows no goal chip, only align to goal", () => {
    renderCard(mission({ lifeGoal: null } as Partial<Project>));
    expect(container.textContent).not.toContain("goal ·");
    expect(container.textContent).toContain("align to goal");
  });

  it("a system lane (GENERAL anchor) offers no plan action", () => {
    renderCard(mission({ systemKind: "GENERAL" } as Partial<Project>));
    expect(button(/Plan from milestones/)).toBeUndefined();
  });
});
