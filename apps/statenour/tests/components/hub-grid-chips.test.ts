/**
 * The /system hub chips must not claim health (or counts, or "no devices")
 * off sections the server marked unmeasured. Registered in the 2026-08-04
 * false-green sweep: the quota circuit fed this grid fabricated zeros and
 * hub-grid.tsx printed the word "healthy" in green on a live page.
 *
 * The chips are pure functions of the payload, exported via CARDS.
 *
 * 2026-10-19 (wave 2V): Diagnostics, Errors, AI Cost, Cockpit Observability, State Calibration, Fleet Truth and
 * Logs left the hub with their pages. Their chip tests went with them; the planted control below proves the
 * remaining chips still refuse to read healthy off an unmeasured section.
 */
import { describe, expect, it } from "vitest";

import { CARDS } from "@/components/system/hub-grid";

type Payload = Parameters<(typeof CARDS)[number]["chip"]>[0];

function payload(over: Record<string, object> = {}): Payload {
  const base = {
    crons: { declared: 12, silent: 0, logRows48h: 300, killed: 0, measured: true },
    errors: { count24h: 5, fatal24h: 0, measured: true },
    stale: { totalRows: 10, categories: 1, measured: true },
    brain: { totalMemories: 100, permanent: 10, avgConfidence: 0.8, measured: true },
    devices: { online: 2, offline: 0, total: 2, measured: true },
    pulse: { priorityCount: 0, measured: true },
    ai: { calls24h: 40, costCents7d: 1234, measured: true },
    generatedAt: "2026-08-04T00:00:00.000Z",
  };
  return { ...base, ...over } as Payload;
}

const chip = (href: string, d: Payload) => {
  const card = CARDS.find((c) => c.href === href);
  if (!card) throw new Error(`no card for ${href}`);
  return card.chip(d);
};

describe("hub chips honour measured flags", () => {
  it("Cron Deck goes unknown on its own unmeasured section", () => {
    expect(
      chip(
        "/system/crons",
        payload({ crons: { declared: 0, silent: 0, logRows48h: 0, killed: 0, measured: false } }),
      ).severity,
    ).toBe("unknown");
  });

  it("info chips stop presenting filler as telemetry", () => {
    expect(
      chip("/brain?tab=memory", payload({ brain: { totalMemories: 0, permanent: 0, avgConfidence: 0, measured: false } }))
        .label,
    ).toBe("unmeasured");
    expect(
      chip("/system#stale-data", payload({ stale: { totalRows: 0, categories: 0, measured: false } })).label,
    ).toBe("unmeasured");
  });

  it("a legacy payload without measured keeps the old behaviour (deploy window)", () => {
    const legacy = payload({ crons: { declared: 12, silent: 0, logRows48h: 300, killed: 0 } });
    expect(chip("/system/crons", legacy)).toEqual({ label: "12 jobs", severity: "info" });
  });

  it("null payload still renders the em-dash unknown on every live chip", () => {
    for (const href of ["/system/crons", "/system#stale-data", "/brain?tab=memory"]) {
      expect(chip(href, null).severity).toBe("unknown");
    }
  });

  it("the cut tiles are gone from the hub (a re-added one would need its chip tests back)", () => {
    for (const href of [
      "/system/health",
      "/system/fleet",
      "/system/logs",
      "/system/logs?view=errors",
      "/system/ai-cost",
      "/system/calibration",
      "/system/cockpit-observability",
    ]) {
      expect(CARDS.some((c) => c.href === href), href).toBe(false);
    }
  });
});

describe("Cron Deck chip never reads healthy while crons are silent (09-F24 step 1)", () => {
  it("silent crons are a warning, not '<N> total' healthy", () => {
    expect(
      chip("/system/crons", payload({ crons: { declared: 12, silent: 3, logRows48h: 300, killed: 0, measured: true } })),
    ).toEqual({ label: "3 silent", severity: "warning" });
  });

  it("with nothing silent or killed it is a plain count, not a health verdict", () => {
    expect(chip("/system/crons", payload())).toEqual({ label: "12 jobs", severity: "info" });
  });

  it("control: killed still wins its own warning", () => {
    expect(
      chip("/system/crons", payload({ crons: { declared: 12, silent: 0, logRows48h: 300, killed: 2, measured: true } })),
    ).toEqual({ label: "2 killed", severity: "warning" });
  });
});
