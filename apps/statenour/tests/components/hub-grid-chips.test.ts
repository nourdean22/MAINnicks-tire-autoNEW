/**
 * The /system hub chips must not claim health (or counts, or "no devices")
 * off sections the server marked unmeasured. Registered in the 2026-08-04
 * false-green sweep: the quota circuit fed this grid fabricated zeros and
 * hub-grid.tsx printed the word "healthy" in green on a live page.
 *
 * The chips are pure functions of the payload, exported via CARDS.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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
      chip("/brain?tab=memory", payload({ brain: { totalMemories: 0, permanent: 0, avgConfidence: 0, measured: false } }))
        .label,
    ).toBe("unmeasured");
    expect(
      chip(
        "/system/cockpit-observability",
        payload({ ai: { calls24h: 0, costCents7d: 0, measured: false } }),
      ).label,
    ).toBe("unmeasured");
  });

  it("error severity uses calibrated thresholds, never a bare >0 critical", () => {
    // fatal24h counts level='error' since the 2026-08-04 repoint (no writer
    // ever emits 'fatal'; the old >0-critical branch could never fire).
    // Baseline ~12.6/day: an ordinary day stays healthy.
    expect(
      chip("/system/logs?view=errors", payload({ errors: { count24h: 12, fatal24h: 12, measured: true } })),
    ).toEqual({ label: "12 24h", severity: "healthy" });
    // Warning band via count>20.
    expect(
      chip("/system/logs?view=errors", payload({ errors: { count24h: 25, fatal24h: 25, measured: true } }))
        .severity,
    ).toBe("warning");
    // Critical only at >=40 errors/24h (~3x mean).
    expect(
      chip("/system/logs?view=errors", payload({ errors: { count24h: 41, fatal24h: 40, measured: true } })),
    ).toEqual({ label: "40 errors 24h", severity: "critical" });
    // Diagnostics degrades on warning-level volume, not the dead fatal branch.
    expect(
      chip("/system/health", payload({ errors: { count24h: 25, fatal24h: 25, measured: true } })),
    ).toEqual({ label: "degraded", severity: "warning" });
    expect(
      chip("/system/health", payload({ errors: { count24h: 12, fatal24h: 12, measured: true } })),
    ).toEqual({ label: "healthy", severity: "healthy" });
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

describe("two calibrations, two names (10-X3 = 02-X1)", () => {
  const card = () => {
    const c = CARDS.find((x) => x.href === "/system/calibration");
    if (!c) throw new Error("no /system/calibration card");
    return c;
  };

  it("the /system/calibration card is named for what the page shows", () => {
    expect(card().title).toBe("State Calibration");
    expect(card().description).not.toMatch(/prediction|coverage|drift/i);
  });

  it("the page points to where prediction accuracy actually lives", () => {
    const src = readFileSync("app/(mastery)/system/calibration/page.tsx", "utf8");
    expect(src).toContain('href="/stats?tab=calibration"');
  });

  it("the palette entry drops the keywords that belong to the other page", () => {
    const src = readFileSync("components/command-palette.tsx", "utf8");
    const line = src.split("\n").find((l) => l.includes('id: "sys-calibration"')) ?? "";
    expect(line).toContain("State Calibration");
    expect(line).not.toMatch(/drift|coverage|"lens"|accuracy/i);
  });

  it("the health page no longer sends the strategic-lens card to /system/calibration", () => {
    const src = readFileSync("app/(mastery)/system/health/page.tsx", "utf8");
    const at = src.search(/strategic lens [^\n]{1,4}\{data\.range\}/);
    expect(at).toBeGreaterThan(-1); // anchor on the strategic-lens header, or this check scans nothing
    expect(src.slice(at, at + 400)).not.toContain('href="/system/calibration"');
  });
});
