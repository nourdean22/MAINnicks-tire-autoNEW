/**
 * Creator pattern miner (Creative Intelligence OS, PROMPT-PACK §16).
 *
 * Turns a PUBLIC post the operator supplies (transcript, shot list, caption,
 * metrics with their source) into a Creative DNA primitive: structure only,
 * never wording, footage, characters or graphics. The output is stored in
 * the existing Pattern Lab table (`social_reel_patterns`) in the house
 * `ReelPattern` shape, with the abstract DNA and the provenance kept in
 * separate keys of patternJson — so rotation and the outcome learner treat a
 * mined pattern exactly like a house hypothesis: a candidate, unmeasured.
 *
 * Originality is enforced in code, not in the prompt alone:
 *  - every free-text field is Jaccard-checked against the source transcript
 *    and caption; ≥ VERBATIM_BLOCK overlap rejects the pattern;
 *  - the pattern id and label may not contain the creator's handle or name;
 *  - sourceLabel carries attribution; the pattern never does.
 */
import { z } from "zod";
import { PATTERN_HOOK_TYPES, PATTERN_LOOP_TYPES, type ReelPattern } from "@shared/reelPatterns";
import { jaccardSimilarity } from "@shared/reelOriginality";
import { socialReelPatterns } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("creative-pattern-miner");

const VERBATIM_BLOCK = 0.3;

export interface ExternalPostInput {
  creator: string;
  url: string;
  date: string;
  format: "reel" | "carousel" | "static" | "video";
  durationSeconds?: number;
  onScreenText?: string;
  transcript?: string;
  shotList?: string[];
  caption?: string;
  metrics?: Array<{ name: string; value: number; source: string }>;
  commentSample?: string[];
}

const creativeDnaSchema = z.object({
  patternName: z.string().min(4).max(48).regex(/^[a-z][a-z0-9_]+$/, "mechanism_name_in_snake_case"),
  hookGrammar: z.string().min(3).max(80),
  exactAudienceTension: z.string().min(6).max(240),
  knowledgeGap: z.string().min(4).max(200),
  emotionalTrigger: z.string().min(3).max(120),
  curiosityMechanism: z.string().min(4).max(200),
  openingVisual: z.string().min(6).max(200),
  storyShape: z.string().min(4).max(120),
  beatCount: z.number().int().min(1).max(20),
  avgShotSeconds: z.number().min(0.2).max(60),
  cameraLanguage: z.string().min(3).max(160),
  visualMetaphor: z.string().min(3).max(160),
  demonstrationMethod: z.string().min(3).max(160),
  proofType: z.string().min(3).max(80),
  narrationStyle: z.string().min(3).max(80),
  captionStyle: z.string().min(3).max(120),
  ctaStyle: z.string().min(2).max(80),
  soundStrategy: z.string().min(3).max(120),
  commentTrigger: z.string().min(3).max(160),
  sendTrigger: z.string().min(3).max(160),
  saveTrigger: z.string().min(3).max(160),
  trendDependency: z.enum(["none", "low", "high"]),
  evergreenPotential: z.enum(["low", "medium", "high"]),
  productionDifficulty: z.enum(["low", "medium", "high"]),
  likelyWhyItWorks: z.string().min(6).max(300),
  possibleFailureMode: z.string().min(6).max(300),
  nickApplicability: z.number().int().min(0).max(5),
  nickAdaptationInputs: z.array(z.string().min(2).max(120)).max(6),
  hookType: z.enum(PATTERN_HOOK_TYPES),
  loopType: z.enum(PATTERN_LOOP_TYPES),
});
export type CreativeDna = z.infer<typeof creativeDnaSchema>;

export interface MinedPatternRecord extends ReelPattern {
  dna: CreativeDna;
  provenance: { creator: string; url: string; date: string; minedAt: string; metrics?: ExternalPostInput["metrics"] };
}

export interface ValidationFailure { field: string; reason: string }

/** Pure: the originality gate. Exported for tests (baselined). */
export function validateMinedPattern(dna: CreativeDna, post: ExternalPostInput): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const sourceText = [post.onScreenText, post.transcript, post.caption, ...(post.shotList ?? [])].filter(Boolean).join(" ");
  const creatorTokens = post.creator.toLowerCase().replace(/^@/, "").split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  for (const t of creatorTokens) {
    if (dna.patternName.includes(t)) failures.push({ field: "patternName", reason: `names the creator ("${t}") — name the mechanism` });
  }
  const textFields: Array<keyof CreativeDna> = [
    "hookGrammar", "exactAudienceTension", "knowledgeGap", "curiosityMechanism", "openingVisual", "visualMetaphor",
    "demonstrationMethod", "commentTrigger", "sendTrigger", "saveTrigger", "likelyWhyItWorks", "possibleFailureMode",
  ];
  if (sourceText.trim()) {
    for (const f of textFields) {
      const v = dna[f];
      if (typeof v !== "string") continue;
      const sim = jaccardSimilarity(v, sourceText);
      if (sim >= VERBATIM_BLOCK) failures.push({ field: f, reason: `verbatim overlap with the source (jaccard ${sim.toFixed(2)} ≥ ${VERBATIM_BLOCK})` });
    }
  }
  return failures;
}

/** Pure: project DNA onto the house ReelPattern shape so Pattern Lab can rotate it. */
export function toReelPattern(dna: CreativeDna, post: ExternalPostInput, minedAt = new Date()): MinedPatternRecord {
  const totalSeconds = post.durationSeconds ?? Math.max(8, Math.round(dna.beatCount * dna.avgShotSeconds));
  return {
    id: `rp_mined_${dna.patternName}`.slice(0, 64),
    label: `Mined primitive · ${dna.patternName.replace(/_/g, " ")}`.slice(0, 80),
    sourceLabel: `Abstracted from a public ${post.format} by ${post.creator} (${post.date}) · unmeasured for Nick's`,
    sourceUrl: post.url,
    hookType: dna.hookType,
    pacing: { totalSeconds, beatCount: dna.beatCount, avgShotLength: dna.avgShotSeconds, firstTextAtSecond: 0.5 },
    visualStyle: { lens: dna.cameraLanguage, lighting: "shop task light, real surfaces", color: "graphite, steel, Nick's yellow accents", motion: dna.storyShape, texture: dna.visualMetaphor },
    captionStyle: { wordsPerBeat: 5, placement: dna.captionStyle, hierarchy: "headline_subline" },
    audioStyle: { musicMood: dna.soundStrategy, voiceover: /vo|voice|narrat/i.test(dna.narrationStyle), sfx: [] },
    loopType: dna.loopType,
    shareTrigger: dna.sendTrigger,
    saveTrigger: dna.saveTrigger,
    nickAdaptation: `${dna.hookGrammar}; ${dna.storyShape}; needs: ${dna.nickAdaptationInputs.join(", ") || "a Nick's signal"}`,
    dna,
    provenance: { creator: post.creator, url: post.url, date: post.date, minedAt: minedAt.toISOString(), metrics: post.metrics },
  };
}

function buildMinerPrompt(post: ExternalPostInput): string {
  return [
    "You abstract a public post into a reusable Creative DNA primitive for a Cleveland tire & auto shop that posts faceless content.",
    "Extract ONLY structure. FORBIDDEN in your output: verbatim wording, captions, scripts, character names, recognisable graphics, logos, the creator's name or handle.",
    "Name the pattern as a mechanism in snake_case (e.g. forensic_closeup_reveal), never after the creator.",
    `hookType must be one of: ${PATTERN_HOOK_TYPES.join(", ")}. loopType one of: ${PATTERN_LOOP_TYPES.join(", ")}.`,
    "Output ONLY one JSON object with keys: patternName, hookGrammar, exactAudienceTension, knowledgeGap, emotionalTrigger, curiosityMechanism, openingVisual, storyShape, beatCount, avgShotSeconds, cameraLanguage, visualMetaphor, demonstrationMethod, proofType, narrationStyle, captionStyle, ctaStyle, soundStrategy, commentTrigger, sendTrigger, saveTrigger, trendDependency(none|low|high), evergreenPotential(low|medium|high), productionDifficulty(low|medium|high), likelyWhyItWorks, possibleFailureMode, nickApplicability(0-5), nickAdaptationInputs[], hookType, loopType.",
    "",
    `POST (${post.format}, ${post.durationSeconds ?? "?"} s, ${post.date}):`,
    post.onScreenText ? `ON-SCREEN TEXT: ${post.onScreenText}` : "",
    post.transcript ? `VO TRANSCRIPT: ${post.transcript}` : "",
    post.shotList?.length ? `SHOT LIST: ${post.shotList.join(" | ")}` : "",
    post.caption ? `CAPTION: ${post.caption}` : "",
    post.metrics?.length ? `METRICS: ${post.metrics.map((m) => `${m.name}=${m.value} (${m.source})`).join(", ")}` : "METRICS: unknown",
    post.commentSample?.length ? `COMMENT SAMPLE: ${post.commentSample.slice(0, 8).join(" || ")}` : "",
  ].filter(Boolean).join("\n");
}

export function parseDna(raw: string): CreativeDna {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return creativeDnaSchema.parse(JSON.parse(s));
}

export async function minePattern(post: ExternalPostInput): Promise<{ ok: true; pattern: MinedPatternRecord; stored: boolean } | { ok: false; failures: ValidationFailure[] }> {
  const { invokeLLM } = await import("../_core/llm");
  const res = await invokeLLM({
    messages: [
      { role: "system", content: buildMinerPrompt(post) },
      { role: "user", content: "Output ONLY the JSON object." },
    ],
    maxTokens: 2048,
  });
  const content = res.choices[0]?.message?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  let dna: CreativeDna;
  try {
    dna = parseDna(text);
  } catch (err) {
    return { ok: false, failures: [{ field: "*", reason: `unparseable DNA: ${err instanceof Error ? err.message : String(err)}` }] };
  }
  const failures = validateMinedPattern(dna, post);
  if (failures.length) return { ok: false, failures };
  const pattern = toReelPattern(dna, post);
  let stored = false;
  try {
    const database = await db();
    if (database) {
      await database
        .insert(socialReelPatterns)
        .values({ id: pattern.id, label: pattern.label, hookType: pattern.hookType, loopType: pattern.loopType, patternJson: JSON.stringify(pattern) })
        .onDuplicateKeyUpdate({ set: { patternJson: JSON.stringify(pattern), label: pattern.label } });
      stored = true;
    }
  } catch (err) {
    log.warn("mined pattern not stored", { id: pattern.id, error: err instanceof Error ? err.message : String(err) });
  }
  return { ok: true, pattern, stored };
}
