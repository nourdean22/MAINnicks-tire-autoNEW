// /api/ai/autocomplete — ghost-text predictive composer suggestions.
//
// v7 · BATCH 7 · Apr 28. Takes the user's typed-so-far prompt + recent
// context, returns up to 3 ghost-text completion suggestions Nour can
// accept with Tab. Heuristic-first, LLM-fallback for ambiguous cases.
//
// Input: { partial: string, recentTopic?: string }
// Output: { suggestions: string[] }
//
// Phase B.5 · the heuristic RULES + match logic live in the shared
// `buildAutocomplete` service · `trpc.chat.autocomplete` calls the
// same function · drift impossible.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { buildAutocomplete } from "@/lib/services/chat-autocomplete";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AutocompleteBody {
  partial?: string;
  recentTopic?: string;
}

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

  return NextResponse.json(
    buildAutocomplete({ partial: body.partial ?? "", recentTopic: body.recentTopic }),
  );
}
