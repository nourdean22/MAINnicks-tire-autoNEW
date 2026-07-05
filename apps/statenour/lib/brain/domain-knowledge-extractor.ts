/**
 * Domain Knowledge Extractor · v10.0.371
 *
 * Per /bdistill-knowledge-extraction skill · turn Nick's own
 * conversations into structured, quality-scored domain knowledge.
 * Different layer from the wisdom-distiller (v10.0.356) which
 * extracts PRINCIPLES (when X then Y because Z). This extracts
 * FACTS · concrete claims with subject + property + value:
 *   · "Nick's Tire avg ticket is ~$420 · margin ~38%"
 *   · "Cleveland tire-shop labor rate is $120/hr"
 *   · "Goodyear UltraGrip launched Q3 2024 in size 215/55R17"
 *
 * Why facts matter separately from principles:
 *   · Principles are rare and slow-evolving
 *   · Facts accumulate fast and update often
 *   · Different recall patterns ("what is X" vs "how should I X")
 *   · Pairs with CoALA semantic-kind (v10.0.367)
 *
 * ADVERSARIAL MODE
 *   · After extracting a fact, run a verification pass that asks:
 *     "What would have to be true for this to be wrong?"
 *   · If the verifier finds plausible counter-evidence, the claim
 *     gets confidence ≤0.5 (review queue) instead of being stored
 *     as high-confidence knowledge
 *
 * Cadence · nightly via mega-evening cron · processes last 24h of
 * assistant messages.
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/domain-knowledge");

const SCAN_BATCH = 30; // last N assistant messages
const MIN_MESSAGE_LEN = 100;
const MAX_FACTS_PER_RUN = 15;

interface ExtractedFact {
  /** What is the subject the fact is about? · "Nick's Tire", "tire margins" */
  subject: string;
  /** What property of that subject? · "average ticket", "Q3 launch date" */
  property: string;
  /** The value or claim · with units when relevant */
  value: string;
  /** Confidence from extractor (0-1) · before adversarial verification */
  rawConfidence: number;
  /** Source message ID · for provenance */
  sourceMessageId: string;
}

interface VerifiedFact extends ExtractedFact {
  /** Confidence after adversarial pass · ≤rawConfidence */
  finalConfidence: number;
  /** What the adversarial verifier flagged · empty if no concerns */
  caveats: string[];
}

const EXTRACTOR_SYSTEM = `You are a domain-knowledge extractor for Nick's personal OS · the operator runs Nick's Tire & Auto in Cleveland OH.

From the assistant message, extract concrete FACTS with subject + property + value.

GOOD FACTS:
- subject="Nick's Tire", property="avg ticket", value="~\$420"
- subject="tire shop labor rate", property="Cleveland market", value="\$120/hr"
- subject="Goodyear UltraGrip", property="launched", value="Q3 2024"

BAD (skip these):
- Principles (those go to wisdom)
- Generic claims ("tires are important")
- Unverifiable speculation ("the market might shift")
- Personal preferences ("I like fast cars")

Output JSON only:
{
  "facts": [
    {
      "subject": "...",
      "property": "...",
      "value": "...",
      "rawConfidence": 0.0-1.0
    }
  ]
}

Max 5 facts per message · skip if there are none worth extracting.
NO MARKDOWN. NO PROSE OUTSIDE JSON.`;

const VERIFIER_SYSTEM = `You are an adversarial verifier of factual claims about a tire shop business in Cleveland OH.

Given a fact, ask: "What would have to be true for this to be WRONG? What plausible counter-evidence exists?"

Output JSON only:
{
  "stillBelieve": true | false,
  "confidenceAdjustment": -0.5 to 0.0,
    // negative number to subtract from raw confidence
    // 0.0 if no concerns · -0.5 if fundamentally suspect
  "caveats": ["caveat 1", "caveat 2"]
    // Empty array if confident · max 2 caveats
}

Be skeptical but fair. NO MARKDOWN. NO PROSE OUTSIDE JSON.`;

async function _extractFromMessage(args: {
  messageId: string;
  content: string;
}): Promise<ExtractedFact[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXTRACTOR_SYSTEM },
        { role: "user", content: args.content.slice(0, 3000) },
      ],
      temperature: 0.0,
      max_tokens: 600,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: Error & { status?: number } = new Error(
      `extractor ${res.status}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) return [];

  let parsed: { facts?: Array<{ subject?: unknown; property?: unknown; value?: unknown; rawConfidence?: unknown }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.facts)) return [];

  return parsed.facts
    .map((f) => ({
      subject: typeof f.subject === "string" ? f.subject.slice(0, 200) : "",
      property: typeof f.property === "string" ? f.property.slice(0, 200) : "",
      value: typeof f.value === "string" ? f.value.slice(0, 300) : "",
      rawConfidence: typeof f.rawConfidence === "number" ? Math.max(0, Math.min(1, f.rawConfidence)) : 0.6,
      sourceMessageId: args.messageId,
    }))
    .filter((f) => f.subject && f.property && f.value);
}

async function _verifyFact(fact: ExtractedFact): Promise<VerifiedFact> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ...fact, finalConfidence: fact.rawConfidence, caveats: [] };
  }

  const factDesc = `${fact.subject} · ${fact.property}: ${fact.value}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: VERIFIER_SYSTEM },
        { role: "user", content: `FACT: ${factDesc}\n\nVerify it.` },
      ],
      temperature: 0.2,
      max_tokens: 250,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    return { ...fact, finalConfidence: Math.min(0.5, fact.rawConfidence), caveats: ["verifier_unavailable"] };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  let parsed: { stillBelieve?: unknown; confidenceAdjustment?: unknown; caveats?: unknown };
  try {
    parsed = JSON.parse(text ?? "{}");
  } catch {
    return { ...fact, finalConfidence: fact.rawConfidence, caveats: [] };
  }

  const adjust = typeof parsed.confidenceAdjustment === "number" ? parsed.confidenceAdjustment : 0;
  const caveats = Array.isArray(parsed.caveats)
    ? parsed.caveats.filter((c): c is string => typeof c === "string").slice(0, 2)
    : [];

  return {
    ...fact,
    finalConfidence: Math.max(0, Math.min(1, fact.rawConfidence + adjust)),
    caveats,
  };
}

const extractFromMessage = withGuardian("kn-extract", _extractFromMessage, {
  timeoutMs: 12_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal nightly-cron extraction sub-op
});

const verifyFact = withGuardian("kn-verify", _verifyFact, {
  timeoutMs: 10_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal nightly-cron verification sub-op
});

/**
 * Run the extraction over the last 24h of assistant messages.
 * Returns a summary report.
 */
export async function runDomainKnowledgeExtraction(): Promise<{
  scannedMessages: number;
  factsExtracted: number;
  factsStored: number;
  factsRejected: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const messages = await prisma.chatMessage.findMany({
    where: {
      role: "assistant",
      createdAt: { gte: since },
      content: { not: "" },
    },
    orderBy: { createdAt: "desc" },
    take: SCAN_BATCH,
    select: { id: true, content: true },
  });

  let factsExtracted = 0;
  let factsStored = 0;
  let factsRejected = 0;

  for (const msg of messages) {
    if (msg.content.length < MIN_MESSAGE_LEN) continue;
    if (factsStored >= MAX_FACTS_PER_RUN) break;

    let extracted: ExtractedFact[] = [];
    try {
      extracted = await extractFromMessage({ messageId: msg.id, content: msg.content });
    } catch (err) {
      log.debug("extract_failed", { messageId: msg.id, err: (err as Error).message });
      continue;
    }
    factsExtracted += extracted.length;

    for (const fact of extracted) {
      if (factsStored >= MAX_FACTS_PER_RUN) break;
      let verified: VerifiedFact;
      try {
        verified = await verifyFact(fact);
      } catch {
        verified = { ...fact, finalConfidence: Math.min(0.5, fact.rawConfidence), caveats: [] };
      }

      // Reject if final confidence too low
      if (verified.finalConfidence < 0.4) {
        factsRejected++;
        continue;
      }

      const key = `domain_${fact.sourceMessageId}_${fact.subject.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30)}_${fact.property.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20)}`;
      const content = `${fact.subject} · ${fact.property}: ${fact.value}${
        verified.caveats.length > 0 ? ` (caveats: ${verified.caveats.join("; ")})` : ""
      }`;

      try {
        await brainMemory.remember(
          "domain_knowledge",
          key,
          content,
          "knowledge-extractor",
          {
            subject: fact.subject,
            property: fact.property,
            value: fact.value,
            rawConfidence: fact.rawConfidence,
            finalConfidence: verified.finalConfidence,
            caveats: verified.caveats,
            sourceMessageId: fact.sourceMessageId,
          },
        );
        factsStored++;
      } catch {
        // duplicate key · already stored · skip
      }
    }
  }

  return {
    scannedMessages: messages.length,
    factsExtracted,
    factsStored,
    factsRejected,
    durationMs: Date.now() - startedAt,
  };
}
