/**
 * Carousel brief generation — the server side of the "one-click" Studio.
 *
 * Reuses the SAME master-creative-prompt builder the copy-only Studio uses
 * (client/src/lib/igCarouselStudioPrompt), runs it through the now-funded
 * Gemini via invokeLLM with a strict JSON schema, and assembles a
 * CarouselBrief the existing Studio UI (and generateCarouselImages) consumes.
 *
 * NOTE: this is generation only — it does NOT post, schedule, or call
 * Instagram. Publishing stays the operator's manual, claim-safe action.
 */
import { invokeLLM, type OutputSchema } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { buildCarouselStudioSystemPrompt } from "../../client/src/lib/igCarouselStudioPrompt";
import {
  SLIDE_ROLES,
  CREATIVE_TERRITORIES,
  CAMPAIGN_KEYWORDS,
  type CarouselBrief,
  type CarouselConcept,
  type CarouselSlide,
  type CampaignKeyword,
  type CreativeTerritory,
} from "../../client/src/lib/igCarouselStudio";

const log = createLogger("services:carouselBriefGen");

export interface GenerateCarouselBriefInput {
  topic?: string;
  campaignKeyword?: string;
  territory?: string;
  seasonLocalAngle?: string;
  avoidTopics?: string[];
}

/** Strict JSON schema for the WINNING brief only — the model still ideates
 *  + scores internally, but emits just the chosen carousel so the output
 *  stays small enough to complete reliably. */
const CAROUSEL_BRIEF_SCHEMA: OutputSchema = {
  name: "carousel_brief",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string" },
      mechanicTruth: { type: "string" },
      driverConfusion: { type: "string" },
      clevelandAngle: { type: "string" },
      seasonality: { type: "string" },
      usefulAbsurdity: { type: "string" },
      campaignKeyword: { type: "string" },
      creativeTerritory: { type: "string" },
      typographyPlan: { type: "string" },
      avoidedForRepetition: { type: "string" },
      selectedCaption: { type: "string" },
      captionHooks: { type: "array", items: { type: "string" } },
      hashtags: { type: "array", items: { type: "string" } },
      slides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
            visualPrompt: { type: "string" },
            textOverlayPlan: { type: "string" },
            qaNotes: { type: "string" },
          },
          required: ["headline", "body", "visualPrompt", "textOverlayPlan", "qaNotes"],
        },
      },
      // The winning concept's summary + honest self-scores. The prompt already
      // makes the model ideate and score 10 concepts internally; without this
      // block the emission dropped the winner, so every AI brief hard-capped
      // at 65/75 on the boost score ("No winning concept" + "Save/share
      // reason" can never pass) — in the Studio one-click flow too.
      winningConcept: {
        type: "object",
        additionalProperties: false,
        properties: {
          hook: { type: "string" },
          driverEmotion: { type: "string" },
          saveShareReason: { type: "string" },
          boostReason: { type: "string" },
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
        required: ["hook", "driverEmotion", "saveShareReason", "boostReason", "nickFitReason", "nonGenericReason", "rejectionRisk", "scores"],
      },
    },
    required: [
      "topic", "mechanicTruth", "driverConfusion", "clevelandAngle", "seasonality",
      "usefulAbsurdity", "campaignKeyword", "creativeTerritory", "typographyPlan",
      "avoidedForRepetition", "selectedCaption", "captionHooks", "hashtags", "slides",
      "winningConcept",
    ],
  },
};

/** Tolerant JSON extraction — strict schema should yield clean JSON, but strip
 *  any stray markdown fence / surrounding prose defensively. */
export function parseBriefJson(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s) as Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Models often return the human label ("Myth Courtroom") or an off value
 *  instead of the enum key ("myth_courtroom"). Coerce to a valid key — by key,
 *  then by label — so the Studio UI's CREATIVE_TERRITORIES[key].label lookup
 *  (and the rest) never dereferences undefined and crashes the page. */
function coerceTerritory(v: string): CreativeTerritory {
  if (v in CREATIVE_TERRITORIES) return v as CreativeTerritory;
  const hit = (Object.entries(CREATIVE_TERRITORIES) as [CreativeTerritory, { label: string }][]).find(
    ([k, t]) => k.toLowerCase() === v.toLowerCase() || t.label.toLowerCase() === v.toLowerCase(),
  );
  return hit ? hit[0] : "cleveland_survival_guide";
}
function coerceKeyword(v: string): CampaignKeyword {
  const up = v.trim().toUpperCase();
  return (CAMPAIGN_KEYWORDS as readonly string[]).includes(up)
    ? (up as CampaignKeyword)
    : (CAMPAIGN_KEYWORDS[0] as CampaignKeyword);
}

/**
 * Generate a ready-to-review CarouselBrief from the Studio's master prompt.
 * Optionally grounds the brief in real shop evidence when available.
 */
export async function generateCarouselBriefAI(
  input: GenerateCarouselBriefInput,
): Promise<{ brief: CarouselBrief; rawModel: string }> {
  // Best-effort grounding in real shop evidence — never blocks generation.
  let proprietaryEvidence: Parameters<typeof buildCarouselStudioSystemPrompt>[0]["proprietaryEvidence"];
  try {
    const { getProprietaryEvidence } = await import("./evidenceEngine");
    proprietaryEvidence = (await getProprietaryEvidence(input.topic)) as typeof proprietaryEvidence;
  } catch (e) {
    log.warn("evidence unavailable — generating without it", { e: e instanceof Error ? e.message : String(e) });
  }

  const systemPrompt = buildCarouselStudioSystemPrompt({
    mode: "asset_prep",
    topicOverride: input.topic,
    keywordOverride: input.campaignKeyword,
    territory: input.territory as CreativeTerritory | undefined,
    seasonLocalAngle: input.seasonLocalAngle,
    avoidTopics: input.avoidTopics,
    proprietaryEvidence,
  });

  const res = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Run the full process internally — research, ideate the 10 concepts, score them, pick the single winner — then OUTPUT ONLY the winning carousel as one JSON object matching the provided schema (exactly 5 slides in order, caption, hashtags, and the winningConcept block carrying the winner's summary with your HONEST self-scores from the internal scoring, not inflated ones). No prose, no markdown.",
      },
    ],
    // The brief is large and gemini-2.5-flash counts internal thinking
    // against maxOutputTokens; 8192 truncated mid-JSON once the winningConcept
    // block was added (same defect class as the reel critic in #796). Same
    // headroom as the reel generator.
    maxTokens: 24576,
    // Full-brief generation routinely exceeds the default 30s LLM timeout.
    timeoutMs: 120000,
    outputSchema: CAROUSEL_BRIEF_SCHEMA,
  });

  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned no carousel brief content");
  }
  const parsed = parseBriefJson(content);

  const slides: CarouselSlide[] = (Array.isArray(parsed.slides) ? parsed.slides : [])
    .slice(0, 5)
    .map((raw: unknown, i: number) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return {
        slideNumber: (i + 1) as CarouselSlide["slideNumber"],
        role: SLIDE_ROLES[i]?.role ?? SLIDE_ROLES[0].role,
        headline: str(s.headline),
        body: str(s.body),
        visualPrompt: str(s.visualPrompt),
        textOverlayPlan: str(s.textOverlayPlan),
        qaNotes: str(s.qaNotes),
      };
    });

  const campaignKeyword = coerceKeyword(str(parsed.campaignKeyword));
  const creativeTerritory = coerceTerritory(str(parsed.creativeTerritory));

  // Rebuild the winner as a first-class CarouselConcept so the boost score's
  // concept parts (winning concept >= bar, save/share reason) score the real
  // winner instead of always failing on an empty concepts array.
  const wc = (parsed.winningConcept ?? {}) as Record<string, unknown>;
  const wcScores = (wc.scores ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const winningConcept: CarouselConcept | null = str(wc.hook)
    ? {
        id: "winner",
        hook: str(wc.hook),
        mechanicTruth: str(parsed.mechanicTruth),
        driverEmotion: str(wc.driverEmotion),
        campaignKeyword,
        creativeTerritory,
        usefulAbsurdity: str(parsed.usefulAbsurdity),
        localAngle: str(parsed.clevelandAngle),
        slideOutline: slides.map((s) => s.headline),
        saveShareReason: str(wc.saveShareReason),
        boostReason: str(wc.boostReason),
        nickFitReason: str(wc.nickFitReason),
        nonGenericReason: str(wc.nonGenericReason),
        rejectionRisk: str(wc.rejectionRisk),
        scores: {
          hook: num(wcScores.hook),
          truth: num(wcScores.truth),
          save: num(wcScores.save),
          local: num(wcScores.local),
          absurdity: num(wcScores.absurdity),
          fit: num(wcScores.fit),
        },
      }
    : null;

  const now = new Date().toISOString();
  const brief: CarouselBrief = {
    id: `ai-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    status: "needs_review",
    mode: "asset_prep",
    topic: str(parsed.topic) || str(input.topic),
    mechanicTruth: str(parsed.mechanicTruth),
    driverConfusion: str(parsed.driverConfusion),
    clevelandAngle: str(parsed.clevelandAngle),
    seasonality: str(parsed.seasonality),
    sourceNotes: [],
    campaignKeyword,
    creativeTerritory,
    usefulAbsurdity: str(parsed.usefulAbsurdity),
    concepts: winningConcept ? [winningConcept] : [],
    winningConceptId: winningConcept ? winningConcept.id : null,
    slides,
    higgsfieldPrompts: slides.map((s) => s.visualPrompt),
    typographyPlan: str(parsed.typographyPlan),
    captionHooks: strArr(parsed.captionHooks),
    selectedCaption: str(parsed.selectedCaption),
    hashtags: strArr(parsed.hashtags),
    avoidedForRepetition: str(parsed.avoidedForRepetition),
    boostScore: 0,
    assetPaths: [],
    instagramUrl: null,
    operatorNotes: "",
  };

  return { brief, rawModel: content };
}
