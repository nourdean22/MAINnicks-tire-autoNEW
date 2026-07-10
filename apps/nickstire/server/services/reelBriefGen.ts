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
import { applyCreativeSkills } from "./skillRouter";
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

  let systemPrompt = buildFacelessReelSystemPrompt({
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

  const skillPayload = await applyCreativeSkills({ type: "reel_brief" });
  if ("fragment" in skillPayload && skillPayload.fragment) {
    systemPrompt += `\n\n${skillPayload.fragment}`;
  }

  const modelOverride = process.env.REEL_GEN_MODEL || (process.env.GEMINI_API_KEY ? "gemini-1.5-pro" : undefined);

  log.info("Generating initial Reel Brief via LLM", { model: modelOverride });
  const res = await invokeLLM({
    model: modelOverride,
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

If any aspect is not perfect, rewrite the fields directly. OUTPUT ONLY the corrected, fully populated Reel Brief JSON object matching the provided schema. Do not include markdown fences or any prose outside the JSON.`;

  const criticRes = await invokeLLM({
    model: modelOverride,
    messages: [
      { role: "system", content: criticPrompt },
      { role: "user", content: "Analyze and rewrite the Reel Brief to perfection. Return the complete updated JSON matching the schema." }
    ],
    maxTokens: 8192,
    timeoutMs: 120000,
    outputSchema: REEL_BRIEF_SCHEMA,
  });

  const refinedContent = criticRes.choices?.[0]?.message?.content;
  if (typeof refinedContent !== "string" || !refinedContent.trim()) {
    throw new Error("Critic LLM returned no content");
  }
  const parsed = parseReelJson(refinedContent);
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
    selectedCaption: str(parsed.selectedCaption),
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
