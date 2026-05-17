/**
 * Marketing-content detection for chat messages.
 *
 * Apr 28 · Extracted from components/chat/nick-message.tsx so the chat
 * page can also use the heuristic — for auto-firing image generation
 * on marketing-content responses (same trigger that powers the
 * "Generate image for this" auto-suggest button).
 *
 * Single source of truth: if you change the threshold or signals here,
 * both the button visibility AND the auto-fire trigger update together.
 *
 * Threshold is tuned conservative (3 signals) so casual replies that
 * happen to mention "shop" or "tire" don't get treated as marketing.
 * Real marketing content typically hits 4-7 signals easily.
 *
 * v6 · Apr 28 fix — when called with the USER's prompt as context, we
 * also check whether the user was ASKING A QUESTION about an existing
 * image (logo opinion, photo critique, review). In that case we suppress
 * auto-fire even if the reply hits the marketing threshold, because the
 * user wasn't asking us to generate a new image.
 */

// Phrases that indicate the user is asking for an OPINION / CRITIQUE /
// REVIEW of something they showed us, not asking us to GENERATE.
// When matched in the user's prompt, suppress auto-fire image gen.
const OPINION_QUESTION_PATTERNS = [
  /\b(what'?s? your|whats? yout?|give me your)\s+(opinion|thoughts|take|view)\b/i,
  /\b(what do you think|what would you|how does (this|that|it) look)\b/i,
  /\b(rate (this|that|it)|evaluate (this|that|it)|review (this|that|it)|critique (this|that|it))\b/i,
  /\b(is this|does this|would this|should i)\b/i,
  /\b(make (me|us) (look|want|feel)|does it (make|look))\b/i, // "does it make u want to shop"
  /\b(feedback on|opinion on|thoughts on|take on|review of|critique of)\b/i,
  /\b(any (good|bad)|too (busy|loud|dark|light|much)|professional|amateur)\b/i,
  /\b(better|worse|prefer|like (this|that) more|which (one|version))\b/i,
  /\?\s*$/, // ends with question mark
];

/**
 * Returns true if the user's prompt is asking for an opinion / critique /
 * review (NOT asking us to generate). Used to suppress auto-fire image gen.
 */
export function isOpinionOrReviewQuestion(userPrompt: string | undefined | null): boolean {
  if (!userPrompt || userPrompt.length < 5) return false;
  let hits = 0;
  for (const re of OPINION_QUESTION_PATTERNS) {
    if (re.test(userPrompt)) hits++;
    if (hits >= 1) return true;
  }
  return false;
}

export function looksLikeMarketingContent(text: string, userPrompt?: string | null): boolean {
  if (!text || text.length < 30) return false;

  // Apr 28 fix · If the user was asking an opinion/review question,
  // the reply is critique not content — never auto-fire image gen.
  if (userPrompt && isOpinionOrReviewQuestion(userPrompt)) return false;

  let signals = 0;

  // Hashtags — strongest single signal of a social post draft
  const hashtagCount = (text.match(/#[A-Za-z][A-Za-z0-9_]+/g) || []).length;
  if (hashtagCount >= 1) signals += 2;
  if (hashtagCount >= 3) signals += 1;

  // Approved emojis common in captions (limited set, not all emoji ranges)
  if (/[🔧🛞🚗🚙🔥💪💯⚡️📞📍✨💰🎯🏁🛠️⚠️]/u.test(text)) signals += 1;

  // CTA phrases typical of social/ad copy
  if (
    /\b(book\s+(now|today|online)|call\s+(now|today|us)|visit\s+(us|our\s+shop)|swipe\s+(up|left|right)|tap\s+(in|here|the\s+link)|link\s+in\s+bio|drop\s+(by|off|in)|come\s+(see|check)|don'?t\s+miss|limited\s+time|dm\s+us|stop\s+by|pull\s+up)\b/i.test(
      text,
    )
  )
    signals += 2;

  // Marketing surface mentions in the response itself.
  // Apr 28 · narrowed — bare "post" or "story" alone too common in critique.
  // Require a content-shape word (caption/reel/carousel/headline/tagline/cta)
  // to actually count.
  if (
    /\b(caption|reel|carousel|headline|tagline|cta|ad copy|banner|flyer|hashtag|hashtags)\b/i.test(
      text,
    )
  )
    signals += 1;

  // Bold marketing-style headline patterns ("**HEADLINE COPY**")
  if (/\*\*[A-Z][A-Z0-9\s!?&]{6,}\*\*/.test(text)) signals += 1;

  // Brake/tire/oil-change topical mentions paired with promo language
  if (
    /\b(brake|tire|alignment|oil\s+change|inspection|special|service)\b/i.test(text) &&
    /\b(special|deal|today|now|free|save|off|%)\b/i.test(text)
  )
    signals += 1;

  // Apr 28 hard requirement · A real social-post draft has hashtags
  // OR explicit caption/reel/carousel marker. If neither, even 3 signals
  // shouldn't trigger auto-fire (that was the logo-opinion false positive).
  const hasContentMarker =
    hashtagCount >= 1 ||
    /\b(caption|reel|carousel|headline|tagline)\b/i.test(text);
  if (!hasContentMarker) return false;

  return signals >= 3;
}

/**
 * Detects whether the text already contains a generated image markdown.
 * Used to avoid auto-firing image gen on a turn that already shipped one.
 */
export function alreadyHasGeneratedImage(text: string): boolean {
  return /\!\[Generated Image\]\(\/api\/images\//.test(text);
}
