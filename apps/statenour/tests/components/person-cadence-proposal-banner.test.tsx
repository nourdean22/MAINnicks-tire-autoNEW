/**
 * The suggestion panel shows a cadence proposal (people W2, 2026-10-30).
 *
 * The banner returned null unless the suggestion carried a role, notes or a
 * trust change, so a cadence-only proposal (the W2 engine writes exactly that)
 * would have been invisible: a writer with no reader.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(el: React.ReactElement): string {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host.textContent ?? "";
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

vi.mock("@/lib/trpc/client", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({ task: { personProfile: { invalidate: vi.fn() } } }),
      task: { acceptClassification: { useMutation: mutation }, dismissClassification: { useMutation: mutation } },
    },
  };
});

import { PendingClassificationBanner } from "@/components/power-atlas/PersonInsights";

describe("PendingClassificationBanner", () => {
  it("renders a cadence-only proposal with its days and basis", () => {
    const text = render(
      <PendingClassificationBanner personId="p1" pending={{ cadenceDays: 14, basis: "default for close friend" }} onResolved={() => {}} />,
    );
    expect(text).toMatch(/cadence/i);
    expect(text).toMatch(/every 14 days/i);
    expect(text).toMatch(/default for close friend/);
  });

  it("POSITIVE CONTROL: an empty suggestion still renders nothing", () => {
    expect(render(<PendingClassificationBanner personId="p1" pending={{ basis: "x" }} onResolved={() => {}} />)).toBe("");
  });
});
