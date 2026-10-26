// @vitest-environment jsdom
/**
 * The page-side of "add a rhythm" and "edit a mission from a lane" (Nour 2026-10-26). The consumer end:
 * handleAddRhythm must reach trpc.task.create with loopKind DAILY, no missionId (the server files a
 * mission-less task in the Inbox, the same as quick-add), and the deck must be invalidated afterwards, since
 * the rhythms list is read from task.deck, not task.list. A mission that is not in the loaded list must say
 * so instead of silently doing nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  create: vi.fn(async (_input: Record<string, unknown>): Promise<unknown> => ({ id: "new1" })),
  deckInvalidate: vi.fn(async () => {}),
  listInvalidate: vi.fn(async () => {}),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, message: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/telemetry/mission-surface", () => ({ useMissionSurfaceTelemetry: () => ({ event: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => {
  const ns = () =>
    new Proxy(
      {},
      {
        get: (_t, key) => ({
          useMutation: () => ({
            mutateAsync: key === "create" ? h.create : vi.fn(async () => ({})),
            mutate: vi.fn(),
          }),
        }),
      },
    );
  const inv = (fn: () => Promise<void>) => ({ invalidate: fn });
  return {
    trpc: {
      task: ns(),
      operator: ns(),
      useUtils: () => ({
        task: { list: inv(h.listInvalidate), missions: inv(async () => {}), deck: inv(h.deckInvalidate) },
        operator: { commandCenterState: inv(async () => {}) },
      }),
    },
  };
});

import { useMissionActions } from "@/app/(mastery)/missions/hooks/use-mission-actions";
import { useMissionUIStore } from "@/app/(mastery)/missions/state/use-mission-ui-store";

type Actions = ReturnType<typeof useMissionActions>;
const handle: { current: Actions | null } = { current: null };
// Read through a getter so a stale capture cannot be called by mistake.
const actions = new Proxy({} as Actions, { get: (_t, key) => (handle.current as Actions)[key as keyof Actions] });
function Harness() {
  const a = useMissionActions({
    tasks: [],
    missions: [
      { id: "m1", title: "HEALTH", status: "ACTIVE" } as never,
      { id: "m-anchor", title: "GENERAL PERSONAL & HOME", status: "ACTIVE", systemKind: "GENERAL" } as never,
    ],
  });
  React.useEffect(() => {
    handle.current = a;
  });
  return <>{a.outcomeDialog}</>;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(h).forEach((f) => f.mockClear());
  h.create.mockImplementation(async () => ({ id: "new1" }));
  act(() => {
    root.render(<Harness />);
  });
});
afterEach(() => {
  // A failed assertion must not leave the drawer open for the next test.
  useMissionUIStore.getState().closeMissionEdit();
  act(() => root.unmount());
  container.remove();
});

describe("handleAddRhythm", () => {
  it("creates a DAILY, mission-less, READY task from the trimmed title and refreshes the deck", async () => {
    let ok: boolean | undefined;
    await act(async () => {
      ok = await actions.handleAddRhythm("  Stretch  ");
    });
    expect(ok).toBe(true);
    expect(h.create).toHaveBeenCalledTimes(1);
    const sent = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ title: "Stretch", loopKind: "DAILY", missionId: null, status: "READY" });
    expect(String(sent.originSource)).toMatch(/^missions-page:/);
    expect(h.deckInvalidate, "the rhythms list is read from task.deck").toHaveBeenCalled();
  });

  it("a failed write returns false, says so, and does not claim success", async () => {
    h.create.mockImplementation(async () => {
      throw new Error("boom");
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await actions.handleAddRhythm("Stretch");
    });
    expect(ok).toBe(false);
    expect(h.toastError).toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("handleEditMission", () => {
  it("opens the drawer for a mission in the loaded list", () => {
    act(() => actions.handleEditMission("m1"));
    expect(useMissionUIStore.getState().missionEditOpen).toBe(true);
    expect(useMissionUIStore.getState().missionEditId).toBe("m1");
    act(() => useMissionUIStore.getState().closeMissionEdit());
  });

  it("carries systemKind into the drawer so an anchor is recognised there; an ordinary project carries none", () => {
    act(() => actions.handleEditMission("m-anchor"));
    expect(useMissionUIStore.getState().missionEditInitial?.systemKind).toBe("GENERAL");
    act(() => useMissionUIStore.getState().closeMissionEdit());
    act(() => actions.handleEditMission("m1"));
    expect(useMissionUIStore.getState().missionEditInitial?.systemKind ?? null).toBeNull();
    act(() => useMissionUIStore.getState().closeMissionEdit());
  });

  it("a mission that is not in the loaded list says so instead of doing nothing", () => {
    act(() => actions.handleEditMission("ghost"));
    expect(useMissionUIStore.getState().missionEditOpen).toBe(false);
    expect(h.toastError).toHaveBeenCalledTimes(1);
  });
});
