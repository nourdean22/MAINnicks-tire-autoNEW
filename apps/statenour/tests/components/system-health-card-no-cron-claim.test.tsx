/**
 * The health card must not blame or credit a nightly cron that no longer
 * exists (audit 02-F5, 2026-10-10). The health-digest cron was deleted in
 * f87fb7e62; the GET's 4 h read-through recompute is the only scheduler.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const h = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/ultron/client-cache", () => ({
  useUltronFetch: () => ({ data: h.data, loading: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { operator: { refreshHealthDigest: { useMutation: () => ({ mutateAsync: vi.fn() }) } } },
}));

import { SystemHealthCard } from "@/components/ultron/system-health-card";

const digest = (over: Record<string, unknown>) => ({
  generatedAt: new Date(Date.now() - 40 * 3_600_000).toISOString(),
  overall: "healthy",
  counts: { critical: 0, warning: 0, healthy: 5 },
  highlights: [],
  stats: { cronsDeclared: 1, cronsSilent: 0, cronLogRows48h: 1, staleRows: 0, googleOauth: true, googleOauthProbeFailed: false, envReady: 1, envTotal: 1 },
  ...over,
});

describe("SystemHealthCard copy", () => {
  it("an old healthy digest says stale without blaming a nightly cron", () => {
    h.data = digest({});
    const html = renderToStaticMarkup(<SystemHealthCard />);
    expect(html).toContain("stale");
    expect(html).not.toMatch(/nightly/i);
  });

  it("a live-recomputed warning digest does not mention a nightly cron", () => {
    h.data = digest({
      generatedAt: new Date().toISOString(),
      overall: "warning",
      livelyComputed: true,
      highlights: [{ severity: "warning", headline: "2 crons silent in last 48h", link: "/system/crons" }],
    });
    const html = renderToStaticMarkup(<SystemHealthCard />);
    expect(html).toContain("2 crons silent");
    expect(html).not.toMatch(/nightly/i);
  });
});
