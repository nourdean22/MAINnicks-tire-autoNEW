/**
 * The resolver's two pure halves. The arm a visitor REPORTED is a claim from a
 * public beacon; the arm the resolver COUNTS is derived from the visitor id.
 * A forged or double-reported visitor is dropped, and conversions count only
 * when they follow the visitor's first exposure.
 */
import { describe, expect, it } from "vitest";
import { assignByKey } from "../../../shared/experimentKernel";
import { HOME_HERO_SUBLINE, experimentAssignmentKey } from "../../../shared/webExperiments";
import { countConversions, deriveExposures } from "./webExperimentResolve";

const def = HOME_HERO_SUBLINE;
const arms = def.arms.map((a) => a.armId);
const derived = (sid: string) => assignByKey(arms, experimentAssignmentKey(sid, def.experimentId));
const t0 = new Date("2026-09-16T10:00:00Z");
const t1 = new Date("2026-09-16T11:00:00Z");

describe("deriveExposures", () => {
  it("accepts a visitor whose reported arm is the derived arm, rejects a forged one and a double-reporter", () => {
    const honest = "s_honest";
    const forged = "s_forged";
    const double = "s_double";
    const other = (sid: string) => arms.find((a) => a !== derived(sid))!;
    const { accepted, integrity } = deriveExposures(def, [
      { sessionId: honest, reportedArm: derived(honest), firstExposure: t0 },
      { sessionId: forged, reportedArm: other(forged), firstExposure: t0 },
      { sessionId: double, reportedArm: derived(double), firstExposure: t0 },
      { sessionId: double, reportedArm: other(double), firstExposure: t1 },
    ]);
    expect(accepted.get(honest)?.armId).toBe(derived(honest));
    expect(accepted.has(forged)).toBe(false);
    expect(accepted.has(double)).toBe(false);
    expect(integrity).toEqual({ visitors: 3, accepted: 1, rejected: 2 });
  });
  it("positive control: with no tampering every visitor is accepted", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `s_${i.toString(36)}`).map((sid) => ({ sessionId: sid, reportedArm: derived(sid), firstExposure: t0 }));
    const { integrity } = deriveExposures(def, rows);
    expect(integrity).toEqual({ visitors: 200, accepted: 200, rejected: 0 });
  });
});

describe("countConversions", () => {
  it("counts a conversion only after the visitor's first exposure, per derived arm", () => {
    const a = "s_a";
    const b = "s_b";
    const accepted = new Map([
      [a, { armId: derived(a), firstExposure: t1 }],
      [b, { armId: derived(b), firstExposure: t0 }],
    ]);
    const conversions = new Map([[def.primaryMetric, new Map([[a, t0], [b, t1]])]]); // a converted BEFORE exposure, b after
    const counts = countConversions(def, accepted, conversions);
    const total = counts.reduce((n, c) => n + c.conversions[def.primaryMetric], 0);
    expect(total).toBe(1);
    expect(counts.find((c) => c.armId === derived(b))!.conversions[def.primaryMetric]).toBe(1);
    expect(counts.reduce((n, c) => n + c.exposures, 0)).toBe(2);
    for (const c of counts) for (const g of def.guardrails) expect(c.conversions[g.metric]).toBe(0);
  });
});
