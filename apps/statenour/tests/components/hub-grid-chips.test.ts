/**
 * The /system hub chips must not claim health (or counts, or "no devices")
 * off sections the server marked unmeasured. Registered in the 2026-08-04
 * false-green sweep: the quota circuit fed this grid fabricated zeros and
 * hub-grid.tsx printed the word "healthy" in green on a live page.
 *
 * The chips are pure functions of the payload, exported via CARDS.
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
    power: { paused: false, measured: true },
    governance: { pendingCount: 0, measured: true },
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
  it("Diagnostics says healthy only when BOTH its sources measured clean", () => {
    expect(chip("/system/health", payload())).toEqual({ label: "healthy", severity: "healthy" });
    expect(
      chip("/system/health", payload({ errors: { count24h: 0, fatal24h: 0, measured: false } })),
    ).toEqual({ label: "unmeasured", severity: "unknown" });
    expect(
      chip(
        "/system/health",
        payload({ crons: { declared: 0, silent: 0, logRows48h: 0, killed: 0, measured: false } }),
      ),
    ).toEqual({ label: "unmeasured", severity: "unknown" });
  });

  it("Arrival Intel: an unread fleet is unmeasured, never 'no devices'", () => {
    expect(
      chip("/system/camera", payload({ devices: { online: 0, offline: 0, total: 0, measured: false } })),
    ).toEqual({ label: "unmeasured", severity: "unknown" });
    // A genuinely-read empty fleet keeps its honest label.
    expect(
      chip("/system/camera", payload({ devices: { online: 0, offline: 0, total: 0, measured: true } })),
    ).toEqual({ label: "no devices", severity: "unknown" });
  });

  it("Cron Deck and Errors go unknown on their own unmeasured section", () => {
    expect(
      chip(
        "/system/crons",
        payload({ crons: { declared: 0, silent: 0, logRows48h: 0, killed: 0, measured: false } }),
      ).severity,
    ).toBe("unknown");
    expect(
      chip("/system/logs?view=errors", payload({ errors: { count24h: 0, fatal24h: 0, measured: false } }))
        .severity,
    ).toBe("unknown");
  });

  it("info chips stop presenting filler as telemetry", () => {
    expect(
      chip("/system/ai-cost", payload({ ai: { calls24h: 0, costCents7d: 0, measured: false } })).label,
    ).toBe("unmeasured");
    expect(
      chip("/brain", payload({ brain: { totalMemories: 0, permanent: 0, avgConfidence: 0, measured: false } }))
        .label,
    ).toBe("unmeasured");
    expect(
      chip(
        "/system/cockpit-observability",
        payload({ ai: { calls24h: 0, costCents7d: 0, measured: false } }),
      ).label,
    ).toBe("unmeasured");
  });

  it("a legacy payload without measured keeps the old behaviour (deploy window)", () => {
    const legacy = payload({
      crons: { declared: 12, silent: 0, logRows48h: 300, killed: 0 },
      errors: { count24h: 5, fatal24h: 0 },
    });
    expect(chip("/system/health", legacy)).toEqual({ label: "healthy", severity: "healthy" });
  });

  it("null payload still renders the em-dash unknown on every live chip", () => {
    for (const href of ["/system/health", "/system/camera", "/system/crons", "/system/ai-cost"]) {
      expect(chip(href, null).severity).toBe("unknown");
    }
  });
});
