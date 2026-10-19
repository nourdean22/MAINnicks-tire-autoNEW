// @vitest-environment jsdom
/**
 * The /system outbox row (wave 2V, 2026-10-19). The Fleet page was the only UI for system.outboxRedrive and the
 * outbox dead-letter Telegram alert told Nour to redrive there. Nour cut the page, not the ability, so /system
 * carries one compact row: "Outbox: N dead-lettered" with a two-tap Redrive.
 *
 * States pinned: loading and failed read are UNKNOWN (never 0, empty-vs-error), a clean queue hides the row, N > 0
 * shows the count and the button. The redrive is a two-tap in-DOM confirm (window.confirm is suppressed in the iOS
 * PWA, skill nickstire-ios-pwa-primitives): the first tap arms, only the second calls the mutation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  health: { data: undefined, isLoading: true, isError: false } as {
    data?: { dead: number; oldestDeadAt: string | null };
    isLoading: boolean;
    isError: boolean;
  },
  mutate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      outboxHealth: { useQuery: () => ({ ...h.health, refetch: h.refetch }) },
      outboxRedrive: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
    },
  },
}));

import { OutboxRedriveRow } from "@/components/system/outbox-redrive-row";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  h.mutate.mockReset();
  h.refetch.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = () => act(() => root.render(<OutboxRedriveRow />));
const button = () => container.querySelector("button");

describe("OutboxRedriveRow · the three read states", () => {
  it("loading reads UNKNOWN, with no count and no button", () => {
    h.health = { data: undefined, isLoading: true, isError: false };
    render();
    expect(container.textContent).toMatch(/Outbox/);
    expect(container.textContent).toMatch(/reading|unknown/i);
    expect(container.textContent).not.toMatch(/\b0\b/);
    expect(button()).toBeNull();
  });

  it("a FAILED read says unknown, never 0 (empty-vs-error)", () => {
    h.health = { data: undefined, isLoading: false, isError: true };
    render();
    expect(container.textContent).toMatch(/Outbox: unknown/);
    expect(container.textContent).not.toMatch(/\b0\b/);
    expect(button()).toBeNull();
  });

  it("a successful read of 0 dead-lettered hides the row entirely", () => {
    h.health = { data: { dead: 0, oldestDeadAt: null }, isLoading: false, isError: false };
    render();
    expect(container.textContent).toBe("");
  });

  it("N > 0 shows the count and a 44px Redrive button", () => {
    h.health = { data: { dead: 4, oldestDeadAt: "2026-10-18T10:00:00.000Z" }, isLoading: false, isError: false };
    render();
    expect(container.textContent).toContain("Outbox: 4 dead-lettered");
    const b = button()!;
    expect(b.textContent).toContain("Redrive");
    expect(b.className).toMatch(/min-h-\[44px\]/);
    expect(b.getAttribute("type")).toBe("button");
  });
});

describe("OutboxRedriveRow · the two-tap redrive", () => {
  beforeEach(() => {
    h.health = { data: { dead: 4, oldestDeadAt: null }, isLoading: false, isError: false };
  });

  it("the first tap only arms: no mutation, and the button asks to be tapped again", () => {
    render();
    act(() => button()!.click());
    expect(h.mutate).not.toHaveBeenCalled();
    expect(button()!.textContent).toMatch(/again/i);
  });

  it("the second tap calls system.outboxRedrive once", () => {
    render();
    act(() => button()!.click());
    act(() => button()!.click());
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toEqual({ limit: 200 });
  });

  it("an armed button disarms after a few seconds, so a stray later tap cannot fire it", () => {
    render();
    act(() => button()!.click());
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(button()!.textContent).not.toMatch(/again/i);
    act(() => button()!.click());
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("never uses window.confirm (suppressed in the iOS PWA)", () => {
    const spy = vi.spyOn(window, "confirm");
    render();
    act(() => button()!.click());
    act(() => button()!.click());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
