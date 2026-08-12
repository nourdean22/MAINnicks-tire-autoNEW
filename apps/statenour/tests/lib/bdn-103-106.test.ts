/**
 * BDN-103..106 · the four scan findings shipped 2026-08-12 night.
 *
 * Each pin targets the specific way its feature could silently rot:
 *   103 · a tool bias naming a tool that does not exist (worse than no
 *         bias — it steers the model at nothing), and the prefix-match
 *         bug that adding a "/" key would have introduced.
 *   104 · counts that read as "unused" when they mean "unmeasured".
 *   105 · a skip reason vanishing from the totals when the gate adds one.
 *   106 · an unresolved commitment being graded as a hit or a miss.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOL_BIAS, resolveToolBiasKey } from "@/app/api/ai/chat/context-hints";
import { summarizeHomeSignals } from "@/lib/observability/home-decision-metrics";
import { summarizeGateRuns, summarizeCalibration } from "@/lib/brain/judgment-quality";

describe("BDN-103 · surface-aware tool bias", () => {
  it("names ONLY tools that exist in the live catalog", () => {
    // The catalog is the registry the chat route actually builds from;
    // reading it here means a renamed/deleted tool fails this test
    // instead of silently steering the model at nothing.
    const catalog = readFileSync(
      join(process.cwd(), "lib/ai/tools/catalog.ts"),
      "utf8",
    );
    const realTools = new Set(
      [...catalog.matchAll(/name: "([a-zA-Z_]+)"/g)].map((m) => m[1]),
    );
    expect(realTools.size).toBeGreaterThan(50); // guard the extractor itself

    const missing: string[] = [];
    for (const [route, list] of Object.entries(TOOL_BIAS)) {
      for (const tool of list.split("·").map((s) => s.trim())) {
        if (!realTools.has(tool)) missing.push(`${route} → ${tool}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("matches the LONGEST prefix, so the '/' entry cannot swallow other routes", () => {
    // With the old `Object.keys().find(startsWith)` this was true only
    // by key-insertion accident.
    expect(resolveToolBiasKey("/missions")).toBe("/missions");
    expect(resolveToolBiasKey("/journal")).toBe("/journal");
    expect(resolveToolBiasKey("/brain?tab=continuity")).toBe("/brain");
    expect(resolveToolBiasKey("/system/fleet")).toBe("/system");
    expect(resolveToolBiasKey("/content")).toBe("/content");
  });

  it("falls back to Home's read-oriented bias only for genuinely unmapped routes", () => {
    expect(resolveToolBiasKey("/")).toBe("/");
    expect(resolveToolBiasKey("/settings")).toBe("/");
    // And Home's bias must stay read-oriented — never mint work from the
    // decision surface.
    expect(TOOL_BIAS["/"]).not.toMatch(/createTask|setMit|sendTelegram/);
  });
});

describe("BDN-104 · Home decision signals", () => {
  const d = (iso: string) => new Date(iso);

  it("says UNMEASURED, not unused, at zero", () => {
    const m = summarizeHomeSignals([], 7);
    expect(m.total).toBe(0);
    expect(m.underSampled).toBe(true);
    expect(m.note).toMatch(/unmeasured, not unused/i);
  });

  it("separates verdicts from resumes and counts active days", () => {
    const m = summarizeHomeSignals(
      [
        { kind: "verdict_accept", createdAt: d("2026-08-12T10:00:00Z") },
        { kind: "verdict_dismiss", createdAt: d("2026-08-12T11:00:00Z") },
        { kind: "followup_convert", createdAt: d("2026-08-11T09:00:00Z") },
        { kind: "resume_tap", createdAt: d("2026-08-11T09:30:00Z") },
      ],
      7,
    );
    expect(m.verdicts).toBe(3);
    expect(m.resumes).toBe(1);
    expect(m.activeDays).toBe(2);
  });

  it("flags a thin record rather than reporting it as a measurement", () => {
    const m = summarizeHomeSignals(
      [{ kind: "resume_tap", createdAt: d("2026-08-12T10:00:00Z") }],
      7,
    );
    expect(m.underSampled).toBe(true);
    expect(m.note).toMatch(/anecdote/i);
  });
});

describe("BDN-105 · wisdom-gate SPC", () => {
  const run = (iso: string, result: string, reason: string | null = null) => ({
    createdAt: new Date(iso),
    result,
    reason,
  });

  it("splits promotions, gate rejections and dupe skips into week buckets", () => {
    const spc = summarizeGateRuns([
      run("2026-08-12T03:00:00Z", "success"),
      run("2026-08-12T03:00:00Z", "skipped", "gate_not_wisdom_shaped"),
      run("2026-08-11T03:00:00Z", "skipped", "wisdom_dupe"),
      run("2026-08-04T03:00:00Z", "success"),
    ]);
    expect(spc.totals.promoted).toBe(2);
    expect(spc.totals.gateRejected).toBe(1);
    expect(spc.totals.dupeSkipped).toBe(1);
    expect(spc.weeks).toHaveLength(2);
    expect(spc.weeks[0].weekStart > spc.weeks[1].weekStart).toBe(true); // newest first
  });

  it("counts an UNKNOWN future skip reason as a gate rejection — never drops it", () => {
    const spc = summarizeGateRuns([run("2026-08-12T03:00:00Z", "skipped", "gate_some_new_rule_2027")]);
    expect(spc.totals.gateRejected).toBe(1);
    expect(spc.totals.total).toBe(1);
  });

  it("declares itself under-sampled at low run counts", () => {
    expect(summarizeGateRuns([run("2026-08-12T03:00:00Z", "success")]).underSampled).toBe(true);
  });

  it("counts PARKED attempts separately and never reads them as process data", () => {
    // Caught by the 2026-08-12 prod probe: every memory_promotion row in
    // the window was pending_approval (the deadlock). Dropping them made
    // the summary claim adequate sampling for a gate that never ran.
    const spc = summarizeGateRuns([
      ...Array.from({ length: 30 }, () => run("2026-08-12T03:00:00Z", "pending_approval")),
    ]);
    expect(spc.totals.parked).toBe(30);
    expect(spc.totals.total).toBe(30);
    expect(spc.decided).toBe(0);
    expect(spc.underSampled).toBe(true); // an un-run gate is NOT well-sampled
    expect(spc.totals.promoted + spc.totals.gateRejected + spc.totals.dupeSkipped).toBe(0);
  });

  it("a null result is parked, not silently dropped", () => {
    const spc = summarizeGateRuns([
      { createdAt: new Date("2026-08-12T03:00:00Z"), result: null, reason: null },
    ]);
    expect(spc.totals.parked).toBe(1);
    expect(spc.totals.total).toBe(1);
  });
});

describe("BDN-106 · stated-confidence calibration", () => {
  it("reports honest n=0 instead of an empty table", () => {
    const r = summarizeCalibration([]);
    expect(r.totalResolved).toBe(0);
    expect(r.underSampled).toBe(true);
    expect(r.note).toMatch(/Nothing to grade/i);
    expect(r.bands.every((b) => b.hitRate === null)).toBe(true);
  });

  it("NEVER grades an unresolved commitment as a hit or a miss", () => {
    const r = summarizeCalibration([
      { band: "HIGH", status: "active" },
      { band: "HIGH", status: "proposed" },
      { band: "HIGH", status: "accepted" },
    ]);
    const high = r.bands.find((b) => b.band === "HIGH");
    expect(high?.resolved).toBe(0);
    expect(high?.unresolved).toBe(3);
    expect(high?.hitRate).toBeNull();
  });

  it("scores completed/verified as kept and abandoned/expired as missed", () => {
    const rows = [
      ...Array(6).fill({ band: "HIGH" as const, status: "completed" }),
      ...Array(2).fill({ band: "HIGH" as const, status: "abandoned" }),
      ...Array(1).fill({ band: "LOW" as const, status: "verified" }),
      ...Array(3).fill({ band: "LOW" as const, status: "expired" }),
    ];
    const r = summarizeCalibration(rows);
    expect(r.totalResolved).toBe(12);
    expect(r.underSampled).toBe(false);
    expect(r.bands.find((b) => b.band === "HIGH")?.hitRate).toBeCloseTo(0.75);
    expect(r.bands.find((b) => b.band === "LOW")?.hitRate).toBeCloseTo(0.25);
  });

  it("refuses to call a handful of outcomes calibration", () => {
    const r = summarizeCalibration([
      { band: "HIGH", status: "completed" },
      { band: "HIGH", status: "abandoned" },
    ]);
    expect(r.underSampled).toBe(true);
    expect(r.note).toMatch(/noise/i);
  });
});
