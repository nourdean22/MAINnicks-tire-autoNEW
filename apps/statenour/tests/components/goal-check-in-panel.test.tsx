// @vitest-environment jsdom
/**
 * GoalCheckInPanel flow (job 2026-11-02-nour-os-interconnect W2, Linear L4): "Check in" asks Nick for a
 * draft, Nour edits it in the DOM, Save goes through task.goalCheckIn with THIS goal's id. A draft that
 * comes back unavailable leaves the manual field, and nothing is saved until he picks a health and writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ draft: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: {
      goalSinceCheckIn: {
        useQuery: () => ({ data: { found: true, since: null, total: 0, items: [], failed: [] }, isError: false, refetch: async () => {} }),
      },
      draftGoalCheckIn: { useMutation: () => ({ mutateAsync: h.draft, isPending: false }) },
      goalCheckIn: { useMutation: () => ({ mutateAsync: h.save, isPending: false }) },
    },
  },
}));
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: vi.fn() }));

import { GoalCheckInPanel } from "@/components/goals/goal-check-in";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;
const setText = (el: HTMLTextAreaElement | HTMLInputElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  h.draft.mockReset();
  h.save.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("GoalCheckInPanel", () => {
  it("fills the form from Nick's draft and saves it against this goal's id, whatever the note says", async () => {
    h.draft.mockResolvedValue({ unavailable: false, health: "at_risk", note: "moved goal_B, see goal_B", valueSuggestion: 5200, items: 3, failed: [] });
    h.save.mockResolvedValue({ logged: true });
    const onSaved = vi.fn();
    act(() => root.render(<GoalCheckInPanel goal={{ id: "goal_A", kind: "metric", unit: "$" }} onSaved={onSaved} />));
    await act(async () => button("Check in").click());
    await flush();
    expect(host.textContent).toContain("Drafted by Nick, edit before saving");
    expect((host.querySelector('[aria-label="Check-in note"]') as HTMLTextAreaElement).value).toBe("moved goal_B, see goal_B");
    await act(async () => button("Save check-in").click());
    await flush();
    expect(h.save).toHaveBeenCalledWith({ goalId: "goal_A", health: "at_risk", note: "moved goal_B, see goal_B", value: 5200 });
    expect(onSaved).toHaveBeenCalled();
  });

  it("an unavailable draft leaves an empty manual form that cannot save blank", async () => {
    h.draft.mockResolvedValue({ unavailable: true, reason: "Nick couldn't draft it right now", failed: [] });
    act(() => root.render(<GoalCheckInPanel goal={{ id: "goal_A", kind: "metric", unit: "$" }} onSaved={() => {}} />));
    await act(async () => button("Check in").click());
    await flush();
    expect(host.textContent).toContain("No draft: Nick couldn't draft it right now");
    const save = button("Save check-in");
    expect(save.disabled).toBe(true);
    await act(async () => save.click());
    expect(h.save).not.toHaveBeenCalled();
    // he writes it himself
    await act(async () => button("On track").click());
    await act(async () => setText(host.querySelector('[aria-label="Check-in note"]') as HTMLTextAreaElement, "steady week"));
    await act(async () => button("Save check-in").click());
    await flush();
    expect(h.save).toHaveBeenCalledWith({ goalId: "goal_A", health: "on_track", note: "steady week" });
  });

  it("after a save, a reopened check-in with no draft starts empty, never yesterday's words (second reader P2-1)", async () => {
    h.draft.mockResolvedValueOnce({ unavailable: false, health: "off_track", note: "yesterday's words", valueSuggestion: 9, items: 2, failed: [] });
    h.save.mockResolvedValue({ logged: true });
    act(() => root.render(<GoalCheckInPanel goal={{ id: "goal_A", kind: "metric", unit: "$" }} onSaved={() => {}} />));
    await act(async () => button("Check in").click());
    await flush();
    await act(async () => button("Save check-in").click());
    await flush();
    h.draft.mockResolvedValueOnce({ unavailable: true, reason: "Nick couldn't draft it right now", failed: [] });
    await act(async () => button("Check in").click());
    await flush();
    expect((host.querySelector('[aria-label="Check-in note"]') as HTMLTextAreaElement).value).toBe("");
    expect((host.querySelector('[aria-label="Value now"]') as HTMLInputElement).value).toBe("");
    expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(button("Save check-in").disabled).toBe(true);
  });

  it("a not-logged answer (already checked in today) is shown, not swallowed", async () => {
    h.draft.mockResolvedValue({ unavailable: false, health: "on_track", note: "fine", items: 1, failed: [] });
    h.save.mockResolvedValue({ logged: false, duplicate: true, reason: "already checked in on this goal today" });
    act(() => root.render(<GoalCheckInPanel goal={{ id: "goal_A", kind: "milestone", unit: "" }} onSaved={() => {}} />));
    await act(async () => button("Check in").click());
    await flush();
    await act(async () => button("Save check-in").click());
    await flush();
    expect(host.textContent).toContain("Not saved: already checked in on this goal today");
  });
});
