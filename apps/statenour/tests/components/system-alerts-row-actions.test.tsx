/**
 * UI v3 W5b, /system/alerts row actions: Resolve (two taps, as in the inspector), Mute category
 * (7 days, as today) and Dismiss with a reason from a closed list, on the page itself.
 *
 * Dismiss opens an in-DOM sheet (an iOS home-screen PWA silently drops window.prompt; skill
 * nickstire-ios-pwa-primitives). The sheet says what the dismissal covers: the recurring signal
 * where the producer has a stable identity, otherwise "this one only".
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  q: {} as Record<string, unknown>,
  resolve: vi.fn(),
  mute: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      activeAlerts: { useQuery: () => h.q },
      memoryById: { useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null }) },
      resolveAlert: { useMutation: () => ({ mutate: h.resolve, isPending: false }) },
      muteAlertCategory: { useMutation: () => ({ mutate: h.mute, isPending: false }) },
      dismissAlert: { useMutation: () => ({ mutate: h.dismiss, isPending: false }) },
    },
    useUtils: () => ({ brain: { activeAlerts: { invalidate: async () => {} }, memoryById: { invalidate: async () => {} } } }),
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: () => {} }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/system/alerts",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import AlertsInspectorPage from "@/app/(mastery)/system/alerts/page";

const NOW = new Date().toISOString();
const row = (id: string, category: string, key: string, content: string) => ({ id, category, key, content, createdAt: NOW, metadata: null });
const PAYLOAD = {
  sinceDays: 30,
  counts: { brain_bus_alert: 1, creation_spike_alert: 1 },
  alerts: {
    brain_bus_alert: [row("b1", "brain_bus_alert", "dead-event:e1", "Dead bus event")],
    creation_spike_alert: [row("s1", "creation_spike_alert", "task:2026-10-18T09", "Task spike")],
  },
};

let root: Root | null = null;
let host: HTMLDivElement;
function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AlertsInspectorPage />));
}
const rowEl = (id: string) => host.querySelector(`[data-entity="alert:${id}"]`) as HTMLElement;
const btn = (scope: ParentNode, name: RegExp) =>
  Array.from(scope.querySelectorAll("button")).find((b) => name.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  h.q = { data: PAYLOAD, isPending: false, isFetching: false, isError: false, error: null, dataUpdatedAt: 1, refetch: () => {} };
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("/system/alerts row actions", () => {
  it("every row carries Resolve, Mute and Dismiss at a 44 px target", () => {
    render();
    const r = rowEl("b1");
    for (const name of [/^Resolve$/, /^Mute 7 days$/, /^Dismiss$/]) {
      const b = btn(r, name);
      expect(b, String(name)).toBeTruthy();
      expect(b!.className).toContain("min-h-[44px]");
    }
  });

  it("Resolve takes two taps, then resolves that row", () => {
    render();
    act(() => btn(rowEl("b1"), /^Resolve$/)!.click());
    expect(h.resolve).not.toHaveBeenCalled();
    act(() => btn(rowEl("b1"), /^Tap again to resolve$/)!.click());
    expect(h.resolve).toHaveBeenCalledWith({ id: "b1" });
  });

  // Codex P2 on #3161: the armed Resolve never expired, so a stray tap minutes later resolved.
  it("an armed Resolve disarms after the inspector's window; a later tap re-arms, it does not resolve", () => {
    vi.useFakeTimers();
    try {
      render();
      act(() => btn(rowEl("b1"), /^Resolve$/)!.click());
      expect(btn(rowEl("b1"), /^Tap again to resolve$/)).toBeTruthy();
      act(() => vi.advanceTimersByTime(4100));
      expect(btn(rowEl("b1"), /^Resolve$/)).toBeTruthy();
      act(() => btn(rowEl("b1"), /^Resolve$/)!.click());
      expect(h.resolve).not.toHaveBeenCalled();
      expect(btn(rowEl("b1"), /^Tap again to resolve$/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Mute mutes that row's category for 7 days", () => {
    render();
    act(() => btn(rowEl("b1"), /^Mute 7 days$/)!.click());
    expect(h.mute).toHaveBeenCalledWith({ category: "brain_bus_alert", days: 7 });
  });

  it("Dismiss opens an in-DOM sheet with exactly three reasons and never calls window.prompt", () => {
    const prompt = vi.spyOn(window, "prompt");
    render();
    act(() => btn(rowEl("b1"), /^Dismiss$/)!.click());
    const d = dialog();
    expect(d).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
    const labels = Array.from(d!.querySelectorAll('input[type="radio"]')).map((i) => (i as HTMLInputElement).value);
    expect(labels).toEqual(["expected", "fixed", "noise"]);
    expect(btn(d!, /^Dismiss alert$/)!.disabled).toBe(true);
    expect(d!.textContent).toContain("This one only");
  });

  it("choosing a reason and confirming dismisses the tapped row with that reason", () => {
    render();
    act(() => btn(rowEl("b1"), /^Dismiss$/)!.click());
    const noise = dialog()!.querySelector('input[value="noise"]') as HTMLInputElement;
    act(() => noise.click());
    act(() => btn(dialog()!, /^Dismiss alert$/)!.click());
    expect(h.dismiss).toHaveBeenCalledTimes(1);
    expect(h.dismiss.mock.calls[0][0]).toEqual({ id: "b1", reason: "noise" });
  });

  it("a creation spike's sheet says it covers that entity's spikes, not this one only", () => {
    render();
    act(() => btn(host, /^Other, 1/)!.click());
    act(() => btn(rowEl("s1"), /^Dismiss$/)!.click());
    expect(dialog()!.textContent).toContain("creation spikes for task");
    expect(dialog()!.textContent).not.toContain("This one only");
  });

  it("Cancel and Escape close the sheet without dismissing", () => {
    render();
    act(() => btn(rowEl("b1"), /^Dismiss$/)!.click());
    act(() => btn(dialog()!, /^Cancel$/)!.click());
    expect(dialog()).toBeNull();
    act(() => btn(rowEl("b1"), /^Dismiss$/)!.click());
    act(() => {
      dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(h.dismiss).not.toHaveBeenCalled();
  });
});
