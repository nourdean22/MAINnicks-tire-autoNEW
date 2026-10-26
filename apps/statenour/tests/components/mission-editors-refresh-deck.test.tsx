// @vitest-environment jsdom
/**
 * Deleting a rhythm, or editing/removing a mission, from /missions must reach the deck rows. The rhythms,
 * lanes and next move are read from task.deck (staleTime 20 s, poll 45 s), so an editor that invalidates
 * only task.list / task.missions leaves the deleted rhythm standing on the deck for up to 45 s: the edit
 * entry works and the screen says it did not. This pins the consumer end: each editor write invalidates
 * task.deck.
 *
 * Positive control: the same editors already invalidated task.list / task.missions on these paths, and the
 * test asserts that too, so a mocked utils object that records nothing cannot pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  deck: vi.fn(async () => {}),
  list: vi.fn(async () => {}),
  missions: vi.fn(async () => {}),
  del: vi.fn(async (_i: unknown) => ({ success: true })),
  update: vi.fn(async (_i: unknown) => ({})),
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
        delete: { useMutation: mut(h.del) },
        leaveMission: { useMutation: mut() },
        decompose: { useMutation: mut() },
        createMission: { useMutation: mut() },
      },
      useUtils: () => ({
        task: {
          list: { invalidate: h.list },
          missions: { invalidate: h.missions },
          deck: { invalidate: h.deck },
        },
      }),
    },
  };
});

import { TaskEditSheet } from "@/components/missions/task-edit-sheet";
import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(h).forEach((f) => f.mockClear());
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const textBtns = (re: RegExp) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter((b) => re.test((b.textContent ?? "").trim()));
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const RHYTHM = { id: "t1", title: "10 breaths", status: "READY", missionId: "m1", loopKind: "DAILY" } as never;

describe("editors refresh the deck", () => {
  it("TaskEditSheet · deleting a rhythm invalidates task.deck (and still task.list)", async () => {
    act(() => {
      root.render(<TaskEditSheet open onClose={() => {}} task={RHYTHM} missions={[]} />);
    });
    await click(textBtns(/^Delete$/)[0]);
    await settle();
    // The confirm dialog's own Delete button is the last one on the page.
    const confirms = textBtns(/^Delete$/);
    expect(confirms.length, "the confirm dialog opened").toBeGreaterThanOrEqual(2);
    await click(confirms[confirms.length - 1]);
    await settle();
    expect(h.del).toHaveBeenCalledWith({ id: "t1" });
    expect(h.list).toHaveBeenCalled();
    expect(h.deck, "the deck still lists the deleted rhythm until it refetches").toHaveBeenCalled();
  });

  it("MissionEditDrawer · saving an edit invalidates task.deck (and still task.missions)", async () => {
    act(() => {
      root.render(
        <MissionEditDrawer
          open
          onClose={() => {}}
          missionId="m1"
          initial={{ title: "HEALTH", status: "ACTIVE", domain: null, description: null, deadline: null }}
        />,
      );
    });
    await click(textBtns(/^Save$/)[0]);
    await settle();
    expect(h.missions).toHaveBeenCalled();
    expect(h.deck, "lanes and the hero read the deck").toHaveBeenCalled();
  });

  it("MissionEditDrawer · deleting a mission invalidates task.deck (and still task.list)", async () => {
    act(() => {
      root.render(
        <MissionEditDrawer
          open
          onClose={() => {}}
          missionId="m1"
          initial={{ title: "HEALTH", status: "ACTIVE", domain: null, description: null, deadline: null }}
        />,
      );
    });
    await click(textBtns(/^Delete$/)[0]);
    await settle();
    const confirms = textBtns(/^Delete$/);
    expect(confirms.length, "the confirm dialog opened").toBeGreaterThanOrEqual(2);
    await click(confirms[confirms.length - 1]);
    await settle();
    expect(h.list).toHaveBeenCalled();
    expect(h.deck).toHaveBeenCalled();
  });

  it("the delete confirm says what delete does: the mission's tasks go with it, they do not become unattached", async () => {
    act(() => {
      root.render(
        <MissionEditDrawer
          open
          onClose={() => {}}
          missionId="m1"
          initial={{ title: "HEALTH", status: "ACTIVE", domain: null, description: null, deadline: null }}
        />,
      );
    });
    await click(textBtns(/^Delete$/)[0]);
    await settle();
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("become unattached");
    expect(body).toMatch(/tasks .* deleted with it/i);
  });
});
