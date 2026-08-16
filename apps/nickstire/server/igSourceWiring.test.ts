/**
 * Wiring pins for evidence-first Create.
 *
 * Every defect below was SILENT: each produced a plausible-looking screen (an
 * empty record list, a passing quality score, a fresh wizard step) while the
 * underlying fact was wrong. None of them would fail a behavioural test that
 * merely exercised the path, so these assert the MECHANISM at the source level.
 *
 * Anchors are code-shaped strings that cannot appear in prose — the lesson
 * recorded in igEvidence.test.ts, where naive comment-stripping ate real code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildEvalArgs, evaluateInstagramDraft } from "./services/instagramStudio";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the source picker must not read a column nothing writes", () => {
  const router = read("server/routers/instagramStudio.ts");
  const sourceOptions = router.slice(
    router.indexOf("sourceOptions: adminProcedure"),
    router.indexOf("evaluate: adminProcedure"),
  );

  it("does NOT filter declined work on work_order_items.declined", () => {
    // Nothing in this repo sets that column true: workOrderService inserts with
    // the false default, and declinedWorkRecovery sets it to FALSE on recovery.
    // Reading it made the picker permanently empty.
    expect(sourceOptions).not.toContain("workOrderItems.declined");
  });

  it("reads the CANONICAL declined lane (alg_estimates, unmatched)", () => {
    expect(sourceOptions).toContain("algEstimates.estimateDate");
    expect(sourceOptions).toContain("IS NULL");
  });

  it("never selects customer name or phone into a picker that feeds a prompt", () => {
    expect(sourceOptions).not.toContain("algEstimates.customerName");
    expect(sourceOptions).not.toContain("algEstimates.customerPhone");
  });

  it("reports per-lane availability so a read failure cannot render as 'none found'", () => {
    expect(sourceOptions).toContain('.status = "unavailable"');
    expect(sourceOptions).toContain("availability: {");
  });

  it("has no bare swallow-everything catch left in the lanes", () => {
    // `catch { /* honest empty */ }` was the exact construct that made a broken
    // table read indistinguishable from a verified absence.
    expect(sourceOptions).not.toMatch(/catch\s*\{\s*\/\*[^*]*\*\/\s*\}/);
  });
});

describe("resolveSourceProvenance must distinguish unavailable from empty", () => {
  const src = read("server/services/reelBriefGen.ts");
  const fn = src.slice(
    src.indexOf("export async function resolveSourceProvenance"),
    src.indexOf("function operatorFacts"),
  );

  it("no bare `catch (e) {}` — a thrown lookup used to read as 'no such row'", () => {
    expect(fn).not.toMatch(/catch\s*\(e\)\s*\{\s*\}/);
  });

  it("returns an availability verdict on the terminal fallthrough", () => {
    expect(fn).toContain('lookupFailed ? "source_unavailable" : "verified_empty"');
  });

  it("states the RECORDED fact for ALG declines, never the inferred refusal", () => {
    // alg_estimates has no `declined` column; the decline is inferred from
    // matched_invoice_id IS NULL. Asserting a customer refusal from that is
    // fabrication, so the assertion text must describe the unmatched estimate.
    expect(fn).toContain("has no matching paid invoice");
    expect(fn).not.toMatch(/customer declined/i);
  });

  it("marks the decline inference with basis `inferred`", () => {
    const facts = src.slice(src.indexOf("function algDeclinedFacts"), src.indexOf("function workOrderItemFacts"));
    expect(facts).toContain('basis: "inferred"');
  });
});

describe("the quality gate must be able to SEE the evidence it scores", () => {
  it("buildEvalArgs forwards evidenceFacts (it previously dropped them)", () => {
    const args = buildEvalArgs({
      source: { type: "review" },
      format: "post",
      caption: "c",
      headline: "h",
      subheadline: "s",
      artDirection: "",
      conceptKey: "k",
      cta: "cta",
      carouselSlides: [],
      evidenceFacts: [
        { key: "vehicle", label: "Vehicle", value: "2018 Ford Escape", role: "anchor", basis: "recorded" },
      ],
    });
    expect(args.evidenceFacts).toHaveLength(1);
  });

  it("typing one character no longer earns the grounding score of a real record", () => {
    const base = {
      format: "post" as const,
      caption: "Check your tread before the first Cleveland snow. Walk in, we will look.",
      headline: "Tread check",
      subheadline: "Two minutes",
      artDirection: "",
      cta: "Walk in",
      carouselSlides: [],
    };
    const typed = evaluateInstagramDraft({
      ...base,
      source: { type: "season_weather", detail: "x" },
    });
    const grounded = evaluateInstagramDraft({
      ...base,
      source: { type: "season_weather", detail: "x" },
      evidenceFacts: [
        { key: "q", label: "Review quote", value: "Mike showed me exactly why the tire could not be safely patched", role: "quote", basis: "recorded" },
      ],
    });
    const score = (r: ReturnType<typeof evaluateInstagramDraft>) =>
      r.dimensions.find((d) => d.key === "source_grounding")!.score;

    expect(score(typed)).toBeLessThan(score(grounded));
    // And the weak one must carry an actionable finding, not a generic nudge.
    expect(r_finding(typed)).toMatch(/no concrete evidence/i);
  });
});

function r_finding(r: ReturnType<typeof evaluateInstagramDraft>): string {
  return r.dimensions.find((d) => d.key === "source_grounding")!.finding ?? "";
}

describe("the reel wizard inherits the already-chosen record", () => {
  it("StudioV2 passes initialSource into the Advanced Reel Studio", () => {
    const v2 = read("client/src/pages/admin/instagram/StudioV2.tsx");
    // Was a bare `<LegacyStudio />`, which dropped the selected record.
    expect(v2).not.toMatch(/<LegacyStudio\s*\/>/);
    expect(v2).toContain("initialSource={{");
  });

  it("Studio.tsx accepts it and opens past the source step", () => {
    const studio = read("client/src/pages/admin/instagram/Studio.tsx");
    expect(studio).toContain("initialSource?: { type: string; recordId?: string; detail?: string }");
    expect(studio).toContain('useState<Step>(inherited ? "format" : "source")');
  });

  it("Studio.tsx offers real records instead of a raw ID box", () => {
    const studio = read("client/src/pages/admin/instagram/Studio.tsx");
    expect(studio).toContain("trpc.instagramStudio.sourceOptions.useQuery");
    // The literal ID-hunting label and its placeholder are gone.
    expect(studio).not.toContain("Concrete Record ID");
    expect(studio).not.toContain('placeholder="E.g., 104"');
  });

  it("the enqueue no longer collapses a resolvable source to 'manual'", () => {
    const studio = read("client/src/pages/admin/instagram/Studio.tsx");
    expect(studio).not.toContain('source === "review" || source === "declined_work" ? source : "manual"');
    expect(studio).toContain("RESOLVABLE_REEL_SOURCES");
  });
});
