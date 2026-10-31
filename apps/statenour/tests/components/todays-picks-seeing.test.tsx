/**
 * An opened pick says when he is about to see the person (people W4 S1,
 * 2026-10-30). A pick without a calendar match shows no such line (control).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ rawFetch: vi.fn() }));
vi.mock("@/lib/utils/api-fetch", () => ({ rawFetch: h.rawFetch }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodaysPicks } from "@/components/relationships/todays-picks";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

async function mountOpened(pick: Record<string, unknown>) {
  h.rawFetch.mockResolvedValue({ picks: [pick], generatedAt: "2026-10-30T16:00:00Z" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<TodaysPicks />);
  });
  await act(async () => {});
  await act(async () => {
    host!.querySelector("button")!.click();
  });
  return host;
}

describe("TodaysPicks calendar line", () => {
  it("an opened pick with a calendar match says when", async () => {
    const el = await mountOpened({ personId: "p1", personName: "Demo Person", rationale: "Demo reason", seeingOn: "tomorrow" });
    expect(el.textContent).toContain("On your calendar tomorrow");
  });

  it("CONTROL: no calendar match, no line", async () => {
    const el = await mountOpened({ personId: "p1", personName: "Demo Person", rationale: "Demo reason" });
    expect(el.textContent).toContain("Demo reason");
    expect(el.textContent).not.toContain("On your calendar");
  });
});
