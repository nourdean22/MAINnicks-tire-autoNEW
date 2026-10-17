/**
 * Brain FU6: the Journey panel's XP section renders an unread window as UNKNOWN.
 *
 * THE DEFECT. With the XP read failed the lens sent `{ current30: 0, prior30: 0 }` and
 * enoughData false, and the panel printed "No XP events in either window yet.", a measured empty
 * month. The lens now flags the section `unknown: true`; the panel shows an unknown line and no
 * total, no growth and no "no XP" claim. The MEASURED-ZERO control keeps the quiet-month line.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      journeyLens: { useQuery: () => ({ data: h.data, isLoading: false, isError: false }) },
    },
  },
}));

import { JourneyPanel } from "@/components/stats/journey-panel";

const section = (extra: Record<string, unknown> = {}) => ({
  enoughData: false,
  since: "all time",
  source: "test",
  data: [],
  ...extra,
});

const lens = (xp: Record<string, unknown>) => ({
  identity: section(),
  xp: {
    enoughData: false,
    since: "30d vs prior 30d",
    source: "mastery_xp_event totals",
    data: { current30: 0, prior30: 0, growthPct: null },
    ...xp,
  },
  enemies: section(),
  skills: section(),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(data: unknown): Promise<string> {
  h.data = data;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<JourneyPanel />);
  });
  return container.textContent ?? "";
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("JourneyPanel xp section", () => {
  it("control: a measured empty month keeps the quiet-month line and no unknown line", async () => {
    const text = await mount(lens({}));
    expect(text).toContain("No XP events in either window yet.");
    expect(text).not.toMatch(/couldn.t be read/i);
  });

  it("control: real XP shows totals and growth", async () => {
    const text = await mount(
      lens({ enoughData: true, data: { current30: 150, prior30: 100, growthPct: 50 } }),
    );
    expect(text).toContain("150 XP this 30d");
    expect(text).toContain("+50%");
    expect(text).not.toMatch(/couldn.t be read/i);
  });

  it("renders unknown, never 0 or 'no XP', when the lens flags the xp section unknown", async () => {
    const text = await mount(lens({ unknown: true }));
    expect(text, "an unread XP window was drawn as a quiet month").not.toContain("No XP events");
    expect(text, "an unread XP window was drawn as 0 XP").not.toContain("0 XP");
    expect(text).toContain("XP couldn't be read. State unknown, not a quiet month.");
  });
});
