/**
 * Campaign genome generation — Genome Wave 1, slice 1 (server side).
 *
 * Generates ONE validated CreativeGenome from an operator campaign ask.
 * Mirrors the reelBriefGen conventions: invokeLLM with a strict JSON schema,
 * tolerant parse, zod validation, and a HARD claim-safety gate (the genome is
 * the root of a campaign — a forbidden claim planted here would propagate
 * into every format). One retry with the safety findings quoted back to the
 * model; still dirty -> throw loudly.
 */
import { invokeLLM, type OutputSchema } from "../_core/llm";
import { createLogger } from "../lib/logger";
import {
  CAMPAIGN_OBJECTIVES,
  creativeGenomeSchema,
  validateGenomeClaimSafety,
  type CreativeGenome,
} from "../../client/src/lib/creativeGenome";
import { CREATIVE_TERRITORIES } from "../../client/src/lib/igCarouselStudio";

const log = createLogger("services:genome-gen");

export interface GenerateGenomeInput {
  /** the campaign ask in the operator's words */
  campaignAsk: string;
  objective?: string;
  /** verified evidence handles the model may cite (never invent) */
  proofHandles?: string[];
}

const GENOME_SCHEMA: OutputSchema = {
  name: "creative_genome",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      objective: { type: "string" },
      audienceMoment: { type: "string" },
      driverTension: { type: "string" },
      mechanicTruth: { type: "string" },
      proprietaryProof: { type: "array", items: { type: "string" } },
      emotionalTurn: { type: "string" },
      visualMetaphor: { type: "string" },
      creativeTerritory: { type: "string" },
      clevelandAngle: { type: "string" },
      nickSignature: { type: "string" },
      desiredAction: { type: "string" },
    },
    required: [
      "objective", "audienceMoment", "driverTension", "mechanicTruth", "proprietaryProof",
      "emotionalTurn", "visualMetaphor", "creativeTerritory", "clevelandAngle",
      "nickSignature", "desiredAction",
    ],
  },
};

function buildPrompt(input: GenerateGenomeInput, safetyFeedback?: string): string {
  const territories = Object.entries(CREATIVE_TERRITORIES)
    .map(([key, t]) => `- ${key}: ${t.essence}`)
    .join("\n");
  return [
    `# ROLE`,
    `You are the campaign creative director for Nick's Tire & Auto (Euclid Ave, Cleveland).`,
    `Produce ONE Creative Genome: the campaign-level creative core that reel, carousel, photo, story, and ad directors will each adapt. It describes ONE idea, not format executions.`,
    ``,
    `# CAMPAIGN ASK`,
    input.campaignAsk,
    input.objective ? `Preferred objective: ${input.objective}` : ``,
    ``,
    `# EVIDENCE YOU MAY CITE (never invent evidence; leave proprietaryProof empty if none fits)`,
    (input.proofHandles ?? []).map((p) => `- ${p}`).join("\n") || `- (none provided)`,
    ``,
    `# FIELD CONTRACT (hard)`,
    `- objective: one of ${CAMPAIGN_OBJECTIVES.join(", ")}`,
    `- audienceMoment: the CONCRETE driver moment (what just happened in their day)`,
    `- driverTension: what they fear or cannot tell — plain words`,
    `- mechanicTruth: verifiable, inspection-first; symptoms are clues, never remote diagnosis`,
    `- visualMetaphor: ONE visual idea every format can share`,
    `- creativeTerritory: exactly one key from the registry below`,
    `- clevelandAngle: real local texture (roads, seasons, salt, potholes) — no invented statistics`,
    `- nickSignature: the stance that makes it unmistakably Nick's — calm, local, zero sales pressure`,
    `- desiredAction: ONE soft action`,
    ``,
    `# CLAIM SAFETY (hard)`,
    `No prices. No guarantees. No "best". No "you need". No diagnosis-by-content. No invented numbers.`,
    safetyFeedback ? `\n# PREVIOUS ATTEMPT WAS REJECTED\n${safetyFeedback}\nRewrite the flagged language.` : ``,
    ``,
    `# CREATIVE TERRITORY REGISTRY`,
    territories,
  ].filter(Boolean).join("\n");
}

function parseGenome(raw: string): CreativeGenome {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s) as Record<string, unknown>;
  return creativeGenomeSchema.parse({ ...parsed, version: 1 });
}

export async function generateCampaignGenome(input: GenerateGenomeInput): Promise<{
  genome: CreativeGenome;
  attempts: number;
}> {
  let safetyFeedback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: buildPrompt(input, safetyFeedback) },
        { role: "user", content: "Output ONLY the Creative Genome as one JSON object matching the provided schema. No prose, no markdown." },
      ],
      // gemini-2.5-flash counts internal thinking against maxOutputTokens;
      // the genome itself is small, so 8192 leaves generous thinking room.
      maxTokens: 8192,
      timeoutMs: 60000,
      outputSchema: GENOME_SCHEMA,
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    const genome = parseGenome(typeof raw === "string" ? raw : JSON.stringify(raw));
    const findings = validateGenomeClaimSafety(genome);
    if (!findings.length) {
      log.info("campaign genome generated", { attempt, territory: genome.creativeTerritory, objective: genome.objective });
      return { genome, attempts: attempt };
    }
    safetyFeedback = findings.map((f) => `${f.field}: ${f.rule} ("${f.match}")`).join("\n");
    log.warn("genome failed claim safety — retrying once", { attempt, findings: findings.length });
  }
  throw new Error(`campaign genome failed claim safety after retry: ${safetyFeedback}`);
}
