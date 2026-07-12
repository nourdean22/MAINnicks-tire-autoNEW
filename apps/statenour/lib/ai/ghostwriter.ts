/**
 * Ghostwriter service · AG-33 (2026-07-09)
 *
 * ONE voice-composition + revision-loop module for every surface that
 * writes AS the operator. Before this, each generation path hand-rolled
 * (or skipped) voice enforcement: generateMarketingContent carried an
 * inline critic block (AG-15), content-alpha had a prompt guard, and
 * Telegram drafts had nothing. This module is composition-only — no new
 * models, no new tables:
 *
 *   · buildNourVoicePrompt()          static voice rules (hit-words, bans)
 *   · getPersonaAnchorPrompt()        corpus-derived identity (15-min cache,
 *                                     "" until a corpus snapshot exists)
 *   · recallRecentContentFeedback()   the operator's captured reactions
 *   · per-channel shape card          sms/email/social/longform discipline
 *
 * plus the critic gate: critiqueContent (SYNCHRONOUS — pure scoring, no
 * LLM) with at most ONE revision pass naming the exact offenders.
 *
 * VOICE SEPARATION: this is NOUR's personal voice. Nick's Tire BRAND
 * content (content-alpha, nickstire contentManufacturing) deliberately
 * does NOT flow through here — see the AG-15 content-alpha note.
 */

import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { buildNourVoicePrompt } from "@/lib/ai/nour-voice-profile";
import { critiqueContent } from "@/lib/ai/output-critic";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/ghostwriter");

export type GhostChannel = "social" | "email" | "sms" | "longform";

const CHANNEL_CARDS: Record<GhostChannel, string> = {
  social: `CHANNEL: SOCIAL POST
- Hook in the first line — no warm-up sentences.
- 15-120 words. One idea per post. CTA only when it earns its place.`,
  email: `CHANNEL: EMAIL
- Subject-worthy first line; the reader decides in 3 seconds.
- 40-200 words. One ask per email, stated plainly. No corporate sign-offs.`,
  sms: `CHANNEL: SMS
- Under 160 characters (single segment) unless delivering a link.
- Verbs like "we got you", "pull up", "your spot is held" — never
  "your appointment is scheduled" / "please confirm" (dental-office vibe).
- Sign off "Nick's" or "Nick's Tire" when business-facing.`,
  longform: `CHANNEL: LONG-FORM
- 80-300 words per section; short paragraphs; concrete over conceptual.
- Every section carries at least one number, name, or dated fact.`,
};

/**
 * Compose the full ghost-voice system prompt for a channel. All three
 * dynamic voice assets are best-effort — a DB or embedding failure
 * degrades to the static profile + channel card, never throws.
 */
export async function buildGhostVoicePrompt(channel: GhostChannel): Promise<string> {
  const parts: string[] = [buildNourVoicePrompt(), CHANNEL_CARDS[channel]];

  try {
    const { getPersonaAnchorPrompt } = await import("@/lib/brain/persona-drift-detector");
    const anchor = await getPersonaAnchorPrompt().catch(() => "");
    if (anchor) parts.push(anchor);
  } catch {
    // corpus anchor unavailable — static profile carries the voice
  }

  try {
    const { recallRecentContentFeedback, buildFeedbackPromptBlock } = await import(
      "@/lib/ai/content-feedback"
    );
    const feedback = buildFeedbackPromptBlock(await recallRecentContentFeedback());
    if (feedback) parts.push(feedback);
  } catch {
    // feedback recall unavailable
  }

  // AG-44 · RECENT WINNERS — reality signal, not taste signal. The
  // weekly content-performance fn writes the top posts by REAL Meta
  // engagement; the ghostwriter should lean toward angles the audience
  // demonstrably responded to. Absent until the loop has run once.
  try {
    const { prisma } = await import("@/lib/prisma");
    const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
    const winners = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.CONTENT_WINNERS,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
      select: { content: true, key: true },
    });
    if (winners?.content) {
      parts.push(
        `RECENT WINNERS (real engagement numbers · week of ${winners.key}):\n${winners.content}\nLean toward the angles and specificity that performed — do NOT copy them verbatim.`,
      );
    }
  } catch {
    // winners recall unavailable — voice profile carries on
  }

  return parts.join("\n\n");
}

export interface GhostwriteResult {
  text: string;
  /** critiqueContent contentOverall (0-100) of the RETURNED text, or
   *  null when the critic itself failed. */
  score: number | null;
  offenders: string[];
  regenApplied: boolean;
  provider: string;
  /** 2026-07-12 · the model REFUSED to write copy and instead asked the
   *  operator for missing input ("Please share the URL…"). Callers MUST
   *  NOT persist such output as a publishable draft — surface it back to
   *  the operator as a clarification instead. See
   *  {@link looksLikeClarifyingQuestion}. */
  needsClarification: boolean;
}

/**
 * Detect when ghostwriter output is an operator-directed request for
 * missing input rather than the requested copy — e.g. "Please share the
 * website URL you'd like to transform…". Such output used to be persisted
 * verbatim into the SocialPublishQueue as a pending "post"; one such row
 * sat in prod for a week (2026-07-05 → -12), and after drafts started
 * defaulting to `platforms:["instagram"]` a clarifying question could
 * actually be approved and POSTED.
 *
 * Conservative by construction: it screens only shorter outputs and
 * matches explicit "asking the operator to provide X to proceed" phrases,
 * NOT rhetorical questions or CTAs that legitimately appear inside copy
 * ("Ready for winter? Book today."). A false negative just restores the
 * prior behaviour; a false positive only re-prompts the operator.
 */
export function looksLikeClarifyingQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Real posts/emails run long; an input-request is short and unresolved.
  if (t.length > 600) return false;
  const lower = t.toLowerCase();
  const REQUEST_PATTERNS: RegExp[] = [
    /\bplease (share|provide|send|give me|specify|confirm|clarify)\b/,
    /\bcould you (please )?(share|provide|send|tell me|specify|clarify|let me know|confirm)\b/,
    /\bcan you (share|provide|send|tell me|specify|clarify)\b/,
    /\b(share|send|provide) (me )?the (url|link|website|details|topic|product|brief)\b/,
    /\bwhich (url|link|website|product|service|topic|brief)\b/,
    /\bwhat(?:'s| is| are)? the (url|link|website|topic|product|details)\b/,
    /\bto get started[, ]/,
    /\bbefore i (can|start|begin)\b/,
    /\bi(?:'|’)?ll need (you|to know|the)\b/,
    /\bi need (you to|to know|the url|the link|more)\b/,
    /\blet me know (the|which|what|your)\b/,
  ];
  return REQUEST_PATTERNS.some((re) => re.test(lower));
}

const ghostChat = makeTracedAiChat("ghostwriter", "brain");

function scoreSafely(text: string): ReturnType<typeof critiqueContent> | null {
  try {
    return critiqueContent(text);
  } catch (err) {
    log.warn("critic_failed", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return null;
  }
}

/**
 * Generate copy in the operator's voice with the critic gate: one
 * generation, one scored critique, and at most ONE revision pass that
 * names the exact offending phrases. The better-scoring version wins.
 */
export async function ghostwrite(args: {
  brief: string;
  channel: GhostChannel;
  /** Optional persona from the typed library (e.g. a marketing persona
   *  key) — its system prompt leads, the voice pack follows. */
  personaKey?: string;
}): Promise<GhostwriteResult> {
  const voicePrompt = await buildGhostVoicePrompt(args.channel);

  let personaPrefix = "";
  if (args.personaKey) {
    const { getPersona, personaToSystemPrompt } = await import("@/lib/ai/personas");
    const persona = getPersona(args.personaKey);
    if (persona) personaPrefix = `${personaToSystemPrompt(persona)}\n\n`;
  }

  const systemPrompt = `${personaPrefix}${voicePrompt}

OUTPUT: the draft only — no preamble, no options unless the brief asks, no meta-commentary.`;

  const result = await ghostChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: args.brief },
    ],
    "reason",
  );

  let text = result.content;
  let critic = scoreSafely(text);

  if (critic?.shouldRegen) {
    const offenders = [
      ...(critic.offenders?.cliches ?? []),
      ...(critic.offenders?.antiNour ?? []),
    ];
    const regen = await ghostChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: args.brief },
        { role: "assistant", content: text },
        {
          role: "user",
          content: `Rewrite this. It failed the voice critic (${critic.contentOverall}/100). You used: ${offenders.join("; ") || "generic phrasing"} — replace with concrete specifics (real numbers, named services, real timeframes). Same substance, sharper copy. Output the rewritten draft only.`,
        },
      ],
      "reason",
    );
    const rescored = scoreSafely(regen.content);
    if (rescored && (critic === null || rescored.contentOverall > critic.contentOverall)) {
      text = regen.content;
      critic = rescored;
      return {
        text,
        score: critic.contentOverall,
        offenders: [
          ...(critic.offenders?.cliches ?? []),
          ...(critic.offenders?.antiNour ?? []),
        ],
        regenApplied: true,
        provider: regen.provider,
        needsClarification: looksLikeClarifyingQuestion(text),
      };
    }
  }

  return {
    text,
    score: critic?.contentOverall ?? null,
    offenders: critic
      ? [...(critic.offenders?.cliches ?? []), ...(critic.offenders?.antiNour ?? [])]
      : [],
    regenApplied: false,
    provider: result.provider,
    needsClarification: looksLikeClarifyingQuestion(text),
  };
}
