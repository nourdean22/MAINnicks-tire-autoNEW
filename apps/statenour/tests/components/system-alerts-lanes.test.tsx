/**
 * UI v3 W5b, /system/alerts: Priority and Other lanes, an honest read state, and row actions.
 *
 * THE DEFECTS. (1) Every alert sat in one flat list of tinted cards, so a storage quota or a dead
 * brain-bus event (someone has to act) read the same as a creation-spike trend. (2) A failed read
 * printed the bare error string with no way to read again. (3) Resolve and Mute lived only in the
 * inspector; there was no way to say "this one is noise" without muting a whole category.
 *
 * Pinned by what renders: Priority rows first as ruled rows; Other behind a closed "Other, N"
 * disclosure (a real button with aria-expanded); loading, failed (Retry) and empty each in words.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  q: {} as Record<string, unknown>,
  refetch: vi.fn(),
  resolve: vi.fn(),
  mute: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      activeAlerts: { useQuery: () => h.q },
      resolveAlert: { useMutation: () => ({ mutate: h.resolve, isPending: false }) },
      muteAlertCategory: { useMutation: () => ({ mutate: h.mute, isPending: false }) },
      dismissAlert: { useMutation: () => ({ mutate: h.dismiss, isPending: false }) },
    },
    useUtils: () => ({ brain: { activeAlerts: { invalidate: async () => {} } } }),
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import AlertsInspectorPage from "@/app/(mastery)/system/alerts/page";

const NOW = new Date().toISOString();
const row = (id: string, category: string, key: string, content: string) => ({
  id,
  category,
  key,
  content,
  createdAt: NOW,
  metadata: null,
});
const PAYLOAD = {
  sinceDays: 30,
  counts: { correlation_alert: 1, storage_quota_alert: 1, creation_spike_alert: 1, decision_quality_drift: 1 },
  alerts: {
    correlation_alert: [row("a1", "correlation_alert", "sleep__revenue", "Sleep tracks revenue")],
    storage_quota_alert: [row("a2", "storage_quota_alert", "neon", "Storage at 91 percent")],
    creation_spike_alert: [row("a3", "creation_spike_alert", "task:2026-10-18T09", "Creation spike on tasks")],
    decision_quality_drift: [row("a4", "decision_quality_drift", "2026-10-17", "Decision grades slipped")],
    schema_drift_alert: [],
    update_spike_alert: [],
    brain_bus_alert: [],
  },
};

const q = (over: Record<string, unknown>) => ({
  data: undefined,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null,
  dataUpdatedAt: 1,
  refetch: h.refetch,
  ...over,
});

let root: Root | null = null;
let host: HTMLDivElement;
function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AlertsInspectorPage />));
  return host;
}
const text = () => host.textContent ?? "";
const button = (name: RegExp) =>
  Array.from(host.querySelectorAll("button")).find((b) => name.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  h.q = q({ data: PAYLOAD });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("/system/alerts: Priority first, Other behind a closed disclosure", () => {
  it("Priority rows render; Other rows stay hidden until the disclosure opens", () => {
    render();
    expect(text()).toContain("Priority");
    expect(text()).toContain("Sleep tracks revenue");
    expect(text()).toContain("Storage at 91 percent");
    expect(text()).not.toContain("Creation spike on tasks");
    expect(text()).not.toContain("Decision grades slipped");
    const other = button(/^Other, 2/);
    expect(other).toBeTruthy();
    expect(other!.getAttribute("aria-expanded")).toBe("false");
  });

  it("opening Other shows its rows and flips aria-expanded", () => {
    render();
    act(() => button(/^Other, 2/)!.click());
    expect(button(/^Other, 2/)!.getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("Creation spike on tasks");
    expect(text()).toContain("Decision grades slipped");
  });

  it("rows are ruled rows, not tinted cards", () => {
    render();
    const item = host.querySelector('[data-entity="alert:a1"]') as HTMLElement;
    expect(item).toBeTruthy();
    expect(item.className).not.toContain("rounded-surface");
    expect(item.closest("ul")!.className).toContain("divide-y");
  });

  it("CONTROL (lanes): with no Other alerts there is no Other disclosure", () => {
    h.q = q({
      data: {
        ...PAYLOAD,
        alerts: { ...PAYLOAD.alerts, creation_spike_alert: [], decision_quality_drift: [] },
      },
    });
    render();
    expect(button(/^Other,/)).toBeUndefined();
    expect(text()).toContain("Sleep tracks revenue");
  });
});

describe("/system/alerts: loading, a failed read and a real empty each say which they are", () => {
  const EMPTY = { sinceDays: 30, counts: {}, alerts: {} };

  it("a failed read says unknown, offers Retry, and never prints the empty text", () => {
    h.q = q({ isError: true, error: { message: "db down" } });
    render();
    expect(text()).toContain("Couldn't load alerts: state unknown, not an empty list.");
    expect(text()).not.toContain("No alerts in the last");
    const retry = button(/^Retry$/);
    expect(retry).toBeTruthy();
    act(() => retry!.click());
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("a failed refetch over an old empty answer is still unknown (React Query keeps the stale data)", () => {
    h.q = q({ data: EMPTY, isError: true, error: { message: "db down" } });
    render();
    expect(text()).toContain("state unknown");
    expect(text()).not.toContain("No alerts in the last");
  });

  it("before the first read lands it says it is reading, and claims nothing", () => {
    h.q = q({ isPending: true, isFetching: true });
    render();
    expect(text()).toContain("Reading alerts.");
    expect(text()).not.toContain("No alerts in the last");
  });

  it("CONTROL (states): a successful empty read says so in words", () => {
    h.q = q({ data: EMPTY });
    render();
    expect(text()).toContain("No alerts in the last 30 days.");
    expect(text()).not.toContain("state unknown");
  });
});