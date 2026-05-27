/**
 * Email classifier · 2026-05-27.
 *
 * Single tracedAiChat call per captured Gmail message. Returns
 * structured JSON the ingest cron stores in BrainMemory.metadata so
 * downstream consumers (Telegram nudge, /brain card, weekly review)
 * can act without re-parsing the email body.
 *
 * Cost target · <$0.001 per call. Uses "reason" task type for
 * structured JSON output · gpt-4o-mini fires by default.
 *
 * Failure mode · returns a "neutral" classification (category=other,
 * urgency=low, needsReply=false) so the ingest cron never blocks on
 * classifier failure. The bare email body still lands in BrainMemory;
 * we just lose the enrichment for that one message.
 */

import "server-only";

import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface EmailClassification {
  /** High-level bucket · drives downstream surfaces. */
  category:
    | "customer"
    | "vendor"
    | "personal"
    | "billing"
    | "calendar"
    | "newsletter"
    | "transactional"
    | "spam"
    | "other";
  /** One-sentence summary · under 140 chars · operator-readable. */
  summary: string;
  /** Heuristic urgency · drives Telegram nudge gating. */
  urgency: "low" | "medium" | "high";
  /** True when the email explicitly asks for an action/response. */
  needsReply: boolean;
  /** Names/companies mentioned · empty array if none detected. Max 5. */
  mentions: string[];
  /** Classifier confidence 0-1 · low confidence flags low-quality classification. */
  confidence: number;
}

const NEUTRAL_FALLBACK: EmailClassification = {
  category: "other",
  summary: "",
  urgency: "low",
  needsReply: false,
  mentions: [],
  confidence: 0,
};

const SYSTEM_PROMPT = `You are an email triage classifier for an auto-shop operator.
Read the email below and return ONE JSON object with these fields:
{
  "category": "customer" | "vendor" | "personal" | "billing" | "calendar" | "newsletter" | "transactional" | "spam" | "other",
  "summary": "one operator-readable sentence under 140 chars",
  "urgency": "low" | "medium" | "high",
  "needsReply": true|false,
  "mentions": ["names or companies, max 5"],
  "confidence": 0.0-1.0
}

URGENCY HEURISTICS:
- high · explicit deadline today/tomorrow, customer escalation, payment overdue, lawsuit/legal, family emergency
- medium · customer inquiry awaiting reply, vendor follow-up, calendar conflict, hiring lead
- low · newsletter, FYI, transactional confirmation, social

NEEDSREPLY HEURISTICS:
- true · contains a question, an explicit ask, a deadline directed at recipient, OR is a customer or vendor email still awaiting a human response
- false · automated notification, transactional receipt, marketing, FYI-only

Return ONLY the JSON object · no preamble · no markdown fences.`;

export async function classifyEmail(input: {
  from: string;
  to?: string;
  subject: string;
  date?: string;
  body: string;
  accountEmail?: string;
}): Promise<EmailClassification> {
  // Compact representation — keep prompt cheap. 1200 body chars is
  // plenty for triage; longer emails get truncated.
  const bodyTrimmed = (input.body ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const userBlock = [
    `From: ${input.from}`,
    input.to ? `To (operator account): ${input.to}` : "",
    `Subject: ${input.subject}`,
    input.date ? `Date: ${input.date}` : "",
    "",
    bodyTrimmed,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await tracedAiChat(
      { label: "email-classify", source: "cron", metadata: { from: input.from.slice(0, 60), accountEmail: input.accountEmail } },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userBlock },
      ],
      "reason",
    );

    const raw = (result.content ?? "").trim();
    // Strip code fences if the model added them despite instructions.
    const jsonText = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const parsed = JSON.parse(jsonText) as Partial<EmailClassification>;

    return normalizeClassification(parsed);
  } catch (err) {
    console.warn(
      "[ai/email-classifier] classification failed · using neutral fallback:",
      err instanceof Error ? err.message : err,
    );
    return NEUTRAL_FALLBACK;
  }
}

/**
 * Coerce model output to the strict EmailClassification shape ·
 * tolerates unknown categories (maps to "other"), invalid urgency
 * (maps to "low"), missing fields (defaults), and weird types.
 */
function normalizeClassification(p: Partial<EmailClassification>): EmailClassification {
  const allowedCategories: EmailClassification["category"][] = [
    "customer",
    "vendor",
    "personal",
    "billing",
    "calendar",
    "newsletter",
    "transactional",
    "spam",
    "other",
  ];
  const allowedUrgency: EmailClassification["urgency"][] = ["low", "medium", "high"];

  const category = (allowedCategories as string[]).includes(p.category as string)
    ? (p.category as EmailClassification["category"])
    : "other";

  const urgency = (allowedUrgency as string[]).includes(p.urgency as string)
    ? (p.urgency as EmailClassification["urgency"])
    : "low";

  const summary = typeof p.summary === "string" ? p.summary.slice(0, 200) : "";
  const needsReply = p.needsReply === true;
  const mentions = Array.isArray(p.mentions)
    ? p.mentions
        .filter((m): m is string => typeof m === "string" && m.length > 0)
        .slice(0, 5)
        .map((m) => m.slice(0, 60))
    : [];
  const confidence =
    typeof p.confidence === "number" && p.confidence >= 0 && p.confidence <= 1
      ? p.confidence
      : 0.5;

  return { category, summary, urgency, needsReply, mentions, confidence };
}
