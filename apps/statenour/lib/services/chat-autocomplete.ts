/**
 * lib/services/chat-autocomplete.ts · Phase B.5 (2026-05-22 ·
 * legacy-modernizer REST→tRPC chat slice)
 *
 * Ghost-text composer autocomplete service · extracted from
 * `app/api/ai/autocomplete/route.ts` so the legacy REST endpoint AND
 * the new `trpc.chat.autocomplete` query both call this single
 * function · drift between the two consumers is structurally
 * impossible. Same shared-service pattern as Z / DD / EE / GG.
 *
 * Heuristic-first · the RULES array matches Nour's actual phrasing
 * patterns + /slash commands · ~5ms response on a match, empty array
 * on a miss. No LLM call (the route left the LLM path as opt-in
 * future work — preserved as a comment in `buildAutocomplete`).
 *
 * Read-shaped · NO DB write, so the tRPC procedure models it as a
 * `.query()`.
 */

interface AutocompleteRule {
  pattern: RegExp;
  suggestions: string[];
}

// Each entry: a regex that matches the typed-so-far + 1-3 completions
// to suggest. Order matters — first match wins.
const RULES: AutocompleteRule[] = [
  // Content asks
  {
    pattern: /^(draft|write|make)\s+(me\s+)?(an?\s+|the\s+)?$/i,
    suggestions: [
      "draft me an instagram post about ",
      "draft me a brake post for the spring sale",
      "draft me a reel script about tire rotation",
    ],
  },
  {
    pattern: /^hit me with /i,
    suggestions: [
      "hit me with a brake post",
      "hit me with 3 hooks for an oil change reel",
      "hit me with a customer-story angle",
    ],
  },
  {
    pattern: /^(for|on)\s+(ig|instagram|the gram)/i,
    suggestions: [
      " — make it punchy + add CTA",
      " — story format, 3 slides",
      " — carousel with 5 scenes",
    ],
  },

  // /slash commands
  {
    pattern: /^\/$/,
    suggestions: ["/all ", "/ab ", "/reformat ", "/carousel ", "/turbo ", "/twopass "],
  },
  {
    pattern: /^\/all\s+$/i,
    suggestions: [
      "/all post + reel + story for the spring sale",
      "/all about the new tire display",
      "/all for our brake special",
    ],
  },
  {
    pattern: /^\/ab\s*$/i,
    suggestions: [
      "/ab 2 versions of an alignment post",
      "/ab 3 different hooks for a brake reel",
    ],
  },
  {
    pattern: /^\/carousel\s*$/i,
    suggestions: [
      "/carousel 5 scenes about Cleveland winter prep",
      "/carousel 4 scenes — brake-noise diagnosis",
      "/carousel 6 scenes telling a customer story",
    ],
  },
  {
    pattern: /^\/reformat\s*$/i,
    suggestions: [
      "/reformat for facebook",
      "/reformat for tiktok",
      "/reformat for gbp",
    ],
  },

  // Common Nour starters
  {
    pattern: /^what'?s\s+(today'?s|the)/i,
    suggestions: [
      "what's today's revenue",
      "what's the play for today",
      "what's the top lead right now",
    ],
  },
  {
    pattern: /^how (?:is|are|many)/i,
    suggestions: [
      "how many open leads",
      "how many tasks left today",
      "how is the pipeline looking",
    ],
  },
  {
    pattern: /^(give me|show me)\s+/i,
    suggestions: [
      "give me a quick brief",
      "give me today's score breakdown",
      "show me my schedule",
    ],
  },
  {
    pattern: /^plan\s+/i,
    suggestions: [
      "plan my saturday",
      "plan today around the customers in the bay",
      "plan this week — focus on revenue",
    ],
  },
];

function findHeuristicMatch(partial: string): string[] | null {
  for (const rule of RULES) {
    if (rule.pattern.test(partial)) {
      return rule.suggestions;
    }
  }
  return null;
}

export interface AutocompleteArgs {
  partial: string;
  recentTopic?: string;
}

export interface AutocompleteResult {
  suggestions: string[];
  /** "heuristic" on a rule match · "miss" otherwise. */
  source: string;
}

/**
 * Resolve ghost-text completions for a partial draft. The `partial`
 * is sliced to 200 chars; drafts under 2 chars return empty. Heuristic
 * covers ~90% of cases at zero cost · a miss returns `[]` so the
 * caller hides the ghost UI.
 *
 * `recentTopic` is accepted for API parity with the legacy body but
 * is currently unused (the heuristic doesn't read it · the LLM path
 * that would is opt-in future work).
 */
export function buildAutocomplete(
  args: AutocompleteArgs,
): AutocompleteResult {
  const partial = (args.partial ?? "").slice(0, 200);
  if (!partial || partial.length < 2) {
    return { suggestions: [], source: "miss" };
  }

  // Heuristic first — covers 90% of cases at zero cost.
  const heuristic = findHeuristicMatch(partial);
  if (heuristic) {
    return { suggestions: heuristic.slice(0, 3), source: "heuristic" };
  }

  // No heuristic match — return empty (caller hides the ghost UI).
  // An LLM call here would feel laggy in a typing UX (200ms+) ·
  // left as opt-in future work, same as the legacy route.
  return { suggestions: [], source: "miss" };
}
