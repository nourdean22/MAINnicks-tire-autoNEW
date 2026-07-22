/**
 * Opportunity & Threat Scoring Engine
 * Defines mathematical priority models and compiles raw claims into actionable opportunities.
 */
import { prisma } from "@/lib/prisma";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { extractStructured } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/scoring");

export interface RawOpportunityProposal {
  title: string;
  description: string;
  domain: "ai" | "seo" | "competitor" | "automotive" | "macro";
  impact: number; // 0 to 100
  urgency: number; // 0 to 100
  confidence: number; // 0.0 to 1.0
  reversibility: number; // 0 to 100
  sourceClaims?: number[]; // 1-based Claim # indices that support this (source attribution)
}

/**
 * Calculates a priority score for an opportunity.
 * Score = (Impact * 0.4) + (Urgency * 0.3) + (Confidence * 20) + (Reversibility * 0.1)
 * Higher score = higher priority. Capped between 0 and 100.
 */
export function calculateOpportunityScore(
  impact: number,
  urgency: number,
  confidence: number,
  reversibility: number
): number {
  const raw = impact * 0.4 + urgency * 0.3 + confidence * 20.0 + reversibility * 0.1;
  return Math.min(100.0, Math.max(0.0, Math.round(raw * 100) / 100));
}

/**
 * Fold LEARNED source trust into a base priority score — the read path that gives the
 * closed-loop Experiment factory teeth. authScore∈[0,100] maps to a factor∈[0.9,1.1],
 * so a source the loop has proven reliable ranks its opportunities up to 10% higher and
 * an unreliable one up to 10% lower — a nudge, never a dominant term. Pure; capped [0,100].
 */
export function applyAuthTrust(baseScore: number, authScore: number): number {
  const factor = 0.9 + 0.2 * (Math.min(100, Math.max(0, authScore)) / 100);
  return Math.min(100, Math.max(0, Math.round(baseScore * factor * 100) / 100));
}

/**
 * Compiles fresh grounded claims into structured OpportunityLog entries.
 */
export async function processClaimsIntoOpportunities(): Promise<number> {
  try {
    // 1. Fetch claims from the last 48 hours that haven't been processed
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const claims = await prisma.intelligenceClaim.findMany({
      where: {
        createdAt: { gte: cutoff },
      },
      include: {
        document: {
          include: {
            source: true,
          },
        },
      },
    });

    if (claims.length === 0) {
      log.info("No fresh claims found to process into opportunities.");
      return 0;
    }

    log.info(`Processing ${claims.length} claims into opportunities...`);

    const model = getModel("reason");
    const systemPrompt = `You are an elite business strategist and CTO. Analyze the provided list of intelligence claims extracted from various sources.
Your task is to identify and synthesize actual, actionable opportunities or critical threats that Nour (the operator) needs to address.

For each opportunity or threat identified, propose:
1. A clear, brief title.
2. An actionable description detailing the situation, what it means for the business, and the recommended action.
3. The domain (ai, seo, competitor, automotive, macro).
4. An impact score (0 to 100, where 100 is massive business value or fatal risk).
5. An urgency score (0 to 100, where 100 requires immediate action within 24 hours).
6. A confidence score (0.0 to 1.0, based on source authority and claim status).
7. A reversibility score (0 to 100, where 100 is completely reversible with zero cost, and 0 is completely irreversible/expensive).
8. sourceClaims: the 1-based Claim # numbers (from the list below) that most directly support this opportunity — used to attribute it to its source. Include at least the single strongest supporting claim.

Only propose highly specific and actionable opportunities/threats. Skip generic advice or non-actionable points.

Respond ONLY with a JSON array of objects matching the schema. No markdown fences, no extra text.
JSON Schema:
[
  {
    "title": "Opportunity or Threat Title",
    "description": "Specific description and recommendation...",
    "domain": "ai | seo | competitor | automotive | macro",
    "impact": 85,
    "urgency": 90,
    "confidence": 0.95,
    "reversibility": 70,
    "sourceClaims": [1, 3]
  }
]`;

    const promptText = `Here are the active intelligence claims:
${claims
  .map(
    (c, idx) =>
      `Claim #${idx + 1}:
- Text: "${c.text}"
- Category: ${c.category}
- Grounding Status: ${c.status} (Verification Score: ${c.verificationScore})
- Source: ${c.document.source.name} (${c.document.source.domain})`
  )
  .join("\n\n")}`;

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: `${promptText}\n\nSynthesize into opportunities/threats now.`,
    });

    const textOutput = result.text || "";
    const parsed = extractStructured<RawOpportunityProposal[]>(textOutput, "array");

    if (!parsed.ok) {
      log.warn("Failed to parse synthesized opportunities JSON.", {
        error: parsed.error,
        raw: textOutput.slice(0, 200),
      });
      return 0;
    }

    let createdCount = 0;
    for (const prop of parsed.value) {
      // Attribute the opportunity to its STRONGEST supporting source. Map the
      // LLM's 1-based sourceClaims to real claims (bounds-checked against
      // hallucinated/out-of-range indices), then pick the highest-verification
      // claim's source. Nullable — degrades gracefully when the model omits indices.
      const supporting = (prop.sourceClaims ?? [])
        .map((n) => claims[n - 1])
        .filter((c): c is (typeof claims)[number] => Boolean(c));
      const primary = supporting.reduce<(typeof claims)[number] | null>(
        (best, c) => (!best || c.verificationScore > best.verificationScore ? c : best),
        null,
      );
      const primarySource = primary?.document.source ?? null;

      // Base priority, then fold in LEARNED source trust — the READ path that gives
      // the closed loop teeth. authScore∈[0,100] -> factor∈[0.9,1.1]: a source the
      // experiment loop has PROVEN reliable ranks its opportunities higher, an
      // unreliable one lower. Bounded so trust nudges priority, never dominates it.
      const baseScore = calculateOpportunityScore(prop.impact, prop.urgency, prop.confidence, prop.reversibility);
      const score = applyAuthTrust(baseScore, primarySource?.authScore ?? 70);

      // Deduplicate opportunities by title + status
      const existing = await prisma.opportunityLog.findFirst({
        where: {
          title: prop.title,
          status: "pending",
        },
      });

      if (!existing) {
        await prisma.opportunityLog.create({
          data: {
            title: prop.title,
            description: prop.description,
            domain: prop.domain,
            impact: prop.impact,
            urgency: prop.urgency,
            confidence: prop.confidence,
            reversibility: prop.reversibility,
            score,
            status: "pending",
            sourceId: primarySource?.id ?? null,
          },
        });
        createdCount++;
      }
    }

    log.info(`Successfully compiled and logged ${createdCount} new opportunities.`);
    return createdCount;
  } catch (err) {
    log.error("Failed to process claims into opportunities:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
