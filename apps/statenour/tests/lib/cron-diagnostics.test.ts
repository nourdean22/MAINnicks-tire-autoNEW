/**
 * tests/lib/cron-diagnostics.test.ts — collectDiagnoses contract
 *
 * Locks down the branch coverage + ordering of the cron diagnosis
 * rollup. Prevents regressions like:
 *   - missing CRON_SECRET goes unreported
 *   - silent-cron warning fires when everything is actually healthy
 *   - a cleanly-running system returns an empty diagnosis list
 *     (UI would show a blank panel instead of the "all clear" info)
 */

import { describe, it, expect } from "vitest";
import {
  collectDiagnoses,
  type DiagnosisContext,
} from "@/lib/system/cron-diagnostics";

function healthy(partial: Partial<DiagnosisContext> = {}): DiagnosisContext {
  return {
    cronSecretPresent: true,
    pauseAllCrons: false,
    killedIndividually: [],
    googleOauth: true,
    declaredCount: 32,
    silent: [],
    totalLogRowsLast48h: 500,
    ...partial,
  };
}

describe("collectDiagnoses", () => {
  it("returns a single info diagnosis when everything is healthy", () => {
    const d = collectDiagnoses(healthy());
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe("info");
    expect(d[0].headline).toMatch(/no obvious/i);
  });

  it("flags missing CRON_SECRET as critical", () => {
    const d = collectDiagnoses(healthy({ cronSecretPresent: false }));
    const crit = d.filter((x) => x.severity === "critical");
    expect(crit.length).toBeGreaterThan(0);
    expect(crit[0].headline).toMatch(/CRON_SECRET/i);
  });

  it("flags pauseAllCrons as critical", () => {
    const d = collectDiagnoses(healthy({ pauseAllCrons: true }));
    expect(d.find((x) => /pauseAllCrons/i.test(x.headline))?.severity).toBe(
      "critical",
    );
  });

  it("flags individually-killed crons as warning with names", () => {
    const d = collectDiagnoses(
      healthy({
        killedIndividually: [
          { jobName: "ingest-drive", note: null, updatedAt: null },
          { jobName: "extract-skills", note: null, updatedAt: null },
        ],
      }),
    );
    const warn = d.find((x) => /individually disabled/i.test(x.headline));
    expect(warn?.severity).toBe("warning");
    expect(warn?.headline).toMatch(/2 crons/);
    expect(warn?.detail).toContain("ingest-drive");
    expect(warn?.detail).toContain("extract-skills");
  });

  it("singularizes the killed-cron label at exactly 1 cron", () => {
    const d = collectDiagnoses(
      healthy({
        killedIndividually: [
          { jobName: "extract-skills", note: null, updatedAt: null },
        ],
      }),
    );
    const warn = d.find((x) => /individually disabled/i.test(x.headline));
    expect(warn?.headline).toBe("1 cron individually disabled");
  });

  it("flags missing Google OAuth as warning", () => {
    const d = collectDiagnoses(healthy({ googleOauth: false }));
    expect(
      d.find((x) => /Google OAuth/i.test(x.headline))?.severity,
    ).toBe("warning");
  });

  it("flags a high active-cron count as a sprawl warning", () => {
    const d = collectDiagnoses(healthy({ declaredCount: 42 }));
    const warn = d.find((x) => /heavy cron surface/.test(x.headline));
    expect(warn?.severity).toBe("warning");
    expect(warn?.headline).toMatch(/42 active crons/);
  });

  it("does NOT flag declaredCount at exactly 40", () => {
    const d = collectDiagnoses(healthy({ declaredCount: 40 }));
    expect(d.find((x) => /heavy cron surface/.test(x.headline))).toBeUndefined();
  });

  it("flags silent crons as warning with name preview", () => {
    const d = collectDiagnoses(
      healthy({ silent: ["ingest-drive", "ingest-gmail", "ingest-calendar"] }),
    );
    const warn = d.find((x) => /NOT logged/i.test(x.headline));
    expect(warn?.severity).toBe("warning");
    expect(warn?.headline).toMatch(/^3 declared crons/);
    expect(warn?.detail).toContain("ingest-drive");
  });

  it("truncates silent-cron name preview at 10 with ellipsis", () => {
    const many = Array.from({ length: 15 }, (_, i) => `cron-${i}`);
    const d = collectDiagnoses(healthy({ silent: many }));
    const warn = d.find((x) => /NOT logged/i.test(x.headline));
    expect(warn?.detail).toContain("…");
    expect(warn?.detail).toContain("cron-0");
    expect(warn?.detail).toContain("cron-9");
    expect(warn?.detail).not.toContain("cron-11");
  });

  it("flags zero log rows as critical (cron infra silent)", () => {
    const d = collectDiagnoses(healthy({ totalLogRowsLast48h: 0 }));
    expect(
      d.find((x) => /ZERO CronJobLog/i.test(x.headline))?.severity,
    ).toBe("critical");
  });

  it("does NOT emit the 'all healthy' info when any diagnosis fires", () => {
    const d = collectDiagnoses(
      healthy({ googleOauth: false, silent: ["ingest-drive"] }),
    );
    expect(d.find((x) => /no obvious/i.test(x.headline))).toBeUndefined();
  });

  it("stacks multiple diagnoses in declared order (critical first)", () => {
    // Trigger CRON_SECRET (critical) + OAuth (warning) + zero-logs (critical)
    // and verify the order matches the declared sequence.
    const d = collectDiagnoses(
      healthy({
        cronSecretPresent: false,
        googleOauth: false,
        totalLogRowsLast48h: 0,
      }),
    );
    // First critical should be the CRON_SECRET one (earliest in the rollup).
    expect(d[0].headline).toMatch(/CRON_SECRET/);
    // OAuth warning should come before zero-logs critical in THIS order
    // because that's the authoring order in collectDiagnoses — deterministic.
    const oauthIdx = d.findIndex((x) => /Google OAuth/i.test(x.headline));
    const zeroIdx = d.findIndex((x) => /ZERO/i.test(x.headline));
    expect(oauthIdx).toBeGreaterThan(-1);
    expect(zeroIdx).toBeGreaterThan(oauthIdx);
  });
});
