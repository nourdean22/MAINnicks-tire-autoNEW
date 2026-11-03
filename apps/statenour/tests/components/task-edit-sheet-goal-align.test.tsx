// @vitest-environment jsdom
/**
 * Align a task to a goal from the task edit sheet (Sunsama S1, job
 * 2026-11-02-nour-os-interconnect W3). The write goes through the existing
 * trpc.task.update path as `fields.goalId`, keyed by the task id ONLY.
 *
 * GUARD canary: a goal whose title carries another task's id must never become
 * the write target; the payload `id` is the edited task's id, always.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  update: vi.fn(async (_i: unknown) => ({})),
  invalidate: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), promise: vi.fn() } }));
vi.mock("@/lib/trpc/client", () => {
  const mut = (fn?: (i: unknown) => Promise<unknown>) => () => ({
    mutateAsync: fn ?? (async () => ({})),
    mutate: () => {},
    isPending: false,
  });
  return {
    trpc: {
      task: {
        update: { useMutation: mut(h.update) },
        delete: { useMutation: mut() },
        leaveMission: { useMutation: mut() },
        decompose: { useMutation: mut() },
      },
      useUtils: () => ({
        task: { list: { invalidate: h.invalidate }, missions: { invalidate: h.invalidate }, deck: { invalidate: h.invalidate } },
      }),
    },
  };
});

import { TaskEditSheet } from "@/components/missions/task-edit-sheet";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.update.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const OTHER_TASK_ID = "task-victim-0001";
const TASK = { id: "task-edited-0001", title: "Book the long run", status: "READY", missionId: "m1", goalId: null } as never;
const GOALS = [
  { id: "g-run", title: "Run a half marathon" },
  { id: "g-trap", title: `Trap ${OTHER_TASK_ID}` },
];

const goalSelect = () => document.body.querySelector<HTMLSelectElement>('select[name="goal"]');
const save = async () => {
  const btn = [...document.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Save")!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const choose = (value: string) =>
  act(() => {
    const el = goalSelect()!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("TaskEditSheet · align to goal", () => {
  it("shows a goal picker with the active goals and a none option", () => {
    act(() => root.render(<TaskEditSheet open onClose={() => {}} task={TASK} missions={[]} goals={GOALS} />));
    const sel = goalSelect();
    expect(sel, "the goal picker renders").not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual(["", "g-run", "g-trap"]);
  });

  it("saving a picked goal writes fields.goalId through task.update", async () => {
    act(() => root.render(<TaskEditSheet open onClose={() => {}} task={TASK} missions={[]} goals={GOALS} />));
    choose("g-run");
    await save();
    expect(h.update).toHaveBeenCalledWith({ id: "task-edited-0001", fields: { goalId: "g-run" } });
  });

  it("GUARD: a task id inside a goal title is never the write target", async () => {
    act(() => root.render(<TaskEditSheet open onClose={() => {}} task={TASK} missions={[]} goals={GOALS} />));
    choose("g-trap");
    await save();
    expect(h.update).toHaveBeenCalledTimes(1);
    const arg = h.update.mock.calls[0][0] as { id: string; fields: { goalId?: string } };
    expect(arg.id).toBe("task-edited-0001");
    expect(arg.fields.goalId).toBe("g-trap");
    expect(JSON.stringify(arg)).not.toContain(OTHER_TASK_ID);
  });

  it("picking none on an aligned task clears it with an explicit null", async () => {
    const aligned = { ...(TASK as object), goalId: "g-run" } as never;
    act(() => root.render(<TaskEditSheet open onClose={() => {}} task={aligned} missions={[]} goals={GOALS} />));
    expect(goalSelect()!.value).toBe("g-run");
    choose("");
    await save();
    expect(h.update).toHaveBeenCalledWith({ id: "task-edited-0001", fields: { goalId: null } });
  });

  it("an untouched goal stays out of the payload", async () => {
    const aligned = { ...(TASK as object), goalId: "g-run" } as never;
    act(() => root.render(<TaskEditSheet open onClose={() => {}} task={aligned} missions={[]} goals={GOALS} />));
    const title = document.body.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(title, "Book the long run today");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await save();
    const arg = h.update.mock.calls[0][0] as { fields: Record<string, unknown> };
    expect(arg.fields).toEqual({ title: "Book the long run today" });
  });

  it("an aligned goal no longer active stays selectable, so opening the sheet never drops it", () => {
    const aligned = { ...(TASK as object), goalId: "g-gone" } as never;
    act(() => root.render(<TaskEditSheet open onClose={() => {}} task={aligned} missions={[]} goals={GOALS} />));
    expect(goalSelect()!.value).toBe("g-gone");
  });
});
