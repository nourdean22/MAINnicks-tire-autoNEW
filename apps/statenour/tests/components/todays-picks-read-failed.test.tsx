/**
 * A failed picks read says so; it never hides the card (people W2b, 2026-10-30).
 *
 * TodaysPicks caught the failure and set an empty list, so a dead API looked
 * exactly like "Nick has no one for you today" (skill empty-vs-error). An
 * honest empty list still renders nothing, which is the positive control.
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

describe("TodaysPicks read state", () => {
  it("a failed read shows that today's picks could not be read", async () => {
    h.rawFetch.mockRejectedValue(new Error("HTTP 500"));
    const el = await mount();
    expect(el.textContent).toMatch(/couldn.t read today.s picks/i);
  });

  it("POSITIVE CONTROL: an honest empty list still renders nothing", async () => {
    h.rawFetch.mockResolvedValue({ picks: [], generatedAt: "2026-10-30T16:00:00Z" });
    const el = await mount();
    expect(el.textContent).toBe("");
  });
});
