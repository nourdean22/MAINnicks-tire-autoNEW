/**
 * Regressions a 9-auditor adversarial review found in this session's own merged
 * work. Every test here failed before its fix.
 *
 * These are BEHAVIOURAL where the code allows it — the same review established
 * that source-text pins can pass against unfixed code, so `assessEvidence` and
 * `evaluateInstagramDraft` are CALLED, not grepped. Only the client wiring that
 * cannot be imported without mounting React is asserted structurally.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessEvidence, evidenceDirective, type EvidenceFact } from "../shared/evidenceSufficiency";
import { evaluateInstagramDraft } from "./services/instagramStudio";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fact = (o: Partial<EvidenceFact>): EvidenceFact =>
  ({ key: "k", label: "L", value: "v", role: "context", basis: "recorded", ...o });

const draft = {
  format: "post" as const,
  caption: "Check your tread before the first Cleveland snow. Walk in, we will look.",
  headline: "Tread check", subheadline: "Two minutes", artDirection: "",
  cta: "Walk in", carouselSlides: [] as Array<{ headline: string; body: string }>,
};
const grounding = (r: ReturnType<typeof evaluateInstagramDraft>) =>
  r.dimensions.find((d) => d.key === "source_grounding")!;

describe("an ungrounded draft cannot reach gate `pass`", () => {
  // THE REGRESSION: insufficient scored 3. scoreStatus treats < 5 as "block",
  // and the warnings loop collected only status === "warn" — so 3 produced
  // NEITHER a blocker NOR a warning, and gate could be "pass". The old rule's 6
  // held it at "warn". Aiming for severity made the gate weaker.
  const ungrounded = evaluateInstagramDraft({ ...draft, source: { type: "season_weather" } });

  it("scores in the WARN band so the finding is actually emitted", () => {
    expect(grounding(ungrounded).score).toBeGreaterThanOrEqual(5);
    expect(grounding(ungrounded).score).toBeLessThan(7);
    expect(grounding(ungrounded).status).toBe("warn");
  });

  it("emits a warning, and therefore cannot be `pass`", () => {
    expect(ungrounded.warnings.length).toBeGreaterThan(0);
    expect(ungrounded.gate).not.toBe("pass");
  });

  it("a `block`-status finding is never silently dropped", () => {
    // Any dimension below blockAt used to contribute its finding to nothing.
    const carousel = evaluateInstagramDraft({ ...draft, format: "carousel", source: { type: "manual_idea" } });
    const visual = carousel.dimensions.find((d) => d.key === "visual_readiness")!;
    expect(visual.status).toBe("block");
    expect(carousel.warnings.join(" ")).toContain(visual.finding!);
  });
});

describe("resolved facts survive the round trip", () => {
  // THE REGRESSION: the router's draftSchema is a plain z.object, which STRIPS
  // unknown keys. Facts rode on `source`, so evaluate/render/stage re-scored a
  // fully-grounded draft with ZERO facts — and Render is the mandatory next step.
  const quote = fact({
    key: "review_quote", role: "quote",
    value: "They showed me exactly why the tire could not be safely patched instead of selling me a new one",
  });

  it("the zod source schema accepts facts", () => {
    const src = read("server/routers/instagramStudio.ts");
    expect(src).toContain("const evidenceFactSchema = z.object({");
    expect(src).toContain("facts: z.array(evidenceFactSchema).max(20).optional(),");
  });

  it("the evaluator reads facts off the draft's source when not passed explicitly", () => {
    const viaSource = evaluateInstagramDraft({
      ...draft,
      source: { type: "review", evidenceStatus: "verified", facts: [quote] },
    });
    expect(grounding(viaSource).score).toBe(10);
  });

  it("and still prefers an explicit argument at generation time", () => {
    const explicit = evaluateInstagramDraft({
      ...draft,
      source: { type: "review", evidenceStatus: "verified" },
      evidenceFacts: [quote],
    });
    expect(grounding(explicit).score).toBe(10);
  });
});

describe("the domain vocabulary is not called vacuous", () => {
  // THE REGRESSION: hasConcreteToken required a digit or a capital-then-lowercase
  // token, so all-caps automotive acronyms failed and six of ten realistic briefs
  // were forced to "produce only general education".
  it.each([
    "Customer came in with a bad TPMS sensor and we replaced the valve stem",
    "Driver kept failing ECHECK and nobody explained the readiness monitors",
    "The ABS light came on after the pothole and stayed on for weeks",
  ])("accepts an all-caps acronym brief: %s", (brief) => {
    expect(assessEvidence([], brief).sufficiency).toBe("thin");
  });

  it("still rejects filler, and 'OK' does not count as specific", () => {
    expect(assessEvidence([], "ok we should really post something good today alright").sufficiency)
      .toBe("insufficient");
  });
});

describe("offers must be live, and their discount kind must be real", () => {
  it("an expired offer cannot be resolved as active", () => {
    const src = read("server/services/reelBriefGen.ts");
    // Nothing sets is_active=false on expiry, which is why every other reader
    // filters expiry explicitly. Gating on isActive alone published dead offers.
    expect(src).toContain("const notExpired =");
    expect(src).toContain("row?.isActive && notExpired");
  });

  it("free_service and bundle do not get a fabricated dollar figure", () => {
    const src = read("server/services/reelBriefGen.ts");
    // discountType is a FOUR-value enum; branching on percent-vs-everything
    // printed "$89.99 off" for a free diagnostic scan.
    expect(src).toContain('row.discountType === "fixed" && row.discountValue');
    expect(src).toContain('row.discountType === "free_service" || row.discountType === "bundle"');
  });

  it("an ALG estimate with no service text and no vehicle is not `verified`", () => {
    const src = read("server/services/reelBriefGen.ts");
    expect(src).toContain("rows[0].serviceDescription?.trim() || rows[0].vehicleInfo?.trim()");
  });
});

describe("client wiring the audit found broken", () => {
  const studio = read("client/src/pages/admin/instagram/Studio.tsx");
  const v2 = read("client/src/pages/admin/instagram/StudioV2.tsx");
  const main = read("client/src/main.tsx");

  it("special_offer is NOT sent to the reel enqueue, whose enum rejects it", () => {
    // Adding it turned a working lane (collapsed to "manual") into a hard outage.
    expect(studio).toContain('const RESOLVABLE_REEL_SOURCES: readonly SourceType[] = ["review", "declined_work"];');
  });

  it("a record id does not outlive its lane", () => {
    // A leftover review id resolved an unrelated ALG estimate as VERIFIED.
    expect(v2).toContain('setSourceRecordId("");');
    expect(studio).toContain('if (t !== source) setSourceId("");');
  });

  it("the ceiling exceeds the server's own budget, and is not multiplied by retries", () => {
    expect(main).toContain("const REQUEST_CEILING_MS = 300_000;");
    expect(main).toContain("retry: 0,");
  });

  it("refresh can actually observe a failure", () => {
    // refetch() does not reject by default, so allSettled saw six fulfilled.
    expect(read("client/src/pages/admin/instagram/Learn.tsx")).toContain("refetch({ throwOnError: true })");
  });

  it("the reel prompt receives the facts and the directive", () => {
    // resolved.facts was computed and discarded; the reel lane is the one the
    // operator actually reported.
    const reel = read("server/services/reelBriefGen.ts");
    expect(reel).toContain("resolvedFactLines:");
    expect(reel).toContain("evidenceDirective(assessEvidence(");
    expect(read("client/src/lib/facelessReelStudioPrompt.ts")).toContain("# RESOLVED FACTS");
  });

  it("the inferred marker reaches the reel prompt verbatim", () => {
    const reel = read("server/services/reelBriefGen.ts");
    expect(reel).toContain("[INFERRED — qualify, never assert]");
    // And the directive itself still carries the never-assert instruction.
    const inferred = assessEvidence([fact({ key: "x", role: "anchor", basis: "inferred" })], "");
    expect(evidenceDirective(inferred)).toMatch(/never state them as a customer's decision/);
  });
});
