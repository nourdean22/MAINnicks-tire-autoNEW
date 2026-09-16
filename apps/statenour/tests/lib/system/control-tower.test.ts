/**
 * tests/lib/system/control-tower.test.ts · 2026-09-16 · W7 (System recomposition)
 *
 * /system opens with ONE verdict — "ALL SYSTEMS NOMINAL" or "N REQUIRE
 * ATTENTION" — followed only by the exceptions. The verdict is a pure
 * function of the reads the page already holds, so it is pinned here:
 * unknown is never nominal (a failed read must not render as a healthy
 * system — the 2026-08-19 unknown-is-not-clean rule), every exception
 * source counts once, and the headline's grammar follows the count.
 */
import { describe, expect, it } from "vitest";

import { controlTower, type TowerDiagnostics } from "@/lib/system/control-tower";

const clean: TowerDiagnostics = {
  db: { connected: true, latency_ms: 42 },
  kpis: { errors_24h: 0, requests_24h: 120, latency_24h: { avg_ms: 210, p95_ms: 900 } },
  devices: { online: 3, offline: 0, error: 0, total: 3 },
  integrations: [{ name: "resend", status: "ok", enabled: true }],
};

describe("controlTower · one verdict, then the exceptions", () => {
  it("is UNKNOWN, not nominal, before any measurement exists", () => {
    const v = controlTower({ diagnostics: null, health: null, diagnosticsReadFailed: false });
    expect(v.state).toBe("unknown");
    expect(v.headline).toMatch(/measuring/i);
    expect(v.exceptions).toEqual([]);
  });

  it("is UNKNOWN with the failure named when the first read failed", () => {
    const v = controlTower({ diagnostics: null, health: null, diagnosticsReadFailed: true });
    expect(v.state).toBe("unknown");
    expect(v.headline).not.toMatch(/nominal/i);
    expect(v.exceptions.map((e) => e.key)).toEqual(["diagnostics"]);
  });

  it("is NOMINAL with no exceptions on a clean read", () => {
    const v = controlTower({ diagnostics: clean, health: { status: "ok", alerts: { unresolved: 0 } }, diagnosticsReadFailed: false });
    expect(v.state).toBe("nominal");
    expect(v.headline).toBe("ALL SYSTEMS NOMINAL");
    expect(v.exceptions).toEqual([]);
  });

  it("counts every exception source once and grammars the headline", () => {
    const v = controlTower({
      diagnostics: {
        ...clean,
        db: { connected: false, latency_ms: 0 },
        kpis: { ...clean.kpis, errors_24h: 3 },
        devices: { online: 1, offline: 2, error: 1, total: 4 },
        integrations: [
          { name: "resend", status: "ok", enabled: true },
          { name: "vapi", status: "degraded", enabled: true },
          { name: "old", status: "failed", enabled: false },
        ],
      },
      health: { status: "warn", alerts: { unresolved: 2 } },
      diagnosticsReadFailed: false,
    });
    expect(v.state).toBe("attention");
    expect(v.exceptions.map((e) => e.key)).toEqual([
      "db",
      "errors",
      "alerts",
      "devices-error",
      "devices-offline",
      "integration-vapi",
    ]);
    expect(v.headline).toBe("6 REQUIRE ATTENTION");
    expect(v.exceptions.find((e) => e.key === "errors")?.line).toBe("3 errors in the last 24h");
    expect(v.exceptions.find((e) => e.key === "errors")?.href).toBe("/system/logs");
  });

  it("says REQUIRES for exactly one exception", () => {
    const v = controlTower({
      diagnostics: { ...clean, kpis: { ...clean.kpis, errors_24h: 1 } },
      health: null,
      diagnosticsReadFailed: false,
    });
    expect(v.headline).toBe("1 REQUIRES ATTENTION");
    expect(v.exceptions[0]?.line).toBe("1 error in the last 24h");
  });

  it("keeps the last read but names a failed refresh as an exception", () => {
    const v = controlTower({ diagnostics: clean, health: null, diagnosticsReadFailed: true });
    expect(v.state).toBe("attention");
    expect(v.exceptions.map((e) => e.key)).toEqual(["refresh"]);
  });
});
