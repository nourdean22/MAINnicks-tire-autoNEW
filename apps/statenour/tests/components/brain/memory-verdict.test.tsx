/**
 * tests/components/brain/memory-verdict.test.tsx - bdnick wave D round 5 (2026-10-24).
 *
 * The Memory tab leads with one verdict: how many claims disagree with the record. empty-vs-error:
 * a failed read is never a clean ledger, a failed contradictions subsystem read is unknown (not 0),
 * a paused read says offline, and a real 0 is said as a measured zero.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc/client", () => ({ trpc: { brain: { maturity: { useQuery: () => h.q } } } }));

import { MemoryVerdict } from "@/components/brain/memory-verdict";

const base = { isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
const withOpen = (open: number | null) => ({
  ...base,
  data: { components: { contradictions: { open }, beliefs: { active: 12 } }, failedReads: open == null ? ["contradictions"] : [] },
});

let host: HTMLDivElement;
let root: Root;
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryVerdict />);
  });
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tone = () => host.querySelector("[data-memory-verdict]")!.getAttribute("data-memory-verdict");
const text = () => host.textContent!.replace(/\s+/g, " ");

describe("Memory verdict", () => {
  it("open claims: attention, the count, and the way in", async () => {
    h.q = withOpen(79);
    await mount();
    expect(tone()).toBe("attention");
    expect(text()).toContain("79 claims disagree with the record.");
    expect(host.querySelector('a[href="#contradictions"]')).not.toBeNull();
  });

  it("a measured zero is said as one, with no link", async () => {
    h.q = withOpen(0);
    await mount();
    expect(tone()).toBe("nominal");
    expect(text()).toContain("Nothing the brain believes disagrees with the record.");
    expect(host.querySelector('a[href="#contradictions"]')).toBeNull();
  });

  it("a failed contradictions read is unknown, never zero", async () => {
    h.q = withOpen(null);
    await mount();
    expect(tone()).toBe("unknown");
    expect(text()).toContain("unknown whether any claim disagrees");
    expect(text()).not.toContain("Nothing the brain believes");
    expect(text()).toContain("contradictions open ?");
  });

  it("a failed read says so, offers Retry and carries the fold marker", async () => {
    h.q = { ...base, data: undefined, isError: true };
    await mount();
    expect(tone()).toBe("unknown");
    expect(text()).toContain("Memory couldn't be read");
    expect(host.querySelector('[data-read-state="error"]')).not.toBeNull();
    expect(host.querySelector("[data-read-failed]")).not.toBeNull();
  });

  it("a paused read says offline", async () => {
    h.q = { ...base, data: undefined, isPending: true, fetchStatus: "paused" };
    await mount();
    expect(host.querySelector('[data-read-state="offline"]')).not.toBeNull();
    expect(text()).not.toContain("Nothing the brain believes");
  });

  it("control: cached data under a paused refetch still draws its verdict", async () => {
    h.q = { ...withOpen(3), fetchStatus: "paused" };
    await mount();
    expect(text()).toContain("3 claims disagree with the record.");
  });

  it("a paused read is a pause, not a failed read: only the offline note, no failed-read sentence (lens B row 5)", async () => {
    h.q = { ...base, data: undefined, isPending: true, fetchStatus: "paused" };
    await mount();
    expect(text()).toContain("Offline. Memory shows when the connection returns.");
    expect(text()).not.toContain("couldn't be read");
    expect(text()).not.toContain("is unknown");
    // control: a failed read keeps its sentence, so the offline branch did not swallow it
    act(() => root.unmount());
    host.remove();
    h.q = { ...base, data: undefined, isError: true };
    await mount();
    expect(text()).toContain("Memory couldn't be read");
  });
});
