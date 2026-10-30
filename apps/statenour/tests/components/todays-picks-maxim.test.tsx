/**
 * The picks card shows the pick's maxim when opened (people W3, 2026-10-30).
 *
 * The API attaches `maxim` to each pick; this pins the reader so the field is
 * not a writer with no consumer. Collapsed stays one line (no maxim there).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/utils/api-fetch", () => ({
  rawFetch: vi.fn(async () => ({
    picks: [
      {
        personId: "p1",
        personName: "Person One",
        rationale: "ledger -3 last 30d",
        draft: "hey",
        maxim: { text: "Make choices from your own clear thinking, not from what others think.", source: "Gracián" },
      },
    ],
    generatedAt: "2026-10-30T16:00:00Z",
  })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodaysPicks } from "@/components/relationships/todays-picks";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<TodaysPicks />);
  });
  await act(async () => {});
  return host;
}

describe("TodaysPicks maxim", () => {
  it("collapsed: one line, no maxim; opened: the maxim and its source", async () => {
    const el = await mount();
    expect(el.textContent).toContain("Person One");
    expect(el.textContent).not.toContain("own clear thinking");

    await act(async () => {
      el.querySelector("button")!.click();
    });
    expect(el.textContent).toContain("Make choices from your own clear thinking");
    expect(el.textContent).toContain("Gracián");
  });
});
