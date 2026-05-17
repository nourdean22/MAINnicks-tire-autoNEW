/**
 * data-source-health probe tests · v10.0.58.
 *
 * Locks the contract for the Wave B canary system. The probes run
 * unattended on a 6-hourly cron, so a regression here would silently
 * stop the canary — defeating the purpose. Tests focus on the
 * structural contract (every probe is well-formed, the runner
 * aggregates the documented shape, broken probes don't crash the
 * loop) rather than specific mock counts (which would couple the
 * test to demo-mode side effects in the imported modules).
 */

import { describe, it, expect, vi } from "vitest";

// Mock prisma BEFORE importing the module under test so the upsert
// calls inside runHealthProbes are no-ops, not real DB writes.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: vi.fn().mockResolvedValue({ id: "mock" }),
    },
  },
}));

import {
  runHealthProbes,
  getProbeSpecs,
  type ProbeSpec,
} from "@/lib/contracts/data-source-health";

describe("data-source-health", () => {
  it("exposes probe specs without the runner function", () => {
    const specs = getProbeSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(7);
    for (const s of specs) {
      // Probe names are dot-separated namespaces (e.g.
      // "legacy.scoreSnapshots"). Allow camelCase after the dot.
      expect(s.name).toMatch(/^[a-z][a-zA-Z._]+$/);
      expect(s.label).toBeTruthy();
      expect(["personal", "shop", "bridge"]).toContain(s.kind);
      expect(s.emptyDaysAlertThreshold).toBeGreaterThan(0);
      expect((s as { probe?: unknown }).probe).toBeUndefined();
    }
  });

  it("registers probes in all three kinds (personal, shop, bridge)", () => {
    const specs = getProbeSpecs() as Array<Pick<ProbeSpec, "kind">>;
    const kinds = new Set(specs.map((s) => s.kind));
    expect(kinds.has("personal")).toBe(true);
    expect(kinds.has("bridge")).toBe(true);
    expect(kinds.has("shop")).toBe(true);
  });

  it("runs every probe and returns the documented summary shape", async () => {
    const summary = await runHealthProbes();
    expect(summary.total).toBeGreaterThanOrEqual(7);
    expect(summary.total).toBe(summary.results.length);
    expect(summary.ok + summary.failed).toBe(summary.total);
    // empty is a subset of ok (probes that succeeded but returned zero rows)
    expect(summary.empty).toBeGreaterThanOrEqual(0);
    expect(summary.empty).toBeLessThanOrEqual(summary.ok);
  });

  it("each result carries name + kind + ok + rowCount + latencyMs", async () => {
    const summary = await runHealthProbes();
    for (const r of summary.results) {
      expect(typeof r.ok).toBe("boolean");
      expect(typeof r.rowCount).toBe("number");
      expect(r.rowCount).toBeGreaterThanOrEqual(0);
      expect(typeof r.latencyMs).toBe("number");
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.name).toMatch(/^[a-z][a-zA-Z._]+$/);
      expect(["personal", "shop", "bridge"]).toContain(r.kind);
    }
  });

  it("every spec name is unique (no duplicate probe registrations)", () => {
    const specs = getProbeSpecs();
    const names = specs.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
