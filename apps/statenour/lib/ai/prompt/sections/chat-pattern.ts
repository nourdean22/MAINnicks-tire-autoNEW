/**
 * lib/ai/prompt/sections/chat-pattern.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for v1's "Nour's communication DNA" block
 * (system-prompt.ts:1645-1701 pre-split).
 *
 * Parses a stored pattern string (e.g. "Avg msg: 42 chars. 8/12 short
 * ...") into typed signals, then emits 0-N adaptation lines that
 * tell Nick how Nour actually communicates. Falls back to a generic
 * "match his energy" line if no specific adaptations fire.
 *
 * Pattern format (set by the chat route every 10th message):
 *   [Chat Pattern] Avg msg: <N> chars. <K>/<M> short. <K>/<M> long.
 *   Topic tier: <tier>. Personality: <persona>.
 */

interface ChatPatternInput {
  /** Raw stored pattern row · null if none yet. */
  chatPattern: { content: string } | null;
}

/**
 * Renders the "communication DNA" adaptations block. Empty array
 * when no pattern row exists.
 */
export function renderChatPatternAdaptations(input: ChatPatternInput): string[] {
  const { chatPattern } = input;
  if (!chatPattern?.content) return [];

  const p: string[] = [];
  p.push(`## Nour's communication DNA (learned from his chat patterns)`);

  const raw = chatPattern.content;
  const avgMatch = raw.match(/Avg msg:\s*(\d+)\s*chars/);
  const shortMatch = raw.match(/(\d+)\/(\d+)\s*short/);
  const longMatch = raw.match(/(\d+)\/(\d+)\s*long/);
  const tierMatch = raw.match(/Topic tier:\s*(\w+)/);
  const personalityMatch = raw.match(/Personality:\s*(\w+)/);

  const avgLen = avgMatch ? parseInt(avgMatch[1], 10) : 0;
  const shortRatio = shortMatch ? parseInt(shortMatch[1], 10) / parseInt(shortMatch[2], 10) : 0;
  // longMatch is parsed but not used in adaptations today; kept so
  // future tuning has the parsed signal handy without re-scanning.
  void longMatch;
  const dominantTier = tierMatch?.[1] || "unknown";
  const dominantPersonality = personalityMatch?.[1] || "master";

  const adaptations: string[] = [];

  if (avgLen > 0 && avgLen < 25) {
    adaptations.push(`Nour types ultra-short messages (avg ${avgLen} chars). Match with 1-2 sentence responses. He wants speed, not depth.`);
  } else if (avgLen > 0 && avgLen < 60) {
    adaptations.push(`Nour types concise messages (avg ${avgLen} chars). Keep responses under 60 words unless he asks for analysis.`);
  } else if (avgLen > 150) {
    adaptations.push(`Nour writes longer messages (avg ${avgLen} chars). He's in thinking mode — give structured responses with data.`);
  }

  if (shortRatio > 0.7) {
    adaptations.push(`${Math.round(shortRatio * 100)}% of his messages are short bursts. He's operating, not reflecting. Be an operator back.`);
  }

  if (dominantTier === "business") {
    adaptations.push(`His dominant topic is business. Lead with revenue numbers, pipeline data, and customer metrics.`);
  } else if (dominantTier === "personal") {
    adaptations.push(`His dominant topic is personal. Lead with health, habits, and energy data.`);
  }

  if (dominantPersonality === "friend") {
    adaptations.push(`He's been using Friend mode. Keep it warm and human. No data dumps.`);
  }

  if (adaptations.length > 0) {
    for (const a of adaptations) p.push(`- ${a}`);
  } else {
    p.push(raw);
    p.push(`Adapt: match his energy. Short question = short answer. Analysis request = structured.`);
  }
  p.push(``);

  return p;
}

/**
 * Renders the "## Recent" fallback block — the last 3 user chats
 * (100ch each). Only emit when the primary conversation-context
 * block came back empty. Caller pre-fetches recentChats.
 */
export function renderRecentChatsFallback(input: {
  recentChats: { content: string; createdAt: Date }[];
}): string[] {
  const { recentChats } = input;
  if (recentChats.length === 0) return [];

  const p: string[] = [];
  p.push(`## Recent`);
  for (const c of recentChats) {
    p.push(`${new Date(c.createdAt).toISOString().slice(0, 10)}: "${c.content.slice(0, 100)}"`);
  }
  p.push(``);
  return p;
}
