/**
 * AI assistants that send customers to the shop, and how to recognise them in
 * the utmSource / referrer that bookings, leads and call_events already keep.
 *
 * 2026-10-21: two customers came in the same day because ChatGPT and Meta AI
 * named the shop. Staff log those at the counter (trpc.aiReferrals.log); web
 * rows are classified here. ChatGPT search adds utm_source=chatgpt.com to links
 * it cites (OpenAI publisher docs); the referrer is the second signal.
 */

export const AI_ASSISTANTS = [
  { id: "chatgpt", label: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"] },
  { id: "meta_ai", label: "Meta AI / Muse", hosts: ["meta.ai"] },
  { id: "gemini", label: "Gemini", hosts: ["gemini.google.com", "bard.google.com"] },
  { id: "copilot", label: "Copilot", hosts: ["copilot.microsoft.com"] },
  { id: "perplexity", label: "Perplexity", hosts: ["perplexity.ai"] },
  { id: "claude", label: "Claude", hosts: ["claude.ai"] },
  { id: "other", label: "Other AI", hosts: ["grok.com", "chat.mistral.ai"] },
] as const;

export type AiAssistantId = (typeof AI_ASSISTANTS)[number]["id"];

/** Non-empty tuple, so it can feed z.enum(). */
export const AI_ASSISTANT_IDS = AI_ASSISTANTS.map((a) => a.id) as [AiAssistantId, ...AiAssistantId[]];

/** Exact host or a subdomain of it on a dot boundary: www.perplexity.ai yes, notchatgpt.com no. */
function assistantForHost(host: string): AiAssistantId | null {
  const h = host.toLowerCase();
  for (const a of AI_ASSISTANTS) {
    if (a.hosts.some((known) => h === known || h.endsWith(`.${known}`))) return a.id;
  }
  return null;
}

export function aiAssistantFromAttribution(input: {
  utmSource?: string | null;
  referrer?: string | null;
}): AiAssistantId | null {
  const utm = input.utmSource?.trim().toLowerCase();
  if (utm) {
    const byId = AI_ASSISTANTS.find((a) => a.id === utm);
    if (byId) return byId.id;
    const byHost = AI_ASSISTANTS.find((a) => (a.hosts as readonly string[]).includes(utm));
    if (byHost) return byHost.id;
  }
  if (!input.referrer) return null;
  try {
    return assistantForHost(new URL(input.referrer).hostname);
  } catch {
    return null; // an unparsable referrer is not an assistant
  }
}
