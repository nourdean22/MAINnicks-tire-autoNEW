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
  toastSuccess: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: () => {} } }));

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
  claim_source: "ai_detected",
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
  h.toastSuccess.mockReset();
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

const click = async (label: string) => {
  await act(async () => {
    button(label)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("ContradictionResolutionPanel · table rows", () => {
  it("shows the claim, the record and the three answers; an AI-inferred claim is labelled inferred", () => {
    h.query.data = { contradictions: [TABLE_ROW] };
    const text = render().textContent ?? "";
    expect(text).toContain("I meal prep every Sunday");
    expect(text).toContain("The kitchen log shows no prep");
    expect(text).toContain("Inferred claim");
    expect(text).not.toContain("You said");
    expect(text).toContain("Record shows");
    expect(button("Record is right")).toBeDefined();
    expect(button("Outdated")).toBeDefined();
    expect(button("Ignore")).toBeDefined();
    // The memory-row verbs make no sense on a claim-vs-record row.
    expect(button("Current wins")).toBeUndefined();
  });

  it("CONTROL · a claim from his own chat is labelled You said", () => {
    h.query.data = { contradictions: [{ ...TABLE_ROW, claim_source: "chat" }] };
    expect(render().textContent).toContain("You said");
  });

  it.each([
    ["Record is right", "current_wins"],
    ["Outdated", "old_wins"],
    ["Ignore", "dismissed"],
  ])("%s arms an in-DOM confirm first, then resolves the tbl key as %s", async (label, status) => {
    h.query.data = { contradictions: [TABLE_ROW] };
    render();
    await click(label);
    expect(h.mutateAsync, "first tap must only arm the confirm").not.toHaveBeenCalled();
    await click("confirm");
    expect(h.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.mutateAsync.mock.calls[0][0]).toMatchObject({ key: "tbl:ck_1", status });
  });

  it("after a race, the toast reports the STORED answer, not the one tapped", async () => {
    h.query.data = { contradictions: [TABLE_ROW] };
    h.mutateAsync.mockResolvedValue({ contradiction: { ...TABLE_ROW, status: "dismissed" }, alreadyResolved: true });
    render();
    await click("Outdated");
    await click("confirm");
    const msg = String(h.toastSuccess.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/already closed/i);
    expect(msg).toMatch(/ignore/i);
    expect(msg).not.toMatch(/outdated/i);
  });

  it("answering a row the 30-day expiry closed: the toast says expired, never ignore", async () => {
    h.query.data = { contradictions: [TABLE_ROW] };
    h.mutateAsync.mockResolvedValue({ contradiction: { ...TABLE_ROW, status: "expired" }, alreadyResolved: true });
    render();
    await click("Outdated");
    await click("confirm");
    const msg = String(h.toastSuccess.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/expired/i);
    expect(msg).not.toMatch(/ignore/i);
  });

  it("History shows Nour's answers and the auto-expiry apart", async () => {
    h.query.data = {
      contradictions: [
        { ...TABLE_ROW, key: "tbl:a", status: "old_wins", resolved_at: "2026-10-21T00:00:00.000Z" },
        { ...TABLE_ROW, key: "tbl:b", status: "expired", resolution_note: "Auto-resolved after 30 days without action" },
      ],
    };
    render();
    await click("history");
    const rowA = container.querySelector("#contradiction-row-tbl\\:a")?.textContent ?? "";
    const rowB = container.querySelector("#contradiction-row-tbl\\:b")?.textContent ?? "";
    expect(rowA).toContain("outdated");
    expect(rowB).toContain("expired");
    expect(rowB).not.toContain("ignore");
  });

  it("the first tap moves focus into the confirm step (VoiceOver / keyboard)", async () => {
    h.query.data = { contradictions: [TABLE_ROW] };
    render();
    await click("Outdated");
    const confirmBtn = button("confirm");
    expect(confirmBtn).toBeDefined();
    expect(document.activeElement).toBe(confirmBtn);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/close as/i);
  });

  it("the footer names the thinking engine and carries no memory-row mechanics (that path is gone)", () => {
    h.query.data = { contradictions: [TABLE_ROW] };
    const text = render().textContent ?? "";
    expect(text).toMatch(/nightly thinking engine/i);
    expect(text).not.toMatch(/memory rows|current wins|deprecated/i);
  });

  it("a capped page says so: showing N of M", () => {
    h.query.data = { contradictions: [TABLE_ROW], table: { total: 80, shown: 1 } };
    expect(render().textContent).toContain("showing 1 of 80");
  });

  it("CONTROL · an uncapped page shows no truncation line", () => {
    h.query.data = { contradictions: [TABLE_ROW], table: { total: 1, shown: 1 } };
    expect(render().textContent).not.toMatch(/showing \d+ of \d+/);
  });

  it("a failed read says state unknown, never a clean ledger", () => {
    h.query = { ...h.query, isError: true, error: new Error("boom") };
    const text = render().textContent ?? "";
    expect(text).toContain("could not be read");
    expect(text).not.toContain("Clean ledger");
  });
});
