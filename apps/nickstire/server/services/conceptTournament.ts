/**
 * Concept tournament — Genome Wave 1, slice 2.
 *
 * The verified defect this replaces: concept selection everywhere in the
 * content factory is SELF-evaluation ("Self-score honestly" is literally in
 * the reel prompt) — one model ideates, scores its own work, and picks its
 * own favorite.
 *
 * The tournament splits the roles:
 *   1. FOUR creative directors with deliberately different lenses each pitch
 *      three concepts (parallel calls): automotive insight, visual metaphor,
 *      Cleveland culture, direct response.
 *   2. Entries are ANONYMIZED (role attribution stripped, order shuffled
 *      deterministically) before judging.
 *   3. A SEPARATE judge call scores the field on a fixed 100-point rubric and
 *      must hard-reject concepts that fail structural rules (generic, not
 *      ownable, depends on AI lettering, cannot teach).
 *   4. The winner is claim-safety scanned with the same banks that gate the
 *      genome — a tournament winner with a "guaranteed" in it loses by rule.
 *
 * The winner feeds generateCampaignGenome (slice 1) so the campaign root is
 * a judged idea, not a first draft.
 */
import { invokeLLM, type OutputSchema } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { z } from "zod";
import {
  validateGenomeClaimSafety,
  type CreativeGenome,
} from "../../client/src/lib/creativeGenome";
import { generateCampaignGenome } from "./genomeGen";

const log = createLogger("services:concept-tournament");

export interface TournamentInput {
  campaignAsk: string;
  objective?: string;
  proofHandles?: string[];
  /** recent creative fingerprints to steer away from (topics/hooks/metaphors) */
  avoidRecent?: string[];
}

export const CREATIVE_ROLES = [
  {
    key: "automotive_insight",
    persona:
      "You are an automotive insight director: you find the mechanic truth drivers misunderstand and build the concept around teaching it honestly (inspection-first, symptoms are clues).",
  },
  {
    key: "visual_metaphor",
    persona:
      "You are a visual metaphor director: you find ONE unforgettable image that makes the lesson land without words (useful absurdity that still teaches).",
  },
  {
    key: "cleveland_culture",
    persona:
      "You are a Cleveland culture director: you root the concept in real local texture — east side arterials, salt season, lake-effect weather, the way people here actually talk.",
  },
  {
    key: "direct_response",
    persona:
      "You are a direct-response director: you engineer the save/send/DM behavior — what makes a driver keep this or push it to a friend TODAY (never pushy, never salesy).",
  },
] as const;

/** rubric weights sum to exactly 100 — enforced by test */
export const JUDGE_RUBRIC: Array<{ dimension: string; weight: number }> = [
  { dimension: "stopScroll", weight: 20 },
  { dimension: "originality", weight: 15 },
  { dimension: "mechanicTruth", weight: 15 },
  { dimension: "visualPotential", weight: 15 },
  { dimension: "saveShareUtility", weight: 10 },
  { dimension: "clevelandSpecificity", weight: 10 },
  { dimension: "nickOwnership", weight: 10 },
  { dimension: "productionFeasibility", weight: 5 },
];

export const HARD_REJECT_RULES = [
  "generic mechanic imagery any shop could run unchanged",
  "depends on readable AI-generated lettering inside the footage or image",
  "useful absurdity that does not actually teach the mechanic truth",
  "repeats a recent creative fingerprint supplied in the brief",
  "cannot be executed convincingly within the current production stack (4s clips, typographic slides, one decisive photo)",
] as const;

export interface TournamentConcept {
  id: string;
  title: string;
  hook: string;
  coreIdea: string;
  visualIdea: string;
  whyItWorks: string;
}

const conceptSchema = z.object({
  title: z.string().min(4).max(120),
  hook: z.string().min(4).max(200),
  coreIdea: z.string().min(12).max(600),
  visualIdea: z.string().min(8).max(400),
  whyItWorks: z.string().min(8).max(400),
});

const ROLE_OUTPUT_SCHEMA: OutputSchema = {
  name: "concept_pitch",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            hook: { type: "string" },
            coreIdea: { type: "string" },
            visualIdea: { type: "string" },
            whyItWorks: { type: "string" },
          },
          required: ["title", "hook", "coreIdea", "visualIdea", "whyItWorks"],
        },
      },
    },
    required: ["concepts"],
  },
};

const JUDGE_OUTPUT_SCHEMA: OutputSchema = {
  name: "tournament_verdict",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            total: { type: "number" },
            rejected: { type: "boolean" },
            rejectionReason: { type: "string" },
            note: { type: "string" },
          },
          required: ["id", "total", "rejected", "rejectionReason", "note"],
        },
      },
      winnerId: { type: "string" },
      judgeReasoning: { type: "string" },
    },
    required: ["scores", "winnerId", "judgeReasoning"],
  },
};

export interface JudgeScore {
  id: string;
  total: number;
  rejected: boolean;
  rejectionReason: string;
  note: string;
}

export interface TournamentResult {
  concepts: TournamentConcept[];
  scores: JudgeScore[];
  winner: TournamentConcept;
  judgeReasoning: string;
  genome?: CreativeGenome;
  /** creative_genomes row id when the chained genome persisted — campaign lineage */
  genomeId?: string | null;
}

/**
 * Deterministic anonymize + interleave: round-robin across roles so no role's
 * block sits first (ordering bias), ids carry no role hint. Pure — unit-tested.
 */
export function anonymizeConcepts(
  byRole: Array<{ role: string; concepts: Omit<TournamentConcept, "id">[] }>,
): TournamentConcept[] {
  const out: TournamentConcept[] = [];
  const max = Math.max(...byRole.map((r) => r.concepts.length), 0);
  let n = 0;
  for (let i = 0; i < max; i++) {
    for (const role of byRole) {
      const c = role.concepts[i];
      if (!c) continue;
      n += 1;
      out.push({ ...c, id: `entry_${String(n).padStart(2, "0")}` });
    }
  }
  return out;
}

/** Pick + validate the judge's winner. Pure — unit-tested. */
export function resolveWinner(
  concepts: TournamentConcept[],
  scores: JudgeScore[],
  winnerId: string,
): TournamentConcept {
  const survivors = scores.filter((s) => !s.rejected);
  if (!survivors.length) throw new Error("concept tournament: the judge rejected the entire field");
  const winnerScore = survivors.find((s) => s.id === winnerId);
  const best = winnerScore ?? survivors.reduce((a, b) => (b.total > a.total ? b : a));
  const winner = concepts.find((c) => c.id === best.id);
  if (!winner) throw new Error(`concept tournament: winner id ${best.id} does not exist in the field`);
  return winner;
}

/**
 * Parse a judge verdict payload for a single-entry field. Pure — unit-tested.
 * Tolerates prose around the JSON (the judge lane has produced both shapes);
 * refuses a verdict with no scores rather than inventing one.
 */
export function parseSingleVerdict(raw: string): JudgeScore {
  const s = typeof raw === "string" ? raw : JSON.stringify(raw);
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  const parsed = JSON.parse(first >= 0 && last > first ? s.slice(first, last + 1) : s) as {
    scores?: JudgeScore[];
  };
  const score = parsed.scores?.[0];
  if (!score || typeof score.total !== "number") {
    throw new Error("shadow judge returned no usable score — refusing to fabricate one");
  }
  return score;
}

/**
 * SHADOW JUDGE (2026-08-05): score ONE already-written concept against the
 * tournament's 100-point rubric + hard-reject rules, via the same
 * independent-judge prompt with a field of one. Built for shadow-scoring the
 * autonomous publishers (igAutopost, dailyReelPost), which still self-score —
 * the exact defect this tournament was built to replace. Read-and-log only by
 * contract: callers must never gate a publish on this verdict without an
 * explicit operator flip.
 */
export async function judgeSingleConcept(input: {
  campaignAsk: string;
  concept: Omit<TournamentConcept, "id">;
}): Promise<JudgeScore> {
  const field: TournamentConcept[] = [{ ...input.concept, id: "entry_01" }];
  const res = await invokeLLM({
    messages: [
      { role: "system", content: judgePrompt({ campaignAsk: input.campaignAsk }, field) },
      { role: "user", content: "Output ONLY the verdict as one JSON object matching the provided schema." },
    ],
    maxTokens: 2048,
    timeoutMs: 60000,
    outputSchema: JUDGE_OUTPUT_SCHEMA,
  });
  const raw = res.choices?.[0]?.message?.content ?? "";
  return parseSingleVerdict(typeof raw === "string" ? raw : JSON.stringify(raw));
}

function rolePrompt(role: (typeof CREATIVE_ROLES)[number], input: TournamentInput): string {
  return [
    `# ROLE`,
    role.persona,
    `You pitch content concepts for Nick's Tire & Auto (Euclid Ave, Cleveland).`,
    ``,
    `# CAMPAIGN ASK`,
    input.campaignAsk,
    input.objective ? `Objective: ${input.objective}` : ``,
    ``,
    `# EVIDENCE AVAILABLE (cite only these, never invent)`,
    (input.proofHandles ?? []).map((p) => `- ${p}`).join("\n") || `- (none provided)`,
    ``,
    input.avoidRecent?.length
      ? `# DO NOT REPEAT (recent creative fingerprints)\n${input.avoidRecent.map((a) => `- ${a}`).join("\n")}\n`
      : ``,
    `# PITCH CONTRACT (hard)`,
    `- Exactly 3 concepts, genuinely different from each other`,
    `- Each teaches ONE verifiable mechanic truth (inspection-first; symptoms are clues, never remote diagnosis)`,
    `- No prices, no guarantees, no "best", no "you need", no invented statistics`,
    `- Executable today: 4-second video clips, typographic slides, or one decisive photo — no readable AI-generated lettering in footage`,
  ].filter(Boolean).join("\n");
}

function judgePrompt(input: TournamentInput, field: TournamentConcept[]): string {
  return [
    `# ROLE`,
    `You are an independent creative director judging anonymized concept pitches for Nick's Tire & Auto (Cleveland). You did NOT write any of these. Judge ruthlessly.`,
    ``,
    `# CAMPAIGN ASK`,
    input.campaignAsk,
    ``,
    `# RUBRIC (score each concept 0-100 as the weighted sum)`,
    JUDGE_RUBRIC.map((r) => `- ${r.dimension}: ${r.weight}`).join("\n"),
    ``,
    `# HARD REJECT (rejected=true regardless of score) when a concept:`,
    HARD_REJECT_RULES.map((r) => `- ${r}`).join("\n"),
    ``,
    `# FIELD`,
    ...field.map((c) =>
      [`## ${c.id}`, `Title: ${c.title}`, `Hook: ${c.hook}`, `Core idea: ${c.coreIdea}`, `Visual: ${c.visualIdea}`, `Why it works: ${c.whyItWorks}`].join("\n"),
    ),
    ``,
    `Score EVERY entry (one scores object per id), set winnerId to the highest-scoring NON-rejected entry, and explain the verdict in judgeReasoning. rejectionReason must be "" for non-rejected entries.`,
  ].join("\n");
}

async function pitchRole(
  role: (typeof CREATIVE_ROLES)[number],
  input: TournamentInput,
): Promise<{ role: string; concepts: Omit<TournamentConcept, "id">[] }> {
  const res = await invokeLLM({
    messages: [
      { role: "system", content: rolePrompt(role, input) },
      { role: "user", content: "Output ONLY the three concepts as one JSON object matching the provided schema." },
    ],
    maxTokens: 8192,
    timeoutMs: 90000,
    outputSchema: ROLE_OUTPUT_SCHEMA,
  });
  const raw = res.choices?.[0]?.message?.content ?? "";
  const s = typeof raw === "string" ? raw : JSON.stringify(raw);
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  const parsed = JSON.parse(first >= 0 && last > first ? s.slice(first, last + 1) : s) as { concepts?: unknown[] };
  const concepts = z.array(conceptSchema).min(1).max(4).parse(parsed.concepts ?? []);
  return { role: role.key, concepts };
}

export async function runConceptTournament(
  input: TournamentInput,
  opts: { generateGenome?: boolean } = {},
): Promise<TournamentResult> {
  // 0. Creative memory: when the caller supplies no recency list, pull the
  //    account's recent fingerprints automatically (stored genomes + published
  //    reels bridged into genome space). Memory is an enhancement - cold or
  //    unavailable memory never blocks a tournament.
  if (!input.avoidRecent?.length) {
    const { recentCreativeFingerprints } = await import("./creativeMemory");
    const remembered = await recentCreativeFingerprints(10);
    if (remembered.length) input = { ...input, avoidRecent: remembered };
  }

  // 1. Four role pitches in parallel — a failed role shrinks the field but
  //    never kills the tournament (minimum viable field: 3 concepts).
  const settled = await Promise.allSettled(CREATIVE_ROLES.map((r) => pitchRole(r, input)));
  const byRole = settled
    .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof pitchRole>>> => s.status === "fulfilled")
    .map((s) => s.value);
  const failures = settled.filter((s) => s.status === "rejected").length;
  const field = anonymizeConcepts(byRole);
  if (field.length < 3) {
    throw new Error(`concept tournament: only ${field.length} concepts survived generation (${failures} role(s) failed) — refusing to judge a hollow field`);
  }

  // 2. Independent judge over the anonymized field.
  const judgeRes = await invokeLLM({
    messages: [
      { role: "system", content: judgePrompt(input, field) },
      { role: "user", content: "Output ONLY the verdict as one JSON object matching the provided schema." },
    ],
    maxTokens: 8192,
    timeoutMs: 90000,
    outputSchema: JUDGE_OUTPUT_SCHEMA,
  });
  const rawVerdict = judgeRes.choices?.[0]?.message?.content ?? "";
  const vs = typeof rawVerdict === "string" ? rawVerdict : JSON.stringify(rawVerdict);
  const vFirst = vs.indexOf("{");
  const vLast = vs.lastIndexOf("}");
  const verdict = JSON.parse(vFirst >= 0 && vLast > vFirst ? vs.slice(vFirst, vLast + 1) : vs) as {
    scores: JudgeScore[];
    winnerId: string;
    judgeReasoning: string;
  };

  const winner = resolveWinner(field, verdict.scores ?? [], verdict.winnerId);

  // 3. Claim-safety on the winner's text via the genome banks.
  const pseudoGenome = {
    version: 1 as const,
    objective: "save" as const,
    audienceMoment: winner.coreIdea,
    driverTension: winner.hook,
    mechanicTruth: winner.coreIdea,
    proprietaryProof: [],
    emotionalTurn: winner.whyItWorks,
    visualMetaphor: winner.visualIdea,
    creativeTerritory: "premium_product_ad" as const,
    clevelandAngle: winner.whyItWorks,
    nickSignature: winner.title,
    desiredAction: "save this",
  };
  const safety = validateGenomeClaimSafety(pseudoGenome);
  if (safety.length) {
    throw new Error(
      `concept tournament: the judged winner fails claim safety — ${safety.map((f) => `${f.rule} ("${f.match}")`).join("; ")}`,
    );
  }

  log.info("concept tournament complete", {
    field: field.length,
    roleFailures: failures,
    rejected: (verdict.scores ?? []).filter((s) => s.rejected).length,
    winner: winner.id,
  });

  // 4. Optionally chain the judged winner into the campaign genome.
  let genome: CreativeGenome | undefined;
  let genomeId: string | null = null;
  if (opts.generateGenome) {
    // Milestone 4: preserve the judged winner into the genome as STRUCTURED data,
    // not just prose. winnerSeed forces the three identity fields; the prose now
    // ALSO carries whyItWorks (previously dropped entirely). Sliced to the genome
    // field limits (visualMetaphor/emotionalTurn <=300, mechanicTruth <=600).
    const winnerSeed = {
      visualMetaphor: winner.visualIdea.slice(0, 300),
      mechanicTruth: winner.coreIdea.slice(0, 600),
      emotionalTurn: winner.whyItWorks.slice(0, 300),
    };
    const chained = await generateCampaignGenome({
      campaignAsk: `${input.campaignAsk}\n\nJUDGED WINNING CONCEPT (build the genome around exactly this):\nTitle: ${winner.title}\nHook: ${winner.hook}\nCore idea: ${winner.coreIdea}\nVisual: ${winner.visualIdea}\nWhy it works: ${winner.whyItWorks}`,
      objective: input.objective,
      proofHandles: input.proofHandles,
      winnerSeed,
    });
    genome = chained.genome;
    const { saveGenome } = await import("./creativeMemory");
    // Capture the persisted id for campaign lineage — briefs and jobs drafted
    // from this genome carry it, so a published asset traces back to the
    // campaign that produced it.
    const saved = await saveGenome({ genome: chained.genome, campaignAsk: input.campaignAsk, source: "tournament" });
    genomeId = saved?.id ?? null;
  }

  return { concepts: field, scores: verdict.scores, winner, judgeReasoning: verdict.judgeReasoning, genome, genomeId };
}
