/**
 * components/brain/goal-people-memories.tsx (job 2026-11-02-nour-os-interconnect W6): the /brain memory tab filters
 * the brain by goal and by person. A failed read says it could not load (never "nothing in the brain"); a measured
 * empty says what would add a row.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown>, inputs: [] as unknown[] }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      goalPeopleMemories: {
        useQuery: (input: unknown) => {
          h.inputs.push(input);
          return h.q;
        },
      },
    },
  },
}));

import { GoalPeopleMemories } from "@/components/brain/goal-people-memories";

const ok = (data: Record<string, unknown>) => ({
  data,
  isError: false,
  isPending: false,
  isLoading: false,
  fetchStatus: "idle",
  refetch: () => Promise.resolve(),
});

let host: HTMLDivElement;
let root: Root;
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<GoalPeopleMemories />));
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  h.inputs = [];
});

describe("GoalPeopleMemories", () => {
  it("lists goal moments with their kind and offers the goals to narrow by", async () => {
    h.q = ok({
      rows: [{ id: "m1", category: "goal", content: 'Achieved "Save $15k"', at: "2026-11-02T15:00:00.000Z", kind: "achieved" }],
      options: [{ id: "g1", label: "Save $15k" }],
      needsPick: false,
      rowsTruncated: false,
      optionsTruncated: false,
    });
    await mount();
    expect(host.textContent).toContain('Achieved "Save $15k"');
    expect(host.querySelector("select")?.textContent).toContain("Save $15k");
    expect(h.inputs.at(-1)).toEqual({ by: "goal" });
  });

  it("a failed read says it could not load, never that the brain is empty", async () => {
    h.q = { data: undefined, isError: true, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
    await mount();
    expect(host.querySelector("[data-read-failed]")).not.toBeNull();
    expect(host.textContent).toContain("couldn't load");
    expect(host.textContent).not.toContain("No goal moments");
  });

  it("a measured empty says what adds a row", async () => {
    h.q = ok({ rows: [], options: [], needsPick: false });
    await mount();
    expect(host.textContent).toContain("No goal moments in the brain yet");
  });

  it("switching to a person asks for a pick, then reads by that person's id", async () => {
    h.q = ok({ rows: [], options: [{ id: "p1", label: "Sam" }], needsPick: true });
    await mount();
    const personTab = [...host.querySelectorAll("button")].find((b) => b.textContent === "About a person")!;
    await act(async () => personTab.click());
    expect(h.inputs.at(-1)).toEqual({ by: "person" });
    expect(host.textContent).toContain("Pick a person");
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "p1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(h.inputs.at(-1)).toEqual({ by: "person", id: "p1" });
  });

  it("a capped list says how many it shows, not that it is the whole brain", async () => {
    h.q = ok({
      rows: [{ id: "m1", category: "goal_moment", content: "moment", at: "2026-11-02T15:00:00.000Z", kind: "check_in" }],
      options: [{ id: "g1", label: "Save $15k" }],
      needsPick: false,
      rowsTruncated: true,
      optionsTruncated: true,
    });
    await mount();
    expect(host.textContent).toContain("Showing the newest 1");
    expect(host.textContent).toContain("Only the 1 most recent goals are listed");
  });

  it("with no people at all it says so instead of asking for a pick it cannot offer", async () => {
    h.q = ok({ rows: [], options: [], needsPick: true, rowsTruncated: false, optionsTruncated: false });
    await mount();
    const personTab = [...host.querySelectorAll("button")].find((b) => b.textContent === "About a person")!;
    await act(async () => personTab.click());
    expect(host.textContent).toContain("No people on /people yet");
    expect(host.textContent).not.toContain("Pick a person to see");
  });
});
