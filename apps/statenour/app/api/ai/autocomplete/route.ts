// /api/ai/autocomplete — ghost-text predictive composer suggestions.
//
// v7 · BATCH 7 · Apr 28. Takes the user's typed-so-far prompt + recent
// context, returns up to 3 ghost-text completion suggestions Nour can
// accept with Tab. Heuristic-first, LLM-fallback for ambiguous cases.
//
// Input: { partial: string, recentTopic?: string }
// Output: { suggestions: string[] }
//
// Optimized for <100ms response. Most completions hit the heuristic
// path (no LLM call). Only ambiguous longer prompts trigger fast-classify
// Venice for an LLM completion (~200ms).

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AutocompleteBody {
  partial?: string;
  recentTopic?: string;
}

// ─────────────────────────────────────────────────────────────────────
// HEURISTIC COMPLETIONS — Nour's actual phrasing patterns
// ─────────────────────────────────────────────────────────────────────
//
// Each entry: a regex that matches the typed-so-far + 1-3 completions
// to suggest. Order matters — first match wins.

interface AutocompleteRule {
  pattern: RegExp;
  suggestions: string[];
}

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
  const trimmed = partial;
  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule.suggestions;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  // v10.0.529.3 D-1 fix · cost-bomb guard for the ghost-text endpoint.
  // Triggered on every keystroke pause · without the cap an automated
  // typer would burn LLM credits AND fill the suggestion-cache with
  // garbage.
  const limit = checkAiRateLimit(req);
  if (limit) return limit;

  let body: AutocompleteBody;
  try {
    body = (await req.json()) as AutocompleteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const partial = (body.partial ?? "").slice(0, 200);
  if (!partial || partial.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  // Heuristic first — covers 90% of cases at zero cost
  const heuristic = findHeuristicMatch(partial);
  if (heuristic) {
    return NextResponse.json({
      suggestions: heuristic.slice(0, 3),
      source: "heuristic",
    });
  }

  // No heuristic match — return empty (caller can hide the ghost UI).
  // We could LLM-call here for fancier completion but at 200ms+ it
  // would feel laggy in a typing UX. Leaving as opt-in for future.
  return NextResponse.json({ suggestions: [], source: "miss" });
}
