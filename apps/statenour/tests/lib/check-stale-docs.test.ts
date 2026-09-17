import { describe, it, expect } from "vitest";
import {
  scanContent,
  fileIsHistorical,
  STALE_TERMS,
  SAFE_CONTEXT_WORDS,
  checkDateSynchronization,
  daysBetween,
} from "../../scripts/check-stale-docs";

describe("check-stale-docs guard", () => {
  describe("dataset", () => {
    it("represents the forbidden retired-deploy claims as critical", () => {
      const critical = STALE_TERMS.filter((t) => t.severity === "critical").map((t) =>
        t.term.toLowerCase(),
      );
      for (const must of [
        "codex/ollama-local",
        "statenour-master",
        "deploys to vercel",
        "github.com/nourdean22/statenour-os",
        "c:\\users\\nourd\\nour-os",
      ]) {
        expect(critical).toContain(must);
      }
    });

    it("treats provider hardcodes as warn, not critical", () => {
      const glm = STALE_TERMS.find((t) => t.term === "GLM-4.7");
      expect(glm?.severity).toBe("warn");
    });

    it("has no duplicate terms", () => {
      const terms = STALE_TERMS.map((t) => t.term.toLowerCase());
      expect(new Set(terms).size).toBe(terms.length);
    });
  });

  describe("file-level exemption", () => {
    it("exempts anything under docs/archive/**", () => {
      const stale = "Push to BOTH codex/ollama-local AND statenour-master.";
      expect(fileIsHistorical("docs/archive/historical-v7/x.md", stale)).toBe(true);
      expect(scanContent("docs/archive/historical-v7/x.md", stale)).toEqual([]);
    });

    it("exempts dated snapshot filenames (YYYY-MM-DD)", () => {
      expect(fileIsHistorical("docs/cohort-2026-05-08-eod.md", "deploys to Vercel")).toBe(true);
    });

    it("exempts ADRs (immutable decision records)", () => {
      expect(fileIsHistorical("docs/adr/0003-foo.md", "codex/ollama-local")).toBe(true);
    });

    it("exempts files whose header carries a historical banner", () => {
      const content = "# Old Plan\n> HISTORICAL — do not execute.\n\nPush to codex/ollama-local.";
      expect(fileIsHistorical("docs/project/OLD.md", content)).toBe(true);
    });

    it("does NOT exempt a normal active doc", () => {
      expect(fileIsHistorical("docs/RUNBOOK.md", "some current content")).toBe(false);
    });
  });

  describe("scanning active docs", () => {
    it("flags a critical term stated as a current instruction", () => {
      const findings = scanContent("docs/RUNBOOK.md", "Deploy by pushing to codex/ollama-local.");
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("critical");
      expect(findings[0].term).toBe("codex/ollama-local");
      expect(findings[0].line).toBe(1);
    });

    it("exempts a stale term when the same line carries a safe word", () => {
      const findings = scanContent(
        "docs/RUNBOOK.md",
        "The codex/ollama-local branch is retired — never push there.",
      );
      expect(findings).toEqual([]);
    });

    it("exempts a stale term when 'retired' wraps onto a nearby line (±2)", () => {
      const content = [
        "The standalone statenour-os repo, the codex/ollama-local",
        "branch, and Vercel are all retired.",
      ].join("\n");
      expect(scanContent("docs/AGENT-CONTRACT.md", content)).toEqual([]);
    });

    it("classifies a provider hardcode as a warn finding", () => {
      const findings = scanContent("docs/ARCHITECTURE.md", "We run GLM-4.7 as the model.");
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("warn");
    });

    it("returns nothing for a clean active doc", () => {
      const clean = "Statenour deploys from main to Railway, served at bdnick.info.";
      expect(scanContent("docs/CURRENT-TRUTH.md", clean)).toEqual([]);
    });
  });

  it("exposes the documented safe-context words", () => {
    for (const w of ["historical", "retired", "archived", "obsolete"]) {
      expect(SAFE_CONTEXT_WORDS).toContain(w);
    }
  });
});

/**
 * The READ-FIRST doc's stamp now has a consumer.
 *
 * Until 2026-09-17 nothing checked `docs/CURRENT-TRUTH.md`'s "Last verified"
 * date. It sat at 2026-09-02 through two waves and eleven merged PRs —
 * ACCURATE, but missing a behavioural change to tool selection and the fact
 * that `/api/version`, not `/api/health`, is the public deploy-truth endpoint.
 * A stamp nobody reads is the producer-without-consumer shape this repo keeps
 * rediscovering; these tests are the consumer, and the canary below is what
 * stops it from being a decorative one.
 *
 * DRIFT BUDGET, not equality — and that distinction is load-bearing. AGENTS.md
 * is a wave stamp and must MATCH the ship log exactly. CURRENT-TRUTH is a
 * "where am I" snapshot that does not need re-verifying every wave; demanding
 * equality would keep it permanently red and train people to bump the date
 * without reading the doc, which is worse than having no gate at all.
 */
describe("CURRENT-TRUTH staleness", () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");

  /** A minimal app root: AGENTS.md + the two dated docs. */
  function fixture(truthDate: string, reconDate: string, agentsDate = reconDate): string {
    const dir = mkdtempSync(p.join(os.tmpdir(), "stale-docs-"));
    mkdirSync(p.join(dir, "docs"), { recursive: true });
    writeFileSync(p.join(dir, "AGENTS.md"), `**Last refreshed:** ${agentsDate}\n`);
    writeFileSync(p.join(dir, "docs/RECONCILIATION.md"), `**Last verified:** ${reconDate}\n`);
    writeFileSync(p.join(dir, "docs/CURRENT-TRUTH.md"), `> Last verified **${truthDate}**.\n`);
    return dir;
  }

  const truthFindings = (dir: string) =>
    checkDateSynchronization(dir).filter((f) => f.file === "docs/CURRENT-TRUTH.md");

  it("daysBetween counts whole days forward", () => {
    expect(daysBetween("2026-09-02", "2026-09-17")).toBe(15);
    expect(daysBetween("2026-09-17", "2026-09-17")).toBe(0);
  });

  it("POSITIVE CONTROL: a freshly stamped read-first doc reports nothing", () => {
    // Without this, a rule that fired on everything would satisfy the canary
    // below while making the gate useless.
    const dir = fixture("2026-09-17", "2026-09-17");
    try {
      expect(truthFindings(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolerates drift INSIDE the budget — a snapshot need not track every wave", () => {
    const dir = fixture("2026-09-10", "2026-09-17"); // 7 days
    try {
      expect(truthFindings(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CANARY: it FIRES past the budget — the exact 15-day drift that prompted it", () => {
    const dir = fixture("2026-09-02", "2026-09-17"); // the real case
    try {
      const found = truthFindings(dir);
      expect(found).toHaveLength(1);
      expect(found[0].text).toContain("15 days behind");
      expect(found[0].severity).toBe("warn");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escalates to CRITICAL at double the budget", () => {
    const dir = fixture("2026-08-10", "2026-09-17"); // 38 days
    try {
      expect(truthFindings(dir)[0].severity).toBe("critical");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a MISSING stamp rather than treating it as fresh", () => {
    // An absent stamp must not read as zero drift — the same distinction the
    // rest of this codebase draws between a missing row and a measured zero.
    const dir = fixture("2026-09-17", "2026-09-17");
    try {
      writeFileSync(p.join(dir, "docs/CURRENT-TRUTH.md"), "no stamp here\n");
      const found = truthFindings(dir);
      expect(found).toHaveLength(1);
      expect(found[0].term).toBe("Last verified");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the LIVE doc is inside the budget right now", () => {
    // The gate ships green, not as a cleanup project.
    expect(truthFindings(process.cwd())).toEqual([]);
  });
});
