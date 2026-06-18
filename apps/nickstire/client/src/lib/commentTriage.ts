/**
 * Pure, client-side triage for Instagram comments so the operator handles the
 * ones that need a human first: service-recovery (complaints) and questions
 * float to the top, spam sinks. Keyword/regex banks only — no LLM, no network.
 * Extracted as a lib so it's unit-testable and reusable by the planned unified
 * social inbox (IG comments + Google reviews + GBP Q&A in one queue).
 */
export type CommentKind = "complaint" | "question" | "spam" | "praise" | "neutral";

export interface CommentTriage {
  kind: CommentKind;
  /** Higher = handle sooner. complaint 3 > question 2 > praise/neutral 1 > spam 0. */
  priority: number;
}

const LINK = /https?:\/\/|www\.|\b\w+\.(?:com|net|org|io|ly|me|shop|store)\b/i;
const SPAM =
  /\b(?:f4f|l4l|follow ?(?:for ?follow|back)|check (?:out )?my (?:page|profile|bio)|dm me|promo code|crypto|forex|invest(?:ment)?|giveaway winner)\b/i;
const COMPLAINT =
  /\b(?:refund|scam(?:med)?|rude|never again|worst|terrible|awful|rip ?off|ripoff|overcharged?|over ?charge|broke(?:n)?|disappointed|waste of|unprofessional|liar|lied|cheat(?:ed)?|horrible|disgrace|avoid this|beware|stay away)\b/i;
const QUESTION_KW =
  /\b(?:how much|do you|can you|are you|could you|what time|when (?:do|are|is|can)|hours|are you open|price|cost|available|in stock|appointment|book|quote)\b/i;
const PRAISE =
  /\b(?:thank|thanks|thx|great|awesome|love (?:it|this|you|yall|y'all)|best|amazing|appreciate|recommend|excellent|good job|fantastic|legend|goat)\b|🔥|❤️|👏|🙌/i;

/** Classify a comment for moderation triage. Pure: same input -> same output. */
export function classifyComment(text: string): CommentTriage {
  const t = (text || "").trim();
  if (!t) return { kind: "neutral", priority: 1 };
  const lower = t.toLowerCase();

  if (LINK.test(lower) || SPAM.test(lower)) return { kind: "spam", priority: 0 };
  if (COMPLAINT.test(lower)) return { kind: "complaint", priority: 3 };
  if (t.includes("?") || QUESTION_KW.test(lower)) return { kind: "question", priority: 2 };
  if (PRAISE.test(t)) return { kind: "praise", priority: 1 };
  return { kind: "neutral", priority: 1 };
}

/** Badge config per kind (null = no badge, e.g. neutral). */
export const COMMENT_KIND_BADGE: Record<CommentKind, { label: string; className: string } | null> = {
  complaint: { label: "NEEDS CARE", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  question: { label: "QUESTION", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  spam: { label: "SPAM?", className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  praise: { label: "PRAISE", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  neutral: null,
};
