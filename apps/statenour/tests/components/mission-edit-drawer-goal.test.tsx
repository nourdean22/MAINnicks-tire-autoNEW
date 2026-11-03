// @vitest-environment jsdom
/**
 * W8c item 1-2 · an existing mission can be put under a goal from its edit drawer (0 of 13 prod missions carried
 * one and nothing could link them). The goal select lists the active goals and "No goal"; Save writes
 * fields.lifeGoalId through PATCH /api/missions/[id] (services/missions.updateMission, the service
 * trpc.task.missionUpdate also calls), keyed by the mission id. Above the select, "Suggested: <goal> · Use" links in
 * one tap; a failed suggestion read says "Couldn't suggest a goal", never "no suggestion".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  suggest: { data: undefined as unknown, isError: false, isLoading: false },
  suggestInput: [] as unknown[],
  invalidated: [] as string[],
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: {
      createMission: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) },
      suggestMissionGoal: {
        useQuery: (input: unknown, opts: { enabled?: boolean }) => {
          h.suggestInput.push({ input, enabled: opts?.enabled });
          return opts?.enabled === false ? { data: undefined, isError: false, isLoading: false } : h.suggest;
        },
      },
    },
    useUtils: () => ({
      task: {
        list: { invalidate: async () => void h.invalidated.push("list") },
        missions: { invalidate: async () => void h.invalidated.push("missions") },
        deck: { invalidate: async () => void h.invalidated.push("deck") },
        suggestMissionGoal: { invalidate: async () => void h.invalidated.push("suggest") },
      },
    }),
  },
}));

import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";

const GOALS = [
  { id: "g1", title: "Grow the shop" },
  { id: "g2", title: "Run a marathon" },
];
const initial = (goal: { id: string; title: string } | null = null) => ({
  title: "Bay two lift install",
  status: "ACTIVE",
  domain: "BUSINESS",
  completionCriteria: null,
  deadline: null,
  goal,
});

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.suggest = { data: undefined, isError: false, isLoading: false };
  h.suggestInput = [];
  h.invalidated = [];
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (props: Partial<React.ComponentProps<typeof MissionEditDrawer>> = {}) =>
  act(() => {
    root.render(<MissionEditDrawer open onClose={() => {}} missionId="m1" initial={initial()} goals={GOALS} {...props} />);
  });
const goalSelect = () => document.body.querySelector<HTMLSelectElement>('select[aria-label="goal"]');
const button = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === label);
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));

async function choose(value: string) {
  const sel = goalSelect()!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("MissionEditDrawer · goal select", () => {
  it("lists No goal plus every active goal, at the 16 px / 44 px floor", () => {
    render();
    const sel = goalSelect();
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.textContent)).toEqual(["No goal", "Grow the shop", "Run a marathon"]);
    expect(sel!.className).toContain("text-[16px]");
    expect(sel!.className).toContain("min-h-[44px]");
  });

  it("Save writes the chosen goal's id to the mission by id", async () => {
    render();
    await choose("g2");
    await act(async () => button("Save")!.click());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/missions/m1");
    expect(bodies()[0].lifeGoalId).toBe("g2");
  });

  it("choosing No goal unlinks (null), and the current goal is preselected", async () => {
    render({ initial: initial({ id: "g1", title: "Grow the shop" }) });
    expect(goalSelect()!.value).toBe("g1");
    await choose("");
    await act(async () => button("Save")!.click());
    expect(bodies()[0].lifeGoalId).toBeNull();
  });

  it("a current goal that is no longer active stays selectable, marked, and is saved unchanged", async () => {
    render({ initial: initial({ id: "g_old", title: "Old goal" }) });
    const opts = [...goalSelect()!.options].map((o) => o.textContent);
    expect(opts).toContain("Old goal (not active)");
    await act(async () => button("Save")!.click());
    expect(bodies()[0].lifeGoalId).toBe("g_old");
  });

  it("opened from the card's Align to goal, the goal select has focus", async () => {
    render({ focusField: "goal" });
    // The dialog primitive applies its initial focus after mount.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.activeElement).toBe(goalSelect());
  });

  it("the create drawer has no goal select and asks for no suggestion", () => {
    render({ missionId: null, initial: undefined });
    expect(goalSelect()).toBeNull();
    expect(h.suggestInput.every((c) => (c as { enabled: boolean }).enabled === false)).toBe(true);
  });
});

describe("MissionEditDrawer · suggested goal", () => {
  it("shows Suggested: <goal> · Use for an unlinked mission, and Use links it in one tap", async () => {
    h.suggest = { data: { goalId: "g1", title: "Grow the shop", score: 0.61, basis: "embedding" }, isError: false, isLoading: false };
    render();
    expect(document.body.textContent).toContain("Suggested: Grow the shop");
    await act(async () => button("Use")!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/missions/m1");
    expect(bodies()[0]).toEqual({ lifeGoalId: "g1" });
    expect(goalSelect()!.value).toBe("g1");
    expect(h.invalidated).toContain("missions");
  });

  it("labels a word-overlap suggestion as such", () => {
    h.suggest = { data: { goalId: "g1", title: "Grow the shop", score: 0.3, basis: "words" }, isError: false, isLoading: false };
    render();
    expect(document.body.textContent).toMatch(/shared words/i);
  });

  it("a failed suggestion read says Couldn't suggest a goal, never 'no suggestion'", () => {
    h.suggest = { data: undefined, isError: true, isLoading: false };
    render();
    expect(document.body.textContent).toContain("Couldn't suggest a goal");
  });

  it("a measured no-match says no goal matched closely; a linked mission asks for no suggestion", () => {
    h.suggest = { data: null, isError: false, isLoading: false };
    render();
    expect(document.body.textContent).toContain("No goal matched closely");
    act(() => root.unmount());
    root = createRoot(container);
    h.suggestInput = [];
    render({ initial: initial({ id: "g1", title: "Grow the shop" }) });
    expect(h.suggestInput.every((c) => (c as { enabled: boolean }).enabled === false)).toBe(true);
    expect(document.body.textContent).not.toContain("Suggested:");
  });
});
