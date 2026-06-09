import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RUNBOOKS } from "../../lib/runbooks/catalog";
import { scanContent } from "../../scripts/check-stale-docs";

const REQUIRED_IDS = [
  "statenour-current-truth",
  "statenour-claude-code-session",
  "statenour-migrations-and-deploys",
  "task-classifier-domain-missions",
  "stale-doc-cleanup",
  "action-honesty-and-receipts",
  "memory-evals",
  "nickstire-vs-statenour-boundary",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("agent runbooks", () => {
  it("has unique ids", () => {
    const ids = RUNBOOKS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the required active runbooks", () => {
    const active = new Set(RUNBOOKS.filter((r) => r.status === "active").map((r) => r.id));
    for (const id of REQUIRED_IDS) expect(active).toContain(id);
  });

  it("every active runbook has required fields + a valid lastVerified", () => {
    for (const r of RUNBOOKS.filter((x) => x.status === "active")) {
      expect(r.title.trim()).not.toBe("");
      expect(r.whenToUse.trim()).not.toBe("");
      expect(r.sourceOfTruth.length).toBeGreaterThan(0);
      expect(r.rules.length).toBeGreaterThan(0);
      expect(r.verification.length).toBeGreaterThan(0);
      expect(r.rollback.trim()).not.toBe("");
      expect(r.owner.trim()).not.toBe("");
      expect(DATE_RE.test(r.lastVerified)).toBe(true);
    }
  });

  it("every docPath markdown exists", () => {
    for (const r of RUNBOOKS) {
      expect(fs.existsSync(path.resolve(process.cwd(), r.docPath))).toBe(true);
    }
  });

  it("every relatedFile resolves (unless external:/manual:)", () => {
    for (const r of RUNBOOKS) {
      for (const f of r.relatedFiles) {
        if (f.startsWith("external:") || f.startsWith("manual:")) continue;
        expect(fs.existsSync(path.resolve(process.cwd(), f)), `${r.id}: ${f}`).toBe(true);
      }
    }
  });

  it("no active runbook states a retired deploy fact as current", () => {
    for (const r of RUNBOOKS.filter((x) => x.status === "active")) {
      const content = fs.readFileSync(path.resolve(process.cwd(), r.docPath), "utf8");
      const criticals = scanContent(r.docPath, content).filter((f) => f.severity === "critical");
      expect(criticals, `${r.id} criticals: ${JSON.stringify(criticals)}`).toEqual([]);
    }
  });
});
