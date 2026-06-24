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
import {
  CAMPAIGN_KEYWORDS,
  FACT_BUCKETS,
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
      "captionHooks", "hashtags", "storyboardBeats",
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
  return JSON.parse(s) as Record<string, unknown>;
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

/** Generate a ready-to-review ReelBrief from the Studio's master prompt. */
export async function generateReelBriefAI(
  input: GenerateReelBriefInput,
): Promise<{ brief: ReelBrief; rawModel: string }> {
  let proprietaryEvidence: NonNullable<Parameters<typeof buildFacelessReelSystemPrompt>[0]>["proprietaryEvidence"];
  try {
    const { getProprietaryEvidence } = await import("./evidenceEngine");
    proprietaryEvidence = (await getProprietaryEvidence(input.topic)) as typeof proprietaryEvidence;
  } catch (e) {
    log.warn("evidence unavailable — generating without it", { e: e instanceof Error ? e.message : String(e) });
  }

  const systemPrompt = buildFacelessReelSystemPrompt({
    mode: "asset_prep",
    topicOverride: input.topic,
    campaignKeywordOverride: input.campaignKeyword as CampaignKeyword | undefined,
    factBucket: input.factBucket as FactBucket | undefined,
    archetype: input.archetype as ReelArchetype | undefined,
    avoidRecentTopics: input.avoidTopics,
    proprietaryEvidence,
  });

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
  const shareCta =
    "\n\nSHARE CTA: the selectedCaption MUST include a natural prompt inviting the viewer to SEND the reel to someone who needs it (DM shares are a top reach lever) — e.g. \"send this to someone whose tires are bald.\" Keep it claim-safe: no prices, no guarantees, sell the visit not a quote.";

  const res = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Run the full process internally — ground the fact, ideate the concepts, score them, pick the single winner — then OUTPUT ONLY the winning reel as one JSON object matching the provided schema (contiguous storyboard beats, caption, hashtags). No prose, no markdown." +
          feedback +
          shareCta,
      },
    ],
    // Large brief + gemini-2.5-flash thinking overhead — generous headroom.
    maxTokens: 8192,
    // Full-brief generation routinely exceeds the default 30s LLM timeout.
    timeoutMs: 120000,
    outputSchema: REEL_BRIEF_SCHEMA,
  });

  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned no reel brief content");
  }
  const parsed = parseReelJson(content);
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

  // Programmatically append the final loop/CTA frame (Phase 1.3 visual CTA card)
  const lastBeat = storyboardBeats[storyboardBeats.length - 1];
  if (lastBeat) {
    const endSec = lastBeat.endSecond;
    storyboardBeats.push({
      beatNumber: storyboardBeats.length + 1,
      startSecond: endSec,
      endSecond: endSec + 2, // 2-second hold card
      visual: "Graphic display of Nick's Tire & Auto logo on brand yellow (#FDB913) background with clear text overlay",
      motion: "Static hold with subtle camera zoom-in",
      onScreenText: `SAVE THIS POST | DM us "${kw}"`,
      purpose: "Provide a strong, clear, brand-aligned visual call to action on loop",
      audioCue: "Fading music loop",
      safeZoneNotes: "Center-aligned text, fully inside IG UI safe zones"
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
    sourceNotes: [],
    factBucket: coerceEnum<FactBucket>(str(parsed.factBucket), FACT_BUCKETS),
    campaignKeyword: coerceKeyword(str(parsed.campaignKeyword)),
    archetype: coerceEnum<ReelArchetype>(str(parsed.archetype), REEL_ARCHETYPES),
    motionLens: coerceEnum<MotionLens>(str(parsed.motionLens), MOTION_LENSES),
    objectCharacter: coerceEnum<ObjectCharacter>(str(parsed.objectCharacter), OBJECT_CHARACTERS),
    usefulAbsurdity: str(parsed.usefulAbsurdity),
    concepts: [],
    winningConceptId: null,
    storyboardBeats,
    higgsfieldPromptPack: [],
    ffmpegAssemblyNotes: str(parsed.ffmpegAssemblyNotes),
    voiceoverScript: str(parsed.voiceoverScript),
    captionHooks: strArr(parsed.captionHooks),
    selectedCaption: str(parsed.selectedCaption),
    hashtags: strArr(parsed.hashtags),
    avoidedForRepetition: str(parsed.avoidedForRepetition),
    qualityScore: 0,
    assetPlan: "",
    instagramUrl: null,
    operatorNotes: "",
  };

  return { brief, rawModel: content };
}
