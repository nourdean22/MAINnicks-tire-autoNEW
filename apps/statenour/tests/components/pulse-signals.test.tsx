// @vitest-environment jsdom
/**
 * The Pulse sheet's signals section (home-pulse W3, 2026-10-31): the coach channel, grouped by source,
 * with Done and Snooze that write the server row. A failed read says unknown; an empty read adds nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PulseSignalsView, signalChip } from "@/components/ultron/pulse-signals";
import type { PulseFeed } from "@/lib/home/pulse-feed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const FEED: PulseFeed = {
  total: 2,
  groups: [
    { source: "system", items: [{ key: "coach:system-alert:cost", title: "Spend over budget", whyNow: "Passed the daily cap", href: "/system", level: "P0", updatedAt: "2026-10-31T10:00:00Z" }] },
    { source: "goals", items: [{ key: "coach:goal-pace-shift:g1", title: "Goal slipping", whyNow: null, href: null, level: "P2", updatedAt: "2026-10-31T09:00:00Z" }] },
  ],
};

describe("PulseSignalsView", () => {
  it("renders each group under its label with the why-now line", () => {
    const el = mount(<PulseSignalsView read={FEED} onAct={() => {}} busyKey={null} actError={null} />);
    const headings = [...el.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual(["System", "Goals"]);
    expect(el.textContent).toContain("Passed the daily cap");
  });

  it("Done and Snooze send the item's key to the server action", () => {
    const onAct = vi.fn();
    const el = mount(<PulseSignalsView read={FEED} onAct={onAct} busyKey={null} actError={null} />);
    const buttons = [...el.querySelectorAll("button")];
    act(() => buttons.find((b) => b.textContent === "Done")!.click());
    act(() => buttons.find((b) => b.textContent === "Snooze 1h")!.click());
    expect(onAct).toHaveBeenNthCalledWith(1, "coach:system-alert:cost", "done");
    expect(onAct).toHaveBeenNthCalledWith(2, "coach:system-alert:cost", "snooze");
  });

  it("every action button meets the 44px phone floor", () => {
    const el = mount(<PulseSignalsView read={FEED} onAct={() => {}} busyKey={null} actError={null} />);
    for (const b of el.querySelectorAll("button")) expect(b.className).toContain("min-h-11");
  });

  it("a failed read says so instead of looking like nothing needs him", () => {
    const el = mount(<PulseSignalsView read="error" onAct={() => {}} busyKey={null} actError={null} />);
    expect(el.textContent).toContain("Signals unknown");
  });

  it("an empty feed and a loading feed add nothing to the sheet", () => {
    expect(mount(<PulseSignalsView read={{ total: 0, groups: [] }} onAct={() => {}} busyKey={null} actError={null} />).textContent).toBe("");
    act(() => root?.unmount());
    expect(mount(<PulseSignalsView read="loading" onAct={() => {}} busyKey={null} actError={null} />).textContent).toBe("");
  });

  it("a rejected action is said where the tap happened", () => {
    const el = mount(<PulseSignalsView read={FEED} onAct={() => {}} busyKey={null} actError="Could not update that. Try again." />);
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Could not update that. Try again.");
  });
});

describe("signalChip", () => {
  it("counts signals, flags urgency, and stays quiet when there are none or the read failed", () => {
    expect(signalChip(FEED)).toEqual({ text: "2 to look at", urgent: true });
    expect(signalChip({ total: 1, groups: [{ source: "goals", items: [FEED.groups[1].items[0]] }] })).toEqual({ text: "1 to look at", urgent: false });
    expect(signalChip({ total: 0, groups: [] })).toBeNull();
    expect(signalChip("loading")).toBeNull();
    expect(signalChip("error")).toEqual({ text: "signals unknown", urgent: false });
  });
});
