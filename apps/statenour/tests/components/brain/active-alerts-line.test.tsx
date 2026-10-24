/**
 * tests/components/brain/active-alerts-line.test.tsx - bdnick wave D round 4 (Codex 4368647112, 4368647114).
 *
 * The Signals fold's alerts line must not show an old count as current, and must not show a capped
 * count as exact. buildActiveAlerts caps each category at `limit` (lib/services/brain-domain.ts:127),
 * so a category at the cap means "at least", rendered as "N+".
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown>, input: undefined as unknown }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      activeAlerts: {
        useQuery: (input: unknown) => {
          h.input = input;
          return h.q;
        },
      },
    },
  },
}));

import { ActiveAlertsCard } from "@/components/brain/active-alerts-card";

const query = (counts: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  data: { sinceDays: 30, counts, alerts: {} },
  isError: false,
  isPending: false,
  isLoading: false,
  fetchStatus: "idle",
  refetch: () => Promise.resolve(),
  ...extra,
});

let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ActiveAlertsCard />);
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const text = () => host.textContent!.replace(/\s+/g, " ").trim();

describe("brain alerts line", () => {
  it("an exact count below the cap", async () => {
    h.q = query({ correlation_alert: 3, schema_drift_alert: 2 });
    await mount();
    expect(text()).toContain("5 brain alerts open in the last 30 days");
    expect(text()).not.toContain("5+");
  });

  it("a lower bound when any category hit the cap", async () => {
    h.q = query({ correlation_alert: 10, schema_drift_alert: 2 });
    await mount();
    expect(text()).toContain("12+ brain alerts open in the last 30 days");
  });

  it("asks for the cap it compares against", async () => {
    h.q = query({});
    await mount();
    expect(h.input).toEqual({ limit: 10 });
  });

  it("a failed refresh over cached data says so beside the count", async () => {
    h.q = query({ correlation_alert: 3 }, { isError: true });
    await mount();
    expect(host.querySelector('[data-read-state="stale"]')).not.toBeNull();
    expect(text()).toContain("3 brain alerts open");
  });
});
