// @vitest-environment jsdom
/**
 * /brain Memory tab · the contradiction panel shows the thinking engine's
 * TABLE rows (2026-10-23) and closes them with the three plain answers: the
 * record is right, outdated, ignore. Each one calls the SAME resolve mutation
 * with the row's `tbl:` key. A failed read renders the ERROR notice, never the
 * green "Clean ledger". Fixtures are made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown, dataUpdatedAt: 0 },
  mutateAsync: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      contradictions: { useQuery: () => h.query },
      resolveContradiction: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false }) },
    },
    useUtils: () => ({ brain: { contradictions: { invalidate: async () => {} } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { ContradictionResolutionPanel } from "@/components/brain/contradiction-resolution-panel";

const TABLE_ROW = {
  key: "tbl:ck_1",
  source: "table",
  signal: "claim_gap",
  new_excerpt: "I meal prep every Sunday",
  old_excerpt: "The kitchen log shows no prep on the last three Sundays",
  gap: "Stated weekly, logged zero of three",
  category: "habit",
  severity: "moderate",
  recorded: "2026-10-19",
  days_apart: 3,
  surfaced_at: "2026-10-19T12:00:00.000Z",
  createdAt: "2026-10-19T12:00:00.000Z",
  status: "unresolved",
  resolution_note: null,
  resolved_at: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.query = { data: undefined, isLoading: false, isError: false, error: null, dataUpdatedAt: 0 };
  h.mutateAsync.mockReset().mockResolvedValue({ contradiction: { ...TABLE_ROW, status: "old_wins" } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => {
  act(() => {
    root.render(<ContradictionResolutionPanel />);
  });
  return container;
};
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("ContradictionResolutionPanel · table rows", () => {
  it("shows the claim, the record and the three answers", () => {
    h.query.data = { contradictions: [TABLE_ROW] };
    const text = render().textContent ?? "";
    expect(text).toContain("I meal prep every Sunday");
    expect(text).toContain("The kitchen log shows no prep");
    expect(text).toContain("You said");
    expect(text).toContain("Record shows");
    expect(button("Record is right")).toBeDefined();
    expect(button("Outdated")).toBeDefined();
    expect(button("Ignore")).toBeDefined();
    // The memory-row verbs make no sense on a claim-vs-record row.
    expect(button("Current wins")).toBeUndefined();
  });

  it.each([
    ["Record is right", "current_wins"],
    ["Outdated", "old_wins"],
    ["Ignore", "dismissed"],
  ])("%s resolves the tbl key as %s through the shared mutation", async (label, status) => {
    h.query.data = { contradictions: [TABLE_ROW] };
    render();
    await act(async () => {
      button(label)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.mutateAsync.mock.calls[0][0]).toMatchObject({ key: "tbl:ck_1", status });
  });

  it("a failed read says state unknown, never a clean ledger", () => {
    h.query = { ...h.query, isError: true, error: new Error("boom") };
    const text = render().textContent ?? "";
    expect(text).toContain("could not be read");
    expect(text).not.toContain("Clean ledger");
  });
});
