// @vitest-environment jsdom
/**
 * W8a (audit A top-2): the goal card's "Next:" and the hero's move link to /missions?goalId=&taskId=, and nothing
 * read taskId. useOpenTaskFromUrl opens that task's sheet once the tasks land, once per id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ params: new URLSearchParams(""), open: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => h.params }));
vi.mock("@/lib/trpc/client", () => ({ trpc: {} }));

import { useOpenTaskFromUrl } from "@/app/(mastery)/missions/hooks/use-missions-data";
import type { Task } from "@/components/actions/shared";

const task = (id: string) => ({ id, title: id, status: "READY", missionId: "m1" }) as unknown as Task;

function Probe({ tasks }: { tasks: Task[] }) {
  useOpenTaskFromUrl(tasks, h.open);
  return null;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  h.open.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useOpenTaskFromUrl", () => {
  it("opens the task named in ?taskId= once it is in the list, and only once", () => {
    h.params = new URLSearchParams("goalId=g1&taskId=t2");
    act(() => root.render(<Probe tasks={[]} />));
    expect(h.open).not.toHaveBeenCalled();
    act(() => root.render(<Probe tasks={[task("t1"), task("t2")]} />));
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.open.mock.calls[0][0].id).toBe("t2");
    act(() => root.render(<Probe tasks={[task("t1"), task("t2"), task("t3")]} />));
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it("an unknown id opens nothing", () => {
    h.params = new URLSearchParams("taskId=nope");
    act(() => root.render(<Probe tasks={[task("t1")]} />));
    expect(h.open).not.toHaveBeenCalled();
  });

  it("no taskId means no sheet", () => {
    h.params = new URLSearchParams("goalId=g1");
    act(() => root.render(<Probe tasks={[task("t1")]} />));
    expect(h.open).not.toHaveBeenCalled();
  });
});
