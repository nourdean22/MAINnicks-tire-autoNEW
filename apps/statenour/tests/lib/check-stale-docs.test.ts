import { describe, it, expect } from "vitest";
import {
  scanContent,
  fileIsHistorical,
  STALE_TERMS,
  SAFE_CONTEXT_WORDS,
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
