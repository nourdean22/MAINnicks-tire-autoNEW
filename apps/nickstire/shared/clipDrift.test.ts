/**
 * Clip drift is a difference from the provider's OWN recent clips (2026-10-08):
 * no baseline, no verdict; a shape or length that departs from the mode is
 * named per job and beat.
 */
import { describe, expect, it } from "vitest";
import { clipDriftReport, type ClipProbe } from "./clipDrift";

const probe = (jobId: number, beatNumber: number, over: Partial<ClipProbe> = {}): ClipProbe & { jobId: number } => ({
  jobId, beatNumber, provider: "higgsfield", width: 1080, height: 1920, fps: 24, durationSec: 5.0, ...over,
});

describe("clipDriftReport", () => {
  it("names the clips that differ from the provider's modal shape or length", () => {
    const probes = [
      probe(1, 1), probe(1, 2), probe(1, 3), probe(2, 1), probe(2, 2),
      probe(2, 3, { width: 720, height: 1280 }),
      probe(3, 1, { durationSec: 3.2 }),
      probe(3, 2, { durationSec: 5.4 }), // within tolerance
    ];
    const [r] = clipDriftReport(probes);
    expect(r.provider).toBe("higgsfield");
    expect(r.baseline).toBe("1080x1920@24");
    expect(r.baselineDurationSec).toBe(5);
    expect(r.total).toBe(8);
    expect(r.drifted).toEqual([
      { jobId: 2, beatNumber: 3, signature: "720x1280@24", durationSec: 5 },
      { jobId: 3, beatNumber: 1, signature: "1080x1920@24", durationSec: 3.2 },
    ]);
  });

  it("fewer than 5 clips is no baseline, not drift; local renders are never reported", () => {
    expect(clipDriftReport([probe(1, 1), probe(1, 2, { width: 720, height: 1280 }), probe(1, 3), probe(1, 4)])).toEqual([]);
    const local = Array.from({ length: 8 }, (_, i) => probe(1, i + 1, { provider: "local", width: i % 2 ? 720 : 1080 }));
    expect(clipDriftReport(local)).toEqual([]);
  });

  it("a uniform window reports a baseline with nothing drifted", () => {
    const [r] = clipDriftReport(Array.from({ length: 6 }, (_, i) => probe(1, i + 1)));
    expect(r.drifted).toEqual([]);
    expect(r.total).toBe(6);
  });

  it("an unknown frame count is part of the signature, never a silent match", () => {
    const probes = [...Array.from({ length: 5 }, (_, i) => probe(1, i + 1)), probe(2, 1, { fps: null })];
    expect(clipDriftReport(probes)[0].drifted).toEqual([{ jobId: 2, beatNumber: 1, signature: "1080x1920@?", durationSec: 5 }]);
  });
});
