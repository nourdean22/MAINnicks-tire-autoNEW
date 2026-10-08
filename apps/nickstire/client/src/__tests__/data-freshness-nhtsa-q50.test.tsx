/**
 * Q-50 phase 3 · Intelligence HQ's Data freshness card gains a row for the NHTSA
 * manufacturer-program list (ADR-0021 §7.3 follow-up).
 *
 * The work-order drawer already says "unavailable" or "may be out of date" for one car.
 * This row says it once, for the whole list, where the owner looks at freshness. Its
 * states: not set up (flag off, never ran: quiet, it ships off on purpose), armed but
 * never finished (loud), fresh, stale (loud) and a failed read (UNMEASURED "unknown",
 * never "not set up" and never stale).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const loading = () => ({ data: undefined as unknown, isLoading: true, isError: false });
const h = vi.hoisted(() => ({ nhtsa: { data: undefined as unknown, isLoading: true, isError: false } }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminSecurity: { integrationFreshness: { useQuery: () => ({ data: undefined, isLoading: true, isError: false }) } },
    controlCenter: { todayPulse: { useQuery: () => ({ data: undefined, isLoading: true, isError: false }) } },
    sms: { gatewayHealth: { useQuery: () => ({ data: undefined, isLoading: true, isError: false }) } },
    vehicleData: { warrantyIngestFreshness: { useQuery: () => h.nhtsa } },
  },
}));

import { DataFreshness } from "../pages/admin/today/DataFreshness";
import { nhtsaWarrantyRow } from "../pages/admin/today/freshnessRows";

afterEach(() => {
  cleanup();
  Object.assign(h.nhtsa, loading());
});

const NOW = new Date("2026-10-08T15:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
const ok = (over: Record<string, unknown>) => ({ data: { ok: true, lastSuccessAt: null, stale: false, armed: false, ...over }, isError: false }) as const;

describe("nhtsaWarrantyRow", () => {
  it("flag off and never ran: 'not set up', MEASURED and quiet (it ships off on purpose)", () => {
    const r = nhtsaWarrantyRow(ok({}) as never, NOW);
    expect(r).toMatchObject({ key: "nhtsa", status: "not set up", provenance: "MEASURED", loud: false });
    expect(r.detail).toMatch(/switched off/);
    expect(r.detail).toMatch(/unavailable/);
  });

  it("armed but no run has finished: loud, and points at cron_log", () => {
    const r = nhtsaWarrantyRow(ok({ armed: true }) as never, NOW);
    expect(r).toMatchObject({ status: "no finished run", provenance: "MEASURED", loud: true });
    expect(r.detail).toMatch(/cron_log/);
  });

  it("a fresh list is quiet and says how old it is", () => {
    const r = nhtsaWarrantyRow(ok({ armed: true, lastSuccessAt: hoursAgo(5) }) as never, NOW);
    expect(r).toMatchObject({ status: "fresh · 5h old", detail: null, provenance: "MEASURED", loud: false });
  });

  it("a fresh list with the flag since switched off says so, quietly", () => {
    const r = nhtsaWarrantyRow(ok({ armed: false, lastSuccessAt: hoursAgo(5) }) as never, NOW);
    expect(r).toMatchObject({ status: "fresh · 5h old", loud: false });
    expect(r.detail).toMatch(/switched off/);
  });

  it("a stale list is loud, with the server's 3-day verdict, armed or not", () => {
    const armed = nhtsaWarrantyRow(ok({ armed: true, lastSuccessAt: hoursAgo(80), stale: true }) as never, NOW);
    expect(armed).toMatchObject({ status: "stale · 3d old", provenance: "MEASURED", loud: true });
    expect(armed.detail).toMatch(/3 days/);
    const off = nhtsaWarrantyRow(ok({ armed: false, lastSuccessAt: hoursAgo(80), stale: true }) as never, NOW);
    expect(off).toMatchObject({ loud: true });
    expect(off.detail).toMatch(/switched off/);
  });

  it("a failed read, or the reader's ok:false, is UNMEASURED 'unknown', never 'not set up'", () => {
    for (const q of [
      { data: undefined, isError: true },
      { data: { ok: false, error: "database unavailable" }, isError: false },
    ]) {
      const r = nhtsaWarrantyRow(q as never, NOW);
      expect(r).toMatchObject({ status: "unknown", provenance: "UNMEASURED", loud: true });
      expect(r.status).not.toMatch(/not set up|stale|fresh/);
    }
  });

  it("while loading: 'checking…' with no tag", () => {
    expect(nhtsaWarrantyRow({ data: undefined, isError: false }, NOW)).toMatchObject({ status: "checking…", provenance: null, loud: false });
  });
});

describe("DataFreshness card", () => {
  const rowText = (c: HTMLElement) => c.querySelector('[data-freshness-row="nhtsa"]')?.textContent ?? "";

  it("renders the NHTSA row, and counts it when it needs a look", () => {
    h.nhtsa.isLoading = false;
    h.nhtsa.isError = true;
    const { container } = render(<DataFreshness />);
    expect(rowText(container)).toMatch(/NHTSA program list/);
    expect(rowText(container)).toMatch(/unknown/);
    expect(container.querySelector("[data-freshness-summary]")?.textContent).toBe("1 need a look");
  });

  it("a quiet 'not set up' row adds nothing to the summary", () => {
    h.nhtsa.isLoading = false;
    h.nhtsa.data = { ok: true, lastSuccessAt: null, stale: false, armed: false };
    const { container } = render(<DataFreshness />);
    expect(rowText(container)).toMatch(/not set up/);
    expect(container.querySelector("[data-freshness-summary]")).toBeNull();
  });
});
