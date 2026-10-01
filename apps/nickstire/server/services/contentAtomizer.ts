/**
 * Content atomizer (Creative Intelligence OS, Wave C §O).
 *
 * One Creative Thesis (a CreativeGenome: mechanic truth + driver tension +
 * evidence + visual metaphor) branches into FORMAT-NATIVE derivatives. The
 * rule the plan enforces: nothing is cropped and reposted. Every derivative
 * carries its own grammar, objective and format contract (PROMPT-PACK.md),
 * and all of them share one `thesisId` so lineage survives into
 * content_runs.evidenceJson.
 *
 * `planAtomization` is pure (what SHOULD exist, and why). `executeAtomization`
 * calls the directors that already exist (reelDirector, carouselDirector,
 * content-generator) — it generates drafts only; publishing stays behind the
 * existing approval doors.
 */
import { createHash } from "node:crypto";
import type { CreativeGenome } from "../../client/src/lib/creativeGenome";

export type DerivativeFormat =
  | "reel_short" | "reel_long" | "carousel" | "static" | "story" | "fb_status" | "fb_album" | "article" | "faq" | "ad";

export interface Derivative {
  format: DerivativeFormat;
  objective: "discovery" | "save" | "share" | "trust" | "conversion" | "conversation";
  /** visual family (static/carousel), UGC grammar (reel) or prompt contract id (text formats) */
  grammar: string;
  promptContract: string;
  /** the ONLY inputs this derivative may draw on; nothing is copied from a sibling */
  inputs: { mechanicTruth: string; driverTension: string; visualMetaphor: string; clevelandAngle: string; desiredAction: string; proof: string[] };
  rationale: string;
}

export interface AtomizationPlan {
  thesisId: string;
  derivatives: Derivative[];
  skipped: Array<{ format: DerivativeFormat; reason: string }>;
}

export interface AtomizationContext {
  realAssetAvailable?: boolean;
  commercialIntent?: boolean;
  hasArticle?: boolean;
  /** reel duration lanes the experiment system currently wants populated */
  durationLanes?: Array<"18-24" | "30-40" | "45-60">;
}

/** Stable id for a thesis: the same mechanic truth + moment always maps to one id. */
export function thesisIdFor(genome: Pick<CreativeGenome, "mechanicTruth" | "audienceMoment">): string {
  return "th_" + createHash("sha256").update(`${genome.mechanicTruth.trim().toLowerCase()}|${genome.audienceMoment.trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

const inputsOf = (g: CreativeGenome): Derivative["inputs"] => ({
  mechanicTruth: g.mechanicTruth,
  driverTension: g.driverTension,
  visualMetaphor: g.visualMetaphor,
  clevelandAngle: g.clevelandAngle,
  desiredAction: g.desiredAction,
  proof: [...g.proprietaryProof],
});

export function planAtomization(genome: CreativeGenome, ctx: AtomizationContext = {}): AtomizationPlan {
  const inputs = inputsOf(genome);
  const derivatives: Derivative[] = [];
  const skipped: AtomizationPlan["skipped"] = [];
  const lanes = ctx.durationLanes ?? ["18-24"];

  derivatives.push({
    format: "reel_short",
    objective: "discovery",
    grammar: ctx.realAssetAvailable ? "mini_forensic" : "useful_absurdity",
    promptContract: "ugc_reel.v1",
    inputs,
    rationale: ctx.realAssetAvailable
      ? "real evidence exists: open on it (mini forensic), 18-24 s discovery lane"
      : "no real asset: the visual metaphor carries the opening (useful absurdity), AI cinematic lane",
  });
  if (lanes.includes("30-40") || lanes.includes("45-60")) {
    derivatives.push({
      format: "reel_long",
      objective: "share",
      grammar: "nobody_tells_you",
      promptContract: "reel_director.v2",
      inputs,
      rationale: `duration experiment wants the ${lanes.filter((l) => l !== "18-24").join("/")} lane populated with the same thesis`,
    });
  }
  derivatives.push({
    format: "carousel",
    objective: "save",
    grammar: genome.objective === "save" ? "checklist" : "split_diagnosis",
    promptContract: "carousel.v2",
    inputs,
    rationale: "reference value: the decision logic behind the mechanic truth, one teachable per slide",
  });
  derivatives.push({
    format: "static",
    objective: "trust",
    grammar: ctx.realAssetAvailable ? "receipt_proof" : "question_card",
    promptContract: "static.v2",
    inputs,
    rationale: ctx.realAssetAvailable ? "a real receipt/evidence image is the strongest one-glance proof" : "no real asset: the driver's own question becomes the headline",
  });
  derivatives.push({
    format: "story",
    objective: "conversation",
    grammar: "poll",
    promptContract: "story.v1",
    inputs,
    rationale: "a poll on the driver tension yields replies and a comment-research signal",
  });
  derivatives.push({
    format: "fb_status",
    objective: "conversation",
    grammar: "local_question",
    promptContract: "fb_status.v1",
    inputs,
    rationale: "Facebook status posts are conversation posts: one answerable Cleveland question, no link",
  });
  if (ctx.realAssetAvailable) {
    derivatives.push({
      format: "fb_album",
      objective: "share",
      grammar: "shop_documentary",
      promptContract: "fb_album.v1",
      inputs,
      rationale: "4-6 real photos tell the repair story Facebook albums reward",
    });
  } else {
    skipped.push({ format: "fb_album", reason: "no real shop photos for this thesis — an album of AI images is not an album" });
  }
  if (!ctx.hasArticle) {
    derivatives.push({
      format: "article",
      objective: "trust",
      grammar: "evidence_pack",
      promptContract: "article.v2",
      inputs,
      rationale: "no article covers this thesis: the search-authority derivative, draft-only",
    });
    derivatives.push({ format: "faq", objective: "trust", grammar: "faq_entry", promptContract: "article.v2", inputs, rationale: "the one-paragraph answer the service page can carry" });
  } else {
    skipped.push({ format: "article", reason: "an article already covers this thesis — link to it instead of writing a near-duplicate (scaled-content risk)" });
  }
  if (ctx.commercialIntent) {
    derivatives.push({
      format: "ad",
      objective: "conversion",
      grammar: "direct_response",
      promptContract: "meta_ad.v2",
      inputs,
      rationale: "commercial intent: the tension becomes a direct-response variant; facts from BrandTruth only",
    });
  } else {
    skipped.push({ format: "ad", reason: "no commercial intent declared — educational theses are not forced into ads" });
  }

  return { thesisId: thesisIdFor(genome), derivatives, skipped };
}

export interface AtomizationResult {
  thesisId: string;
  produced: Array<{ format: DerivativeFormat; ok: true; summary: string } | { format: DerivativeFormat; ok: false; error: string }>;
  plannedOnly: DerivativeFormat[];
}

/**
 * Generate drafts for the derivatives that have a director today. Formats
 * without a generator in the repo (story, fb_status, fb_album, faq, static,
 * ad) are returned as plannedOnly — stated, not pretended.
 */
export async function executeAtomization(genome: CreativeGenome, plan: AtomizationPlan, only?: DerivativeFormat[]): Promise<AtomizationResult> {
  const produced: AtomizationResult["produced"] = [];
  const plannedOnly: DerivativeFormat[] = [];
  for (const d of plan.derivatives) {
    if (only && !only.includes(d.format)) continue;
    try {
      if (d.format === "reel_short" || d.format === "reel_long") {
        const { draftReelFromGenome } = await import("./reelDirector");
        const r = await draftReelFromGenome(genome);
        produced.push({ format: d.format, ok: true, summary: `reel brief drafted · quality ${JSON.stringify(r.qualityScore).slice(0, 80)} · evidence ${r.evidence.attached} attached` });
      } else if (d.format === "carousel") {
        const { draftCarouselFromGenome } = await import("./carouselDirector");
        const r = await draftCarouselFromGenome(genome);
        produced.push({ format: d.format, ok: true, summary: `carousel brief drafted · evidence ${r.evidence.attached} attached` });
      } else if (d.format === "article") {
        const { generateArticle, saveGeneratedArticle } = await import("../content-generator");
        const article = await generateArticle(`${genome.audienceMoment} — ${genome.mechanicTruth}`);
        const id = await saveGeneratedArticle(article);
        produced.push({ format: d.format, ok: true, summary: `article draft ${id ?? "(unsaved — no DB)"}: ${article.title}` });
      } else {
        plannedOnly.push(d.format);
      }
    } catch (err) {
      produced.push({ format: d.format, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { thesisId: plan.thesisId, produced, plannedOnly };
}
