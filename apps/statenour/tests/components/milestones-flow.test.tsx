// @vitest-environment jsdom
/**
 * Plan it cannot lose work (W8a, audit A3/A4). The board hands MilestonesFlow a fresh goal object on every render:
 * the suggestions effect must key on the goal's id, or every render restarts it and wipes Nour's edits. A failed
 * plan call keeps the mission id, so the retry reuses it and never makes a second mission. The toast reports what
 * the server really spawned, and a milestone can be no longer than the server accepts.
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
  spawnTasks: vi.fn(async () => ({ spawned: 0 })),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: {
      createMission: { useMutation: () => ({ mutateAsync: h.createMission, isPending: false }) },
      // Only so the pre-W8a component can mount for the positive control; the fixed component has no client spawn.
      spawnTasks: { useMutation: () => ({ mutateAsync: h.spawnTasks, isPending: false }) },
    },
    ai: { planProject: { useMutation: () => ({ mutateAsync: h.planProject, isPending: false }) } },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: vi.fn() }));

import { MILESTONE_MAX, MilestonesFlow, planToast } from "@/components/actions/milestones-flow";

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const goal = () => ({ id: "g1", title: "Run a 10k", domain: "health", deadline: null });
const render = (g = goal()) => act(() => root.render(<MilestonesFlow goal={g} onCancel={() => {}} />));
const spinUp = () => [...container.querySelectorAll("button")].find((b) => /Spin up project/.test(b.textContent ?? ""))!;
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(() => {
  h.planProject.mockReset();
  h.createMission.mockReset().mockResolvedValue({ id: "m1" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.planProject.mockImplementation(async (input: { mode: string }) =>
    input.mode === "milestones"
      ? { mode: "milestones", milestones: [{ label: "Base miles", metric: null, estimatedDate: null }, { label: "Race week", metric: null, estimatedDate: null }], rationale: "" }
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

describe("MilestonesFlow", () => {
  it("asks for suggestions once per goal id, not once per render (A3)", async () => {
    await render();
    await flush();
    await render(goal()); // a new object, same id, as the board does on every render
    await render(goal());
    await flush();
    expect(h.planProject.mock.calls.filter((c) => c[0].mode === "milestones")).toHaveLength(1);
  });

  it("caps a milestone at the server's length", async () => {
    await render();
    await flush();
    const areas = container.querySelectorAll("textarea");
    expect(areas.length).toBe(2);
    for (const a of areas) expect(a.maxLength).toBe(MILESTONE_MAX);
  });

  it("a failed plan call keeps the mission: the retry plans again and never creates a second mission (A4)", async () => {
    await render();
    await flush();
    h.planProject.mockImplementationOnce(async () => {
      throw new Error("provider down");
    });
    click(spinUp());
    await flush();
    expect(h.createMission).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("the project is kept"));

    click(spinUp());
    await flush();
    expect(h.createMission).toHaveBeenCalledTimes(1);
    const plans = h.planProject.mock.calls.filter((c) => c[0].mode === "plan");
    expect(plans).toHaveLength(2);
    expect(plans.every((c) => c[0].missionId === "m1")).toBe(true);
  });

  it("the client never spawns: the server does, and the toast says what it made", async () => {
    await render();
    await flush();
    click(spinUp());
    await flush();
    expect(h.toastSuccess).toHaveBeenCalledWith(expect.stringContaining("2 starter tasks on NOW"));
    expect(h.spawnTasks).not.toHaveBeenCalled();
  });
});

describe("planToast says what the server did", () => {
  it("a failed spawn is named, never reported as spawned", () => {
    expect(planToast({ milestones: 3, skeleton: false, spawned: 0, spawnFailed: "no plan" })).toContain("could not be created");
    expect(planToast({ milestones: 3, skeleton: false, spawned: 0, spawnFailed: undefined })).toContain("no starter task was created");
    expect(planToast({ milestones: 3, skeleton: true, spawned: 3, spawnFailed: undefined })).toContain("3 starter tasks on NOW");
  });
});
