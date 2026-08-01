/**
 * Faceless Reel brief generation — the server side of the "one-click" Studio.
 *
 * Mirrors carouselBriefGen.ts: reuses the SAME master prompt the copy-only Reel
 * Studio uses (client/src/lib/facelessReelStudioPrompt), runs it through the
 * funded Gemini with a strict JSON schema, and assembles a ReelBrief the
 * existing Studio UI consumes.
 *
 * Generation only — it does NOT render video or post. Reel *video* still needs
 * Higgsfield (HIGGSFIELD_API_KEY); the brief/storyboard/caption is the value.
 */
import { invokeLLM, type OutputSchema } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { buildFacelessReelSystemPrompt } from "../../client/src/lib/facelessReelStudioPrompt";
import { serializeThesisForPrompt, type CreativeThesis } from "../../client/src/lib/creativeThesis";
import { applyCreativeSkills } from "./skillRouter";
import { buildBrandBibleFragment } from "../../shared/brandBible";
import { PUBLIC_SOURCE_REGISTRY } from "./evidenceResolver";
import { buildFranchiseFragment, type FranchiseId } from "../../shared/contentFranchises";
import {
  CAMPAIGN_KEYWORDS,
  FACT_BUCKETS,
  INSTAGRAM_HASHTAG_CAP,
  REEL_ARCHETYPES,
  MOTION_LENSES,
  OBJECT_CHARACTERS,
  type ReelBrief,
  type StoryboardBeat,
  type CampaignKeyword,
  type FactBucket,
  type ReelArchetype,
  type MotionLens,
  type ObjectCharacter,
} from "../../client/src/lib/facelessReelStudio";

const log = createLogger("services:reelBriefGen");

export interface GenerateReelBriefInput {
  topic?: string;
  campaignKeyword?: string;
  factBucket?: string;
  archetype?: string;
  avoidTopics?: string[];
  sourceType?: string;
  sourceId?: string;
  sourceDetail?: string;
  /** Operator-authored caption. When set it REPLACES the generated
   *  selectedCaption — the whole point of hand-writing one is that the model
   *  does not get to rewrite it. It is substituted BEFORE the brief is returned,
   *  so it still passes through the full M10 preflight and claim bank exactly
   *  like a generated caption: authored by a human is not the same as safe, and
   *  an operator caption that carries a price or a fabricated stat must block
   *  just the same. */
  caption?: string;
  /**
   * Experiment arm for the OPENING LINE. Must be decided BEFORE generation —
   * `assignEpisodeToActiveExperiment` runs at enqueue, which is after the brief
   * exists, so it can record an arm but cannot influence one. Testing a hook
   * style needs the intervention to reach the prompt.
   *
   *  "direct"  — the opener may not warm up; it states the thing immediately.
   *  undefined — CONTROL. Current behaviour, untouched.
   *
   * There is deliberately no "warmup" arm. The hypothesis is that warm-up
   * openers lose viewers (the account's two worst reels, 83.6 and 82.6 skip,
   * are its only two warm-up openers) — and deliberately shipping content we
   * expect to underperform, to a real audience, to prove a point we can already
   * test one-sided, is not a trade worth making.
   */
  hookStyle?: "direct";
  /** Which show this episode belongs to. When set, the franchise contract
   *  (hook shape, reveal shape, allowed metaphors, CTA set, and its NEVER list)
   *  leads the creative section of the prompt — that is what makes the page
   *  look like one studio rather than a stream of unrelated tips. */
  franchiseId?: FranchiseId;
  /** Milestone 3: the LOCKED campaign truth as a STRUCTURED contract (not the
   *  lossy sourceDetail prose). When present, its readable representation leads
   *  the system prompt so the model develops this exact concept — carrying
   *  mechanicTruth / premise / customerTension that genomeConstraintBlock drops. */
  thesis?: CreativeThesis;
}

/** Strict JSON schema for the WINNING reel only — the model ideates + scores
 *  internally, then emits just the chosen reel so the output completes. */
const REEL_BRIEF_SCHEMA: OutputSchema = {
  name: "reel_brief",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string" },
      mechanicTruth: { type: "string" },
      driverConfusion: { type: "string" },
      clevelandAngle: { type: "string" },
      factBucket: { type: "string" },
      campaignKeyword: { type: "string" },
      archetype: { type: "string" },
      motionLens: { type: "string" },
      objectCharacter: { type: "string" },
      usefulAbsurdity: { type: "string" },
      voiceoverScript: { type: "string" },
      ffmpegAssemblyNotes: { type: "string" },
      avoidedForRepetition: { type: "string" },
      selectedCaption: { type: "string" },
      captionHooks: { type: "array", items: { type: "string" } },
      hashtags: { type: "array", items: { type: "string" } },
      sourceNotes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            url: { type: "string" },
            kind: { type: "string" },
            supports: { type: "string" },
          },
          required: ["label", "kind", "supports"],
        },
      },
      concepts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            hook: { type: "string" },
            coreFact: { type: "string" },
            factBucket: { type: "string" },
            driverEmotion: { type: "string" },
            campaignKeyword: { type: "string" },
            archetype: { type: "string" },
            motionLens: { type: "string" },
            objectCharacter: { type: "string" },
            usefulAbsurdity: { type: "string" },
            localAngle: { type: "string" },
            beatOutline: { type: "array", items: { type: "string" } },
            loopIdea: { type: "string" },
            captionAngle: { type: "string" },
            saveShareReason: { type: "string" },
            nickFitReason: { type: "string" },
            nonGenericReason: { type: "string" },
            rejectionRisk: { type: "string" },
            scores: {
              type: "object",
              additionalProperties: false,
              properties: {
                hook: { type: "number" },
                truth: { type: "number" },
                save: { type: "number" },
                local: { type: "number" },
                absurdity: { type: "number" },
                fit: { type: "number" },
              },
              required: ["hook", "truth", "save", "local", "absurdity", "fit"],
            },
          },
          required: [
            "id", "hook", "coreFact", "factBucket", "driverEmotion", "campaignKeyword",
            "archetype", "motionLens", "objectCharacter", "usefulAbsurdity", "localAngle",
            "beatOutline", "loopIdea", "captionAngle", "saveShareReason", "nickFitReason",
            "nonGenericReason", "rejectionRisk", "scores",
          ],
        },
      },
      winningConceptId: { type: "string" },
      storyboardBeats: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            startSecond: { type: "number" },
            endSecond: { type: "number" },
            visual: { type: "string" },
            motion: { type: "string" },
            onScreenText: { type: "string" },
            purpose: { type: "string" },
            audioCue: { type: "string" },
            safeZoneNotes: { type: "string" },
          },
          required: ["startSecond", "endSecond", "visual", "motion", "onScreenText", "purpose", "audioCue", "safeZoneNotes"],
        },
      },
    },
    required: [
      "topic", "mechanicTruth", "driverConfusion", "clevelandAngle", "factBucket",
      "campaignKeyword", "archetype", "motionLens", "objectCharacter", "usefulAbsurdity",
      "voiceoverScript", "ffmpegAssemblyNotes", "avoidedForRepetition", "selectedCaption",
      "captionHooks", "hashtags", "sourceNotes", "concepts", "winningConceptId", "storyboardBeats",
    ],
  },
};

/** Tolerant JSON extraction — strict schema yields clean JSON, but strip any
 *  stray markdown fence / surrounding prose defensively. */
export function parseReelJson(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch (err) {
    // Raw "Unexpected end of JSON input" told the operator nothing. An
    // unbalanced brace count means the model ran out of output tokens
    // mid-object — name that, so the fix (budget, not prompt) is obvious.
    const opens = (s.match(/{/g) || []).length;
    const closes = (s.match(/}/g) || []).length;
    const arrOpens = (s.match(/\[/g) || []).length;
    const arrCloses = (s.match(/]/g) || []).length;
    // Both prod signatures of the same truncation: "Unexpected end of JSON
    // input" (cut mid-object) and "Expected ',' or ']' after array element"
    // (cut mid-array, seen at position ~7141 on the very next attempt).
    if (opens > closes || arrOpens > arrCloses) {
      throw new Error(
        `Reel brief JSON is TRUNCATED (braces ${opens}/${closes}, brackets ${arrOpens}/${arrCloses}) — the model hit its output-token budget mid-structure. Raise maxTokens for this call.`,
      );
    }
    throw err;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Coerce a model-returned value (key OR human label OR off value) to a valid
 *  enum key so the Studio UI's RECORD[key].label lookups never crash. Falls
 *  back to the record's first key. */
function coerceEnum<T extends string>(v: string, record: Record<string, { label: string }>): T {
  if (v in record) return v as T;
  const lo = v.trim().toLowerCase();
  const hit = Object.entries(record).find(
    ([k, val]) => k.toLowerCase() === lo || val.label.toLowerCase() === lo,
  );
  return (hit ? hit[0] : Object.keys(record)[0]) as T;
}
function coerceKeyword(v: string): CampaignKeyword {
  const up = v.trim().toUpperCase();
  return (CAMPAIGN_KEYWORDS as readonly string[]).includes(up)
    ? (up as CampaignKeyword)
    : (CAMPAIGN_KEYWORDS[0] as CampaignKeyword);
}

/**
 * The sources a brief is allowed to cite, rendered from the registry itself.
 *
 * WHY THIS EXISTS
 * The prompt used to say "the label alone is enough", and the generator did
 * exactly what that permits: it invented plausible source NAMES — "Tire
 * Industry Association Repair Manual", "Goodyear Tire Care Information",
 * "Ohio Department of Transportation - Salt Usage". None resolve, so measured
 * over 12 real briefs, 11 carried a claim with no citable evidence. Curating
 * more records cannot fix a citation that was made up.
 *
 * Rendered from PUBLIC_SOURCE_REGISTRY rather than hardcoded, so the list the
 * model sees is the list the resolver will actually accept. A prompt that
 * drifts from the registry would reintroduce the same failure quietly.
 *
 * The label format matters: parseEvidenceHandle matches a family name (or
 * alias) AND a topic word, so "NHTSA tire pressure guidance" resolves while
 * "NHTSA says so" does not.
 */
function renderCitableSources(): string {
  const lines = PUBLIC_SOURCE_REGISTRY.map((r) => {
    const name = r.matchAliases?.[0] ?? r.family;
    return `  - "${name} ${r.topics[0]} ..." — ${r.title}. Topics it covers: ${r.topics.slice(0, 6).join(", ")}.`;
  });
  return (
    "\n\nCITE ONLY FROM THIS LIST. A proof note's `label` MUST name one of these sources AND include one of that source's topic words, or it will not resolve and the brief is rejected:\n" +
    lines.join("\n") +
    "\n\nWrite the label as \"<source name> <topic> guidance\" — e.g. \"NHTSA tire pressure guidance\", \"Michelin tread repair guidance\". Do NOT invent a source, a report title, a manual name, or a study that is not on this list; a citation nobody can check is worse than none."
  );
}

export interface ResolvedSource {
  evidence: string;
  isVerified: boolean;
  provenanceId?: string;
  sourceType: string;
}

export async function resolveSourceProvenance(
  sourceType: string,
  sourceId?: string,
  sourceDetail?: string
): Promise<ResolvedSource> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) {
    return { evidence: sourceDetail || "", isVerified: false, sourceType };
  }

  if (sourceType === "review" && sourceId) {
    const numericId = parseInt(sourceId, 10);
    if (!isNaN(numericId)) {
      const { reviewReplies, reviewPipeline } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      
      try {
        const replies = await db
          .select()
          .from(reviewReplies)
          // 2026-07-11 · the column is reviewRating (review_rating) —
          // `rating` never existed on this table (tsc TS2339 broke the
          // pre-commit hook repo-wide). Same 5-star intent, real column.
          .where(and(eq(reviewReplies.id, numericId), eq(reviewReplies.reviewRating, 5)))
          .limit(1);
        if (replies[0]?.reviewText) {
          return {
            evidence: `Grounded 5-Star Review by ${replies[0].reviewerName || "Anonymous"}: "${replies[0].reviewText}"`,
            isVerified: true,
            provenanceId: sourceId,
            sourceType
          };
        }
      } catch (e) {}

      try {
        const pipeline = await db
          .select()
          .from(reviewPipeline)
          .where(and(eq(reviewPipeline.id, numericId), eq(reviewPipeline.rating, 5)))
          .limit(1);
        if (pipeline[0]?.reviewText) {
          return {
            evidence: `Grounded 5-Star Review by ${pipeline[0].authorName || "Anonymous"}: "${pipeline[0].reviewText}"`,
            isVerified: true,
            provenanceId: sourceId,
            sourceType
          };
        }
      } catch (e) {}
    }
  }

  if (sourceType === "declined_work" && sourceId) {
    const { workOrders, workOrderItems } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    
    try {
      const items = await db
        .select()
        .from(workOrderItems)
        .where(and(eq(workOrderItems.id, sourceId), eq(workOrderItems.declined, true)))
        .limit(1);
      if (items[0]?.description) {
        return {
          evidence: `Grounded Declined Work Item: "${items[0].description}" (Notes: ${items[0].notes || "None"})`,
          isVerified: true,
          provenanceId: sourceId,
          sourceType
        };
      }
    } catch (e) {}

    try {
      const orders = await db
        .select()
        .from(workOrders)
        .where(and(eq(workOrders.id, sourceId), eq(workOrders.status, "declined")))
        .limit(1);
      if (orders[0]?.orderNumber) {
        return {
          evidence: `Grounded Work Order #${orders[0].orderNumber} (Vehicle ID: ${orders[0].vehicleId || "Unknown"})`,
          isVerified: true,
          provenanceId: sourceId,
          sourceType
        };
      }
    } catch (e) {}
  }

  return {
    evidence: sourceDetail || "",
    isVerified: false,
    sourceType
  };
}

/** Generate a ready-to-review ReelBrief from the Studio's master prompt. */
/** Milestone 9: the campaign TRUTH the critic/rewriter must never silently
 *  replace. The critic improves voice / compliance / Cleveland accuracy / flow /
 *  faceless-safety — it does NOT get to swap the winner, the mechanic fact, the
 *  evidence, or the metaphor (issue 3.3). */
export const PROTECTED_BRIEF_FIELDS = ["mechanicTruth", "winningConceptId", "concepts", "sourceNotes", "usefulAbsurdity"] as const;

function isEmptyVal(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Reconcile the critic's rewrite with the pre-critic brief, protecting the
 * campaign-truth fields from the initial generation.
 *
 * If the critic changed a NON-EMPTY protected TRUTH field, its beats, voiceover
 * and captions were composed around a DIFFERENT truth than the one we must keep —
 * restoring only the truth STRING would leave the execution describing the wrong
 * thing (e.g. battery truth stapled onto brake-focused beats, review-audit P1).
 * So the whole critic rewrite is REJECTED and the internally-coherent initial
 * brief is used: coherence outranks the critic's copy/flow polish.
 *
 * If the critic left every protected truth field intact (only empty gaps filled,
 * or nothing changed), its improvements are accepted as-is. A protected field the
 * initial gen left EMPTY is a gap-fill, not an edit, and does not trigger
 * rejection. Returns the effective object, the protected fields the critic tried
 * to change, and whether the critic rewrite was rejected wholesale.
 */
export function applyCriticPreservingTruth(
  initialParsed: Record<string, unknown>,
  criticParsed: Record<string, unknown>,
): { effective: Record<string, unknown>; preserved: string[]; rejectedCritic: boolean } {
  const preserved: string[] = [];
  for (const f of PROTECTED_BRIEF_FIELDS) {
    const initialVal = initialParsed[f];
    if (isEmptyVal(initialVal)) continue; // empty initial → critic may gap-fill
    if (JSON.stringify(criticParsed[f]) !== JSON.stringify(initialVal)) preserved.push(f);
  }
  if (preserved.length > 0) {
    // Critic hijacked a protected truth field → discard its whole rewrite.
    return { effective: { ...initialParsed }, preserved, rejectedCritic: true };
  }
  // Critic honored the truth → accept its copy/flow improvements verbatim.
  return { effective: { ...criticParsed }, preserved, rejectedCritic: false };
}

export async function generateReelBriefAI(
  input: GenerateReelBriefInput,
): Promise<{ brief: ReelBrief; rawModel: string }> {
  // Resolve source provenance from DB
  const resolved = await resolveSourceProvenance(
    input.sourceType || "manual",
    input.sourceId,
    input.sourceDetail || input.topic
  );

  // Enforce NEEDS_RESEARCH blocking
  if ((input.sourceType === "review" || input.sourceType === "declined_work") && !resolved.isVerified) {
    throw new Error("NEEDS_RESEARCH: Grounded database evidence record not found or unverified. Operator context notes cannot be treated as verified facts.");
  }

  let proprietaryEvidence: NonNullable<Parameters<typeof buildFacelessReelSystemPrompt>[0]>["proprietaryEvidence"];
  try {
    const { getProprietaryEvidence } = await import("./evidenceEngine");
    proprietaryEvidence = (await getProprietaryEvidence(input.topic)) as typeof proprietaryEvidence;
  } catch (e) {
    log.warn("evidence unavailable — generating without it", { e: e instanceof Error ? e.message : String(e) });
  }

  let systemPrompt = buildFacelessReelSystemPrompt({
    mode: "asset_prep",
    topicOverride: input.topic,
    campaignKeywordOverride: input.campaignKeyword as CampaignKeyword | undefined,
    factBucket: input.factBucket as FactBucket | undefined,
    archetype: input.archetype as ReelArchetype | undefined,
    avoidRecentTopics: input.avoidTopics,
    proprietaryEvidence,
    resolvedEvidence: resolved.evidence,
  });

  if (input.thesis) {
    // Milestone 3: the LOCKED campaign truth LEADS the prompt — structured
    // contract in, readable representation here — so the model develops this
    // exact concept instead of the flattened sourceDetail blob that dropped
    // mechanicTruth / audienceMoment / driverTension entirely.
    systemPrompt = `${serializeThesisForPrompt(input.thesis)}\n\n${systemPrompt}`;
    // The winner is ALREADY chosen. Override the base prompt's ideate-and-pick-a-
    // winner instruction (audit: downstream re-ideation even with a thesis): the
    // model must treat the thesis as the winning concept and produce ONE execution
    // of it, not invent a fresh winner. The concepts[]/winningConceptId fields
    // must DESCRIBE the thesis concept.
    systemPrompt += `\n\nCONCEPT IS LOCKED — a winning concept is already approved (the CREATIVE THESIS above, conceptId "${input.thesis.conceptId}"). Do NOT ideate or score new concepts and do NOT pick a different winner. Set winningConceptId to "${input.thesis.conceptId}" and make concepts a single entry describing THIS thesis concept. Develop only the EXECUTION (beats, captions, voiceover) of the locked mechanic truth, visual metaphor, and desired action.`;
  }

  // Phase 5.4 + 3.3: feed what's performed back into generation + push a DM-share CTA.
  let feedback = "";
  try {
    const { getReelGenerationSignal } = await import("../pipelines/instagram-data");
    const sig = await getReelGenerationSignal();
    if (sig.topThemes.length) {
      feedback = `\n\nPERFORMANCE FEEDBACK: recent top-performing themes are ${sig.topThemes.join(", ")}. If one genuinely fits the grounded fact, lean toward it — never force it.`;
    }
  } catch (e) {
    log.warn("reel generation signal skipped", { e: e instanceof Error ? e.message : String(e) });
  }
  // Measured 2026-07-31 (`instagram_analytics`, n=8 reels): saved = 0.00,
  // shares = 0.38, reach ≈ 204 against 3,288 followers — 6.2% of the follower
  // base, so these reels are not reaching non-followers at all.
  //
  // A universal SAVE instruction sat here for one commit and is deliberately
  // GONE: it was an overcorrection from reading "saves are the distribution
  // signal" off a zero baseline. Reels are discovery content — watch time and
  // sends are what Instagram distributes on. Saves belong to reference formats
  // (carousels, checklists) where returning later IS the value. Optimising a
  // 20-second reel for saves trades away the signal that actually carries it.
  //
  // Corollary: the CTA is optional. The last beat is watch-time-critical, so a
  // CTA that does not read naturally costs more than it returns.
  const shareCta =
    "\n\nSHARE CTA: the selectedCaption MUST include a natural prompt inviting the viewer to SEND the reel to someone who needs it (DM shares are a top reach lever) — e.g. \"send this to someone whose tires are bald.\" Keep it claim-safe: no prices, no guarantees, sell the visit not a quote." +
    "\n\nOBJECTIVE — DISCOVERY: this is a REEL. Reels earn reach through WATCH TIME and SENDS (one viewer forwarding it to a specific person), which is how they reach non-followers. Optimise the FIRST TWO SECONDS above everything else: open on the physical problem, never on a title card or a greeting. Omit the CTA entirely if it does not read naturally — NONE is a valid choice and beats a bolted-on ask that costs watch time on the final beat." +
    "\n\nDO NOT ask the viewer to SAVE. A save is the objective for REFERENCE content (carousels, checklists) where the value is returning to it later; on a short reel a save prompt competes with the send that actually distributes it. Name the PERSON to send it to, not the action." +
    `\n\nHASHTAGS: 0 to ${INSTAGRAM_HASHTAG_CAP} only — Instagram caps posts at ${INSTAGRAM_HASHTAG_CAP} (hard limit since December 2025) and rejects or silently strips the excess. Hashtags do not inherently increase reach, so prefer 3 highly specific local/service tags over ${INSTAGRAM_HASHTAG_CAP} generic ones; zero is acceptable.` +
    "\n\nSEARCH LANGUAGE: public posts from professional accounts are indexed by search engines. Write in the words a driver would actually search — \"grinding brakes in Cleveland\", \"used tires Euclid\", \"Ohio E-Check not ready\" — and put the SYMPTOM and the CITY in plain language in the caption body rather than relying on a vague hook." +
    // HARD REQUIREMENT, restated at the end on purpose. The master prompt has
    // asked for a proof source since it was written, and compliance measured
    // 5/12 on real briefs (2026-07-31) — which was tolerable while the truth
    // gate only warned, and is not now that it BLOCKS. At 42% per attempt and
    // maxAttempts=3 the daily reel would skip roughly one day in five.
    // Instructions nearest the output directive bind hardest, so it lives here
    // as well as in the master prompt.
    "\n\nHARD REQUIREMENT — SOURCE GROUNDING: at least ONE entry in sourceNotes MUST have kind exactly \"proof\" (lowercase). A brief without a proof-kind source note is REJECTED before rendering and the whole generation is wasted." +
    renderCitableSources() +
    "\n\nIf no source in that list can ground your mechanic truth, say so in mechanicTruth and pick a different angle. An honest \"I cannot ground this\" is worth more than a citation nobody can check.";

  // The visual bible leads every generation so the page reads as ONE studio.
  // It also carries the faceless constraint in the model's own words, which is
  // belt-and-braces with the preflight gate: the gate rejects a violation after
  // the fact, the bible tries to prevent one being written.
  systemPrompt += `

${buildBrandBibleFragment()}`;
  if (input.franchiseId) {
    systemPrompt += `

${buildFranchiseFragment(input.franchiseId)}`;
  }

  // EXPERIMENT ARM — opening line. Appended last so it outranks earlier guidance.
  // Measured 2026-08-01: the account's two worst reels (83.6 and 82.6 skip, ~3s
  // watch) are its only two warm-up openers; its best (39.8, 42.3) open with a
  // question. n=2 per side — a hypothesis, which is why this is an EXPERIMENT
  // and not a new rule in the master prompt.
  if (input.hookStyle === "direct") {
    systemPrompt +=
      "\n\nOPENING LINE — EXPERIMENT ARM \"direct\": beat 1's onScreenText MUST state the thing itself in its first words. " +
      "FORBIDDEN openers: scene-setting (\"Cleveland winters bring more than just snow...\"), \"ever wonder\", \"did you know\", " +
      "\"let's talk about\", a place-name preamble (\"In Cleveland, ...\"), and any trailing ellipsis. " +
      "Open with the symptom, the defect, or a direct question about it — e.g. \"Grinding means metal on metal\" or " +
      "\"What is hiding under your car?\". A viewer who leaves in three seconds never reaches the caption, so the first words carry the whole reel.";
  }

  const skillPayload = await applyCreativeSkills({ type: "reel_brief" });
  if ("fragment" in skillPayload && skillPayload.fragment) {
    systemPrompt += `\n\n${skillPayload.fragment}`;
  }

  // gemini-1.5-pro is retired (404 from Google, observed live 2026-07-16) —
  // the maxTokens/timeout below were already sized for 2.5-flash's thinking
  // overhead; only this default string had lagged behind.
  const modelOverride = process.env.REEL_GEN_MODEL || (process.env.GEMINI_API_KEY ? "gemini-2.5-flash" : undefined);

  log.info("Generating initial Reel Brief via LLM", { model: modelOverride });
  const res = await invokeLLM({
    model: modelOverride,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          // The user turn used to say "ideate the concepts, score them, pick the
          // single winner" UNCONDITIONALLY — the exact instruction the locked-
          // thesis system directive forbids. Two contradictory orders in one
          // call is a coin flip, not a lock: the model could re-ideate and the
          // no-re-ideation guarantee held only by luck. When a thesis is locked
          // the user turn now asks for EXECUTION only.
          (input.thesis
            ? `The winning concept is ALREADY LOCKED (conceptId "${input.thesis.conceptId}"). Do not ideate or re-score. Ground the fact, then develop ONLY the execution of that locked concept — then OUTPUT ONLY the reel as one JSON object matching the provided schema (contiguous storyboard beats, caption, hashtags). No prose, no markdown.`
            : "Run the full process internally — ground the fact, ideate the concepts, score them, pick the single winner — then OUTPUT ONLY the winning reel as one JSON object matching the provided schema (contiguous storyboard beats, caption, hashtags). No prose, no markdown.") +
          feedback +
          shareCta,
      },
    ],
    // Largest JSON in the app + gemini-2.5-flash counts its internal THINKING
    // against maxOutputTokens — 8192 truncated the brief mid-JSON in prod
    // ("Unexpected end of JSON input", 42s call, observed live 2026-07-16).
    // 2.5-flash supports 65k output; 24576 leaves the thinking share room
    // without inviting runaway generations.
    maxTokens: 24576,
    // Full-brief generation routinely exceeds the default 30s LLM timeout.
    timeoutMs: 120000,
    outputSchema: REEL_BRIEF_SCHEMA,
  });

  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned no reel brief content");
  }
  const initialParsed = parseReelJson(content);

  log.info("Running targeted Critic/Rewriter step on generated Reel Brief");
  const criticPrompt = `You are a Senior Editor, Brand Voice Coach, and Compliance Officer at Nick's Tire & Auto in Cleveland, Ohio.
Review the following generated Reel Brief:
${JSON.stringify(initialParsed, null, 2)}

Your task is to review, refine, and optimize this Reel Brief to absolute perfection.
Verify:
1. Brand Voice: Authentic, expert, gritty but professional Cleveland automotive voice. Avoid generic, corporate, or overly salesy tone.
2. Safety & Compliance: Ensure there are no price quotes, no pricing guarantees, no vehicle-specific claims that require a vin, no generic safety claims that cannot be verified. Sell the visit, not the price.
3. Cleveland Angle: Ensure any Cleveland references (e.g. potholes, road names like Dead Man's Curve, local streets, weather patterns) are 100% accurate and feel genuinely local.
4. Reel Flow: Check that the storyboard beats are contiguous, have excellent pacing, clear muted-first text overlay, and a compelling hook beat.
5. Faceless + wordless + unbranded (HARD): NO beat "visual" or "motion" may depend on readable text, a screen/gauge/dashboard showing values, a part label or number, a license plate, a brand name, or a logo, and NO beat may cast human faces, hands, gloves, or arms. The video generator cannot spell — it renders any requested text/logo as garbled gibberish (a real reel shipped a fake "FTD913" readout and a "Nixs" logo this way). "onScreenText" is an ffmpeg overlay added AFTER generation, so it is fine there, but the generated video itself must render zero words. If any beat violates this, rewrite its "visual"/"motion" to show the physical object itself, wordless and unbranded.

If any aspect is not perfect, rewrite the fields directly. OUTPUT ONLY the corrected, fully populated Reel Brief JSON object matching the provided schema. Do not include markdown fences or any prose outside the JSON.`;

  const criticRes = await invokeLLM({
    model: modelOverride,
    messages: [
      { role: "system", content: criticPrompt },
      { role: "user", content: "Analyze and rewrite the Reel Brief to perfection. Return the complete updated JSON matching the schema." }
    ],
    // The critic re-emits the ENTIRE brief JSON, and on gemini-2.5-flash the
    // "thinking" tokens spend from this same budget — 8192 truncated every
    // attempt on 2026-07-16 ("braces 18/17 ... Raise maxTokens for this call").
    // Sized to match the initial-generation call above for the same reason.
    maxTokens: 24576,
    timeoutMs: 120000,
    outputSchema: REEL_BRIEF_SCHEMA,
  });

  const refinedContent = criticRes.choices?.[0]?.message?.content;
  if (typeof refinedContent !== "string" || !refinedContent.trim()) {
    throw new Error("Critic LLM returned no content");
  }
  // M9: the critic re-emits the WHOLE brief, so it can silently swap the winner,
  // the mechanic fact, or the evidence (3.3). Merge its rewrite onto the initial
  // brief but RESTORE the protected campaign truth — the assembly below then uses
  // `parsed` unchanged (critic's improvements for copy/flow, initial's truth).
  const criticParsed = parseReelJson(refinedContent);
  const { effective: parsed, preserved, rejectedCritic } = applyCriticPreservingTruth(initialParsed, criticParsed);
  if (rejectedCritic) {
    log.warn("critic rewrote protected campaign truth — REJECTED the whole critic rewrite, kept the coherent pre-critic brief (M9)", { changed: preserved });
  }
  const kw = coerceKeyword(str(parsed.campaignKeyword));

  const storyboardBeats: StoryboardBeat[] = (Array.isArray(parsed.storyboardBeats) ? parsed.storyboardBeats : [])
    .map((raw: unknown, i: number) => {
      const b = (raw ?? {}) as Record<string, unknown>;
      return {
        beatNumber: i + 1,
        startSecond: num(b.startSecond),
        endSecond: num(b.endSecond),
        visual: str(b.visual),
        motion: str(b.motion),
        onScreenText: str(b.onScreenText),
        purpose: str(b.purpose),
        audioCue: str(b.audioCue),
        safeZoneNotes: str(b.safeZoneNotes),
      };
    });

  const concepts = (Array.isArray(parsed.concepts) ? parsed.concepts : []).map((raw: any) => {
    const c = raw ?? {};
    return {
      id: str(c.id),
      hook: str(c.hook),
      coreFact: str(c.coreFact),
      factBucket: coerceEnum<FactBucket>(str(c.factBucket), FACT_BUCKETS),
      driverEmotion: str(c.driverEmotion),
      campaignKeyword: coerceKeyword(str(c.campaignKeyword)),
      archetype: coerceEnum<ReelArchetype>(str(c.archetype), REEL_ARCHETYPES),
      motionLens: coerceEnum<MotionLens>(str(c.motionLens), MOTION_LENSES),
      objectCharacter: coerceEnum<ObjectCharacter>(str(c.objectCharacter), OBJECT_CHARACTERS),
      usefulAbsurdity: str(c.usefulAbsurdity),
      localAngle: str(c.localAngle),
      beatOutline: strArr(c.beatOutline),
      loopIdea: str(c.loopIdea),
      captionAngle: str(c.captionAngle),
      saveShareReason: str(c.saveShareReason),
      nickFitReason: str(c.nickFitReason),
      nonGenericReason: str(c.nonGenericReason),
      rejectionRisk: str(c.rejectionRisk),
      scores: {
        hook: num(c.scores?.hook),
        truth: num(c.scores?.truth),
        save: num(c.scores?.save),
        local: num(c.scores?.local),
        absurdity: num(c.scores?.absurdity),
        fit: num(c.scores?.fit),
      }
    };
  });

  const sourceNotes = (Array.isArray(parsed.sourceNotes) ? parsed.sourceNotes : []).map((raw: any) => {
    const s = raw ?? {};
    return {
      label: str(s.label),
      url: str(s.url) || undefined,
      kind: str(s.kind) === "proof" ? "proof" as const : "pain_point" as const,
      supports: str(s.supports)
    };
  });

  if (resolved.isVerified) {
    sourceNotes.unshift({
      label: `Database Resolved Provenance: ID ${resolved.provenanceId}`,
      url: `provenance://${resolved.sourceType}/${resolved.provenanceId}`,
      kind: "proof" as const,
      supports: resolved.evidence
    });
  }

  const now = new Date().toISOString();
  const brief: ReelBrief = {
    id: `ai-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    status: "needs_review",
    mode: "asset_prep",
    topic: str(parsed.topic) || str(input.topic),
    mechanicTruth: str(parsed.mechanicTruth),
    driverConfusion: str(parsed.driverConfusion),
    clevelandAngle: str(parsed.clevelandAngle),
    sourceNotes,
    factBucket: coerceEnum<FactBucket>(str(parsed.factBucket), FACT_BUCKETS),
    campaignKeyword: coerceKeyword(str(parsed.campaignKeyword)),
    archetype: coerceEnum<ReelArchetype>(str(parsed.archetype), REEL_ARCHETYPES),
    motionLens: coerceEnum<MotionLens>(str(parsed.motionLens), MOTION_LENSES),
    objectCharacter: coerceEnum<ObjectCharacter>(str(parsed.objectCharacter), OBJECT_CHARACTERS),
    usefulAbsurdity: str(parsed.usefulAbsurdity),
    concepts,
    winningConceptId: str(parsed.winningConceptId) || null,
    storyboardBeats,
    promptPack: [],
    higgsfieldPromptPack: [],
    ffmpegAssemblyNotes: str(parsed.ffmpegAssemblyNotes),
    voiceoverScript: str(parsed.voiceoverScript),
    captionHooks: strArr(parsed.captionHooks),
    // Operator caption wins over the generated one when supplied (see input.caption).
    selectedCaption: input.caption?.trim() || str(parsed.selectedCaption),
    hashtags: strArr(parsed.hashtags),
    avoidedForRepetition: str(parsed.avoidedForRepetition),
    qualityScore: 0,
    assetPlan: "",
    instagramUrl: null,
    operatorNotes: "",
  };

  const { buildHiggsfieldReelPromptPack } = await import("../../client/src/lib/facelessReelStudio");
  const pPack = buildHiggsfieldReelPromptPack(brief);
  brief.promptPack = pPack;
  brief.higgsfieldPromptPack = pPack;

  return { brief, rawModel: content };
}
