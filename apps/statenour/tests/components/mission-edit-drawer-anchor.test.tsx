// @vitest-environment jsdom
/**
 * A lane (a GENERAL anchor mission) now has an edit entry on /missions, so its drawer must not offer
 * Delete: deleting one soft-deletes every task in it, habits included. The server refuses the same call
 * (tests/services/mission-delete-cancels-execution.test.ts); the drawer says why instead of showing a
 * button that would fail.
 *
 * Positive control: an ordinary project's drawer still has Delete, so a drawer that never renders it
 * cannot pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: { createMission: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
    useUtils: () => ({
      task: {
        list: { invalidate: async () => {} },
        missions: { invalidate: async () => {} },
        deck: { invalidate: async () => {} },
      },
    }),
  },
}));

import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";

const initial = (systemKind: string | null) => ({
  title: "GENERAL PERSONAL & HOME",
  status: "ACTIVE",
  domain: null,
  description: null,
  deadline: null,
  systemKind,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (systemKind: string | null) =>
  act(() => {
    root.render(<MissionEditDrawer open onClose={() => {}} missionId="m1" initial={initial(systemKind)} />);
  });
const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>("button")];

describe("MissionEditDrawer · anchors cannot be deleted", () => {
  it("an anchor's drawer has no Delete button, says why, and keeps Save", () => {
    render("GENERAL");
    expect(buttons().filter((b) => (b.textContent ?? "").trim() === "Delete")).toHaveLength(0);
    expect(document.body.textContent).toMatch(/system lane/i);
    expect(document.body.textContent).toMatch(/cannot be deleted/i);
    expect(buttons().some((b) => (b.textContent ?? "").trim() === "Save")).toBe(true);
  });

  it("CONTROL: an ordinary project's drawer still offers Delete and no lane notice", () => {
    render(null);
    expect(buttons().filter((b) => (b.textContent ?? "").trim() === "Delete")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/system lane/i);
  });
});
