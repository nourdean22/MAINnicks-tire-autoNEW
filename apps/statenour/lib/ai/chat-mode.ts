/**
 * Chat Mode Detection + Tool Pruning
 *
 * Nick has 159+ tools and a 50K-char system prompt — sending all of
 * that to Venice for a "tell me a joke" query is absurd overhead. For
 * small models (Venice GLM-4.7-flash) the prompt processing time for
 * a full 100K+ context window is 10-30s BEFORE the first token.
 *
 * This module classifies every incoming user message into one of
 * three modes, and prunes the tool catalog + context scope to match.
 *
 * Modes:
 *   • quick    — conversational, short, no data references
 *                → zero tools, lean prompt, fastest first-token
 *   • standard — typical data query or short reflection
 *                → domain-relevant tools only, normal context
 *   • deep     — long reflection, brain dump, strategic question
 *                → all tools, full context, agentic multi-step
 *
 * NONE of the existing tailoring is removed. Quick mode still has
 * Nick's full identity + personality; it just skips the 159-tool
 * catalog and the 30-memory context window. Deep mode is unchanged
 * from the old default.
 */

// Re-export from the client-safe detector. See lib/ai/chat-mode-detect.ts —
// split was required because this file (chat-mode.ts) pulls in
// ./tool-embeddings via a lazy require() inside pruneTools(), which
// transitively references `lib/ai/tools.ts` → googleapis →
// `child_process`. Turbopack can't tree-shake synchronous requires
// through named-export destructuring, so any client component
// importing from this file (ModePill, chat page) pulled the whole
// server tree into the browser bundle and failed the build.
//
// Rule: client-side only imports `@/lib/ai/chat-mode-detect`. This
// file (`chat-mode`) is server-only (routes, system prompt).
export { detectChatMode } from "./chat-mode-detect";
import { matchPlaybook } from "@/lib/ai/tools/playbooks";
import type { ChatMode } from "./chat-mode-detect";
export type { ChatMode };

/**
 * Prune the nourTools object down to a relevant subset for the given
 * mode + user message. Returns a new object — does not mutate the input.
 *
 * Two modes (Apr 17, quick removed):
 *   - standard : CORE tools + semantic top-15 + keyword matches
 *   - deep     : CORE tools + semantic top-40 + keyword matches, capped at 50
 *
 * The semantic layer uses cosine similarity between the user message
 * embedding and pre-computed tool embeddings — captures INTENT not
 * keywords. Keyword regex is the fallback path for cold cache.
 *
 * (2026-07-15 · stale Venice note removed — Venice is retired from
 * RUNTIME_PROVIDERS and every live provider in the chain is
 * tool-capable. The prune's job is purely context-budget control.)
 */
/**
 * Priority order for tier-4 keyword-family candidates.
 *
 * WHY THIS EXISTS. Tier 4 used `Array.from(keywordMatches).sort()` — plain
 * alphabetical. That reads as a harmless determinism device, and it is, right
 * up until the budget truncates: `addIfSpace` stops adding at TOOL_BUDGET, so
 * whatever order this list is in IS the selection policy for every tool past
 * slot 24. Measured on production 2026-09-16, over 192 recorded turns and
 * 5,227 gate decisions:
 *
 *   · 140/192 turns (72.9%) hit the budget cliff
 *   · ALLOWED tier-4 names averaged first-letter index 5.28 ("f")
 *   · BUDGETED_OUT names averaged 11.78 ("l")
 *   · 65.3% of tier-4 ALLOWED impressions went to tools the model NEVER chose
 *
 * A 6.5-letter gap is not relevance wearing an alphabetical disguise; the
 * pruner was choosing `analyzeSleep`/`getBodyData` over `searchWebVerified`
 * (cut 52x) and `githubRecentCommits` (cut 53x) because of their spelling. The
 * model then paid a whole extra generation step to claw those two back through
 * the searchTools/invokeTool recovery lane — 5 of 13 recorded recoveries were
 * for a web-search tool the keyword family HAD already matched and truncation
 * had dropped.
 *
 * Tier 5 (semantic rank) could not fix this: it was gated on
 * `selectedNames.size < TOOL_BUDGET`, so it was skipped on exactly the turns
 * where ranking matters (70.3% of turns skipped it).
 *
 * 2026-09-18 · THAT GATE IS GONE. Selection is now two-stage — every tier
 * gathers candidates, then tiers 4/5/6 are ranked TOGETHER on one cosine scale
 * before the cut. So this function no longer decides the cliff on its own; it
 * supplies tier 4's arrival order, which is the fallback whenever scoring does
 * not cover every contender. See STAGE 1 / STAGE 2 in `pruneTools`.
 *
 * WHAT THIS CHANGES — and does not. Ordering ONLY. The candidate set is
 * identical; when the budget does not truncate, the surfaced set is unchanged
 * down to the last tool. No tool becomes reachable that was not already
 * matched by a keyword family, so this cannot widen authority.
 *
 * Ranking applies only when `scores` COVERS EVERY CANDIDATE, so all of them are
 * comparable. Otherwise this falls back to alphabetical, because partial scores
 * sort the measured against the unmeasured — a different and worse policy than
 * the one being replaced.
 *
 * ⚠ THE COVERAGE CHECK IS DONE HERE, NOT INFERRED FROM CACHE WARMTH. The
 * caller gates on `isToolEmbeddingCacheWarm()`, and that is NOT the same claim:
 * `warmToolEmbeddings` catches a per-tool embedding failure, logs it, SKIPS
 * that tool — "keyword fallback will cover it" — and still sets
 * `warmComplete = true` afterwards. So a warm cache can be missing individual
 * tools, and under a score-descending order an unscored tool sorts below every
 * scored one. That would silently demote a tool for failing to EMBED, which is
 * the same shape as demoting one for its SPELLING — the defect this function
 * exists to remove, in a quieter costume. Found by self-review after shipping;
 * the earlier version of this paragraph claimed the coverage guarantee that the
 * code did not actually have.
 *
 * The unscored-last tiebreak below is kept as defence in depth: it is now
 * unreachable through the coverage guard, and must stay deterministic if some
 * future caller bypasses it.
 */
/**
 * Generic verbs that carry no capability signal on their own.
 *
 * Without this, `getTasks` would match on "get" + "tasks" and so would half the
 * catalog on any sentence containing a common verb — turning a precise
 * exact-mention tier into a flood that crowds out the keyword families beneath
 * it. A name must contribute at least one word that is actually ABOUT something.
 */
const GENERIC_NAME_TOKENS = new Set([
  "get", "set", "run", "do", "add", "list", "create", "update", "delete",
  "find", "search", "my", "the", "a", "an", "to", "of", "for", "and", "is",
]);

/** `sendTelegram` → `["send", "telegram"]`. Splits camelCase and separators. */
export function toolNameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Does `text` mention every word of a multi-word tool name?
 *
 * Order-insensitive and gap-tolerant, so "send me a telegram" reaches
 * `sendTelegram` while the old concatenated check could not. Deliberately
 * conservative in three ways, because this feeds the high-priority exact tier:
 *
 *   · single-token names are left to the existing substring check — "do" or
 *     "summarize" alone is not evidence of intent;
 *   · EVERY token must appear, so `searchDriveFiles` does not fire on a bare
 *     "search";
 *   · at least one token must be non-generic, so a sentence containing "get"
 *     and "the" cannot drag in a tool named `getThe…`.
 *
 * Word-boundary matched, so "telegram" does not match inside "telegrams" — it
 * does, via the \w* tail — but "gram" alone never matches "telegram".
 */
export function mentionsAllTokens(text: string, name: string): boolean {
  const tokens = toolNameTokens(name);
  if (tokens.length < 2) return false;
  if (!tokens.some((t) => !GENERIC_NAME_TOKENS.has(t) && t.length >= 4)) return false;
  return tokens.every((t) => new RegExp(`\\b${t}\\w*\\b`).test(text));
}

export function orderKeywordCandidates(
  names: Iterable<string>,
  scores: ReadonlyMap<string, number> | null,
): string[] {
  const alphabetical = Array.from(names).sort();
  if (!scores || scores.size === 0) return alphabetical;
  // Every candidate, or none. A single unscored tool disables ranking for this
  // turn rather than quietly sinking that one tool to the bottom.
  if (alphabetical.some((n) => !scores.has(n))) return alphabetical;
  return alphabetical.sort((a, b) => {
    const sa = scores.get(a);
    const sb = scores.get(b);
    if (sa === undefined && sb === undefined) return a < b ? -1 : a > b ? 1 : 0;
    if (sa === undefined) return 1;
    if (sb === undefined) return -1;
    if (sb !== sa) return sb - sa;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export async function pruneTools(
  mode: ChatMode,
  allTools: Record<string, unknown>,
  userContent: string,
  userEmbedding?: number[],
  // 2026-07-15 · conversation-aware matching. Keyword families keyed
  // ONLY on the current message, so short follow-ups ("try again",
  // "?") dropped the families the conversation needed — the model then
  // called tools that were no longer attached ("Model tried to call
  // unavailable tool 'arsenalWebSearch'" in tool telemetry) and told
  // the operator the capability was unavailable. The route passes the
  // recent user-message tail; triggers match against message + tail.
  opts?: {
    conversationTail?: string;
    /** 2026-09-03 - selection telemetry. Opt-in: when absent, no
     *  rows are written and behaviour is byte-identical to before. */
    turnId?: string;
    conversationId?: string;
  }
): Promise<Record<string, unknown>> {
  const isDeep = mode === "deep";

  // Filter out circuit-breaker-blocked tools BEFORE pruning. A tool
  // that's misbehaving shouldn't waste context budget showing up in
  // the toolset every turn during cooldown.
  // Dynamic import (not CommonJS require) keeps this module's import
  // graph small AND stays ESM/Edge-safe — a bare require() throws in
  // those runtimes.
  const { isToolBlocked } = await import("@/lib/ai/tool-telemetry");
  const allowedTools: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    if (!isToolBlocked(name)) allowedTools[name] = tool;
  }
  allTools = allowedTools;

  // Standard mode: core + semantic + keyword. Trigger text = current
  // message + recent-user-message tail (see opts doc above).
  const text = [userContent, opts?.conversationTail ?? ""]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  // Core tools — always included in standard mode. These are cheap
  // reads Nick should always be able to reach for basic situational
  // awareness.
  const CORE_TOOLS = [
    // ingestThought removed Apr 15 — brain-dump NL interceptor in
    // /api/ai/chat handles capture before the model is invoked.
    "searchMemories",
    "getRecentReflections",
    "searchReflections",
    // 2026-09-19 · DEMOTED: classifyThought, rankNextActions, getBlindSpots,
    // dailyPulse. FOUR of the five the audit flagged — createTask was flagged
    // too and is deliberately KEPT; see ACTION_CORE below for why the number
    // was not the whole answer there.
    //
    // Second application of the 2026-08-25 prescription, on the same evidence
    // shape and with the same discipline.
    //
    // MEASURED by `scripts/always-on-audit.ts` over 30 days / 259 turns: each
    // was surfaced on 259 of 259 turns and chosen ZERO times INSIDE that
    // window. Last calls were 66d, 66d, 43d and 37d — all predating the
    // window, so this is not "quiet lately", it is "earned nothing in the
    // period measured". Together with createTask below that is 1,295 always-on
    // impressions per 30 days returning nothing.
    //
    // ⚠ `lifetime_calls` is NOT the discriminator and must never be divided
    // into `surfaced` — createTask has 76 lifetime calls and is still cold.
    // See docs/agent-audit/DEFECT-SHAPE-STALE-DENOMINATOR.md.
    //
    // EACH KEEPS A DETERMINISTIC PATH — verified per tool, not assumed:
    //   · dailyPulse      → keyword families /daily/ and /dailyPulse/
    //   · getBlindSpots   → the `reflect` playbook, whose regex literally
    //                       contains "blind spot"
    //   · rankNextActions → the `execute` playbook ("what should i do next").
    //                       NOTE its only `addMatching` hit is the SEO family
    //                       via the substring "rank" — a FALSE match that
    //                       fires on marketing text, so it was never real
    //                       coverage and is not being relied on here.
    //   · classifyThought → had NONE. Family #14 was added above as a
    //                       precondition of this demotion.
    // Plus, for all four: exact-name mention (tier 3), semantic rank (tier 5,
    // which now competes rather than being skipped — #2468), and the
    // searchTools/invokeTool recovery lane.
    // 2026-08-25 · DEMOTED from always-on, on corrected numbers — the
    // first prune the surfacing instrumentation's discipline allows.
    // These three were offered on effectively EVERY standard/deep turn
    // since the telemetry epoch (2026-05-12; recent volume 764 turns/14d,
    // so >=2,000 offered-opportunities each — the INVERSE of the census's
    // pruner-confound), with lifetime selections:
    //   setTaskPriority   0 calls ever
    //   syncKnowledge     0 calls ever
    //   runDeviceCommand  1 call, on telemetry day one only
    // Per the census's own prescription they are DEMOTED to on-demand,
    // never deleted: each keeps a deterministic keyword family below
    // (task family already matches setTaskPriority via /task/i; device +
    // knowledge-sync families added), plus semantic ranking (embeddings
    // are boot-warmed since v10.0.532), exact-name mention, the help
    // family, and the searchTools/invokeTool recovery lane. Frees ~3
    // always-on schema slots (~300-500 tok) on every turn.
  ];

  // 2026-07-06 · the most-used WRITE tools are always attached too.
  //
  // 2026-09-19 · createTask was MEASURED COLD (259 impressions, 0 calls
  // inside a 30-day window, last call 37d) and is KEPT ANYWAY. Recording why,
  // because the number alone argues the other way.
  //
  // It looked like the safest demotion of the five — three apparent paths
  // back: the /task|…/ keyword family, the `execute` playbook, and the
  // action-intent force in `prepare-tools.ts:207-218`. Checking the third
  // against the actual patterns killed the idea. The regression this tier
  // exists for is a KEYWORD-LESS action turn — the pinned fixture is
  // literally "ok do it" — and `action-intent-detector.ts` requires either
  // "add/put/throw … to my todo/task list" or "add:"/"create:" with a colon
  // or quote. **"ok do it" matches none of them.** No family fires on it
  // either, and a cold cache silences the semantic tier. Demoting createTask
  // therefore re-opens the exact 2026-07-06 hole where the operator could not
  // create a task at all on that turn shape.
  //
  // ★ USAGE IS NOT THE ONLY CRITERION. A tool can be cold for 37 days and
  // still be load-bearing for a failure MODE rather than a volume. The audit
  // measures impressions-per-outcome; it cannot see "this is the last path on
  // a turn where every other path is silent". completeTask stays for the same
  // reason and is also warm (11d, inside the window).
  const ACTION_CORE = ["createTask", "completeTask"];

  // ── Exact tool name mention ──
  // If the user explicitly mentions a tool name, always include it.
  //
  // 2026-09-17 · this was `text.includes(name.toLowerCase())` ONLY — a single
  // concatenated token. `sendTelegram` therefore required the literal string
  // "sendtelegram", so "send me a telegram" — naming the tool's own transport —
  // did not reach it. MEASURED: sendTelegram was offered on 1 of 5 natural
  // phrasings and NEVER ONCE surfaced across 467 production turns, despite
  // carrying the entire durable-delegation contract (claim-before-send,
  // fail-closed idempotency, UNKNOWN fencing). The machinery was built, proven
  // and shipped for a capability nobody could ask for.
  //
  // The concatenated check stays (it is exact and cheap); a TOKEN check is
  // added beside it, so a camelCase name is reachable when its words appear in
  // any order with anything between them.
  const exactMentioned = new Set<string>();
  for (const name of Object.keys(allTools)) {
    const lowerName = name.toLowerCase();
    if (text.includes(lowerName) || mentionsAllTokens(text, name)) {
      exactMentioned.add(name);
    }
  }

  const keywordMatches = new Set<string>();
  // Keyword-based tool families
  //
  // The patterns below are tested against the TOOL NAME, not against the
  // user's text, and the test is UNANCHORED. A family's vocabulary therefore
  // leaks wherever one of its keywords appears inside an unrelated longer
  // word. Two measured specimens (2026-09-17):
  //
  //   /customer|people|relation|person|profile/  matches getHabitRevenueCorrelation,
  //                                              because cor-RELATION contains "relation"
  //   /mit|okr|target|goal|.../                  matches checkCom-MIT-ments
  //                                              and githubRecentCom-MIT-s
  //
  // A TOKEN-BOUNDARY RULE IS A TRADE-OFF, NOT A FREE WIN — and not a no-op.
  //
  // ⚠ An earlier version of this comment said the rule was "SAFE and
  // WORTHLESS". That was WRONG, and wrong for an instructive reason: the probe
  // behind it treated "some other family still matches" as proof a tool stays
  // reachable. Every family here is guarded by its OWN `if (user-text)` trigger
  // — 53 families, 53 distinct triggers, none shared — so a surviving family
  // only helps on the text that fires ITS trigger. Re-measured trigger-aware:
  //
  //   · 0 tools go fully dark
  //   · 12 go CONDITIONALLY dark — reachable only under a different trigger —
  //     and 4 of those are tools the model has actually chosen
  //     (checkCommitments, githubRecentCommits, arsenalResearch,
  //      arsenalDeepResearch)
  //   · up to 276 of 1,877 tier-4 impressions (14.7%) would be reclaimed from
  //     never-chosen tools
  //
  // So it buys real budget and costs real coverage. Whether that trade is good
  // depends on whether those 4 tools are being chosen BECAUSE of the accidental
  // match or in spite of it — which needs the per-turn `tool.chosen` join, and
  // that lane has no data yet. Decide it then, not from this comment.
  //
  // What spends the budget: 136 of 181 catalog tools (75.1%) have never been
  // chosen in chat, and tier 4 surfaces them correctly, from their own
  // families. On the median turn tier 4 takes all 15 non-core slots, and 65.3%
  // of tier-4 impressions go to never-chosen tools — while searchTools (the
  // model's own "you missed one" signal) fires on just 6.8% of turns. The
  // error is over-inclusion, not starvation, and the remedy is a catalog
  // decision, not a matcher change.
  //
  // Sample: 192 turns / 5,227 gate decisions, to 2026-09-17. SINGLE-SOURCED on
  // tool_telemetry: chat_messages.parts was meant to corroborate and records no
  // tool calls at all, so none of this is confirmed by a second instrument.
  //
  // Re-measure with scripts/probe-family-collisions.mjs before acting on any of
  // the above. It reads the live catalog and live telemetry, and aborts rather
  // than reporting a number it could not compute.
  const addMatching = (pattern: RegExp) => {
    for (const name of Object.keys(allTools)) {
      if (pattern.test(name)) keywordMatches.add(name);
    }
  };

  // Business / revenue / shop
  if (/\b(lead|customer|client|quote|estimate|invoice|callback|job|revenue|money|\$|pipeline|shop|aging|stale|decline|sale|conversion|ltv|winback|tire|repair|oil|brake)\b/.test(text)) {
    addMatching(/lead|customer|quote|estimate|invoice|revenue|pipeline|aging|callback|decline|ltv|winback|staff|tech|shop|tire|price/i);
  }

  // Tasks / missions / commitments
  if (/\b(task|todo|action|mission|goal|commit|promise|keep|break|pin|priority|overdue|late|stale)\b/.test(text)) {
    addMatching(/task|loop|commit|mission|triage|followup|schedule/i);
  }

  // Daily / habits / body / score
  if (/\b(score|habit|workout|body|sleep|energy|focus|water|log|today|yesterday|day|morning|evening|streak|adderall|wake|mood|food|meal|drift|drifting)\b/.test(text)) {
    addMatching(/score|habit|body|daily|workout|sleep|drift|mood/i);
  }

  // 2026-08-28 · Self-follow-up. MEASURED GAP, not a guess: after
  // scheduleSelfFollowUp shipped, 4 of 5 realistic phrasings never
  // surfaced it — "follow up with me tomorrow", "remind me in two hours",
  // "check back on this", "ping me if..." all missed, because the task
  // family's TRIGGER needs a word like task/todo/mission and none of them
  // contain one. The tool matched that family's ATTACH pattern (via
  // "schedule") but the family never fired, so the feature was
  // unreachable for exactly the words a human uses to ask for it.
  // MIRRORED in tests/ai/chat-mode-keyword-families.test.ts.
  if (/\b(follow[- ]?up|remind me|check back|circle back|nudge me|ping me|check in on|get back to me)\b/.test(text)) {
    addMatching(/scheduleSelfFollowUp|followup|remind/i);
  }

  // 2026-08-25 · Physical devices (runDeviceCommand demoted from
  // CORE_TOOLS — see the demotion note there). Deterministic trigger for
  // the phrasings the always-on slot existed for. MIRRORED in
  // tests/ai/chat-mode-keyword-families.test.ts.
  // Review fix (same day): "lights off" / "dim it" / "take a snapshot"
  // missed the first cut — and messages <=10 chars skip the embedding
  // fallback entirely (route.ts embedding gate), so the family is the
  // ONLY path for the shortest device phrasings. Bare lights?/dim/
  // snapshot added; over-attach is this file's accepted trade-off.
  if (/\b(lock|unlock|front door|garage|thermostat|lights?|dim|snapshot|take a (photo|picture|pic)|(turn|switch) (on|off)|device command|ring (doorbell|camera)|eufy|tuya)\b/.test(text)) {
    addMatching(/runDeviceCommand|device/i);
  }

  // 2026-08-25 · Knowledge sync (syncKnowledge demoted from CORE_TOOLS —
  // same note). Exact-name mention cannot catch the spaced phrasing
  // ("sync knowledge" !== "syncknowledge"), so the family carries it.
  // MIRRORED in tests/ai/chat-mode-keyword-families.test.ts.
  if (/\b(sync (my |the )?(knowledge|brain)|knowledge sync|re-?index (my )?(memories|knowledge|brain)|resync)\b/.test(text)) {
    addMatching(/syncKnowledge/i);
  }

  // 2026-07-11 · commitment reconciliation. The COMMAND-STATE prompt block
  // instructs Nick to completeCommitment(#id) when Nour reports having done
  // a promised thing — but casual completion reports ("i worked out",
  // "sent it", "that's done") matched no family, so the commitment write
  // tools were pruned on exactly the turns the rule fires. Prod symptom:
  // 69 active commitments, ~1 ever completed, Pulse nagging about done
  // promises. MIRRORED in tests/ai/chat-mode-keyword-families.test.ts.
  if (/\b(i (just )?(did|finished|completed|sent|worked out|hit the gym|ran|closed|handled) (?!nothing\b|not\b)|already (did|done|sent|handled)|(it|that|this)'?s done|took care of (it|that|the)|knocked (it|that) out|checked (it|that) off|done with (it|that|the))\b/i.test(text)) {
    addMatching(/commit|completeTask/i);
  }

  // Financial / projections / forecast
  if (/\b(money|\$|finance|budget|save|spend|invest|project|forecast|goal|target|net worth|savings|debt)\b/.test(text)) {
    addMatching(/financial|forecast|projection|goal|revenue|aging/i);
  }

  // People / customers / relationships
  if (/\b(dania|wife|family|kid|child|friend|customer|employee|tech|staff|manager|team)\b/.test(text)) {
    addMatching(/customer|people|relation|person|profile/i);
  }

  // v10.0.509 · SEO / search / traffic / rankings · ADR-0011 root-cause fix
  // The 2026-05-12 smoke test revealed Nick fabricated a fake "Google
  // logging error" instead of calling getGscSummary · because
  // getGscSummary wasn't in any keyword family and got pruned out in
  // standard mode. With no tool available, the high-spec gate's
  // "say I don't have data" directive didn't help · the model just
  // hallucinated a plausible narrative. Adding SEO/GSC/marketing family
  // so the tools are AVAILABLE when the user asks.
  if (/\b(seo|gsc|google search console|search console|impressions?|clicks|ctr|rankings?|search performance|organic|traffic|keywords?|nickstire\.org|autonicks\.com|search ranks?|domain|website performance|aeo|geo|marketing attribution|lead source|channel attribution|roi per source|what'?s? working|attribution)\b/.test(text)) {
    addMatching(/gsc|seo|search|impression|rank|traffic|keyword|marketing|attribution|channel/i);
  }

  // v10.0.510 · COMPREHENSIVE PRUNER EXPANSION · 9 missing families
  // Same root-cause pattern as the v10.0.509 GSC bug · audit of all 122
  // tools revealed 9 more categories that operator uses daily but the
  // pruner never surfaced. Each family below maps user-phrasing triggers
  // (left regex) to tool-name patterns (right addMatching regex).

  // Brain / recall / memory / wisdom / decisions
  // Triggers Nour uses constantly · "what did I", "remember when",
  // "what would Greene say", "skills I have", "previous decision",
  // "simulate", "anti-pattern", "notebooklm"
  if (/\b(remember|recall|what did i|what was the|previous|last time|history|conversation|chat history|skills i|my skills|greene|laws? of|wisdom|advise me|simulate|anti.?pattern|cold memory|blind spots?|decision (history|replay|journal)|reflect|reflection|brain health|emotional state|contradict|which is current|current belief|changed my mind|i was wrong|never mind|scratch that|i still believe|notebooklm|notebook|notebook lm)\b/.test(text)) {
    addMatching(/search|memory|conversation|reflection|greene|wisdom|simulate|anti.?pattern|brain|emotional|decision|skill|cold|contradiction|resolveContradiction|notebooklm/i);
  }

  // Code / repo / GitHub / deploy
  // Operator is a developer · talks about code constantly
  if (/\b(code|files?|commits?|pull request|prs?|issues?|repos?|deploy|github|functions?|classes?|modules?|imports?|build|typecheck|lint|test fail|stack trace|architecture)\b/.test(text)) {
    addMatching(/github|repo|deploy|file|code|architecture|coding/i);
  }

  // 2026-09-17 · GOOGLE DRIVE reads, distinct from the code/repo family above.
  // `searchDriveFiles` reached 0 of 2 phrasings: "search my google drive" names
  // the product exactly and still missed, because the code family matches on
  // `files?` and never reaches a tool whose name is about DRIVE. Naming the
  // product must be enough.
  //
  // ⚠ SCOPED TWICE, both narrowings found by review the same day:
  //
  // 1 · THE TRIGGER NAMES ONLY PROVIDERS THAT EXIST. It used to include
  //     `dropbox` and a generic `cloud storage`. There is no Dropbox connector
  //     anywhere in this app — measured: the string "dropbox" appears in
  //     lib/ and app/ exactly once, in this file, in the trigger itself. So
  //     asking about Dropbox offered Google Drive tools: the wrong datastore,
  //     confidently. A capability you cannot actually perform must not be
  //     surfaced as if you can.
  //
  // 2 · THE READ TOOLS ARE NAMED, NOT PATTERN-MATCHED. `/drive|document/i` also
  //     matched `syncDriveMemory`, which the catalog marks
  //     `sideEffecting: true, cost: "spendy"` — a bulk ingest offered on every
  //     "search my drive". It also pulled in `ingestDocumentFromUrl`. A READ
  //     intent must not put a write-and-spend tool in front of the model;
  //     `syncDriveMemory` stays reachable by exact name and by the semantic
  //     tier, which is where an explicit "sync my drive" belongs.
  //
  // Anchored on purpose: `^(...)$` cannot acquire a new member by someone
  // adding a tool whose name happens to contain "drive".
  if (/\b(google ?drive|my drive|gdrive|shared (drive|folder))\b/.test(text)) {
    // `listRecentDriveFiles` belongs here too — free, read-only, and the only
    // tool that answers "what's new in my Google Drive?". The first cut of this
    // allowlist dropped it, so that phrasing reached NO Drive tool at all on a
    // cold semantic cache. Narrowing a family must not remove the capability it
    // exists to reach.
    addMatching(/^(searchDriveFiles|readDriveFile|listRecentDriveFiles)$/);
  }

  // Email / inbox / Gmail / Telegram
  //
  // 2026-09-17 · the trigger required VERB-OBJECT ADJACENCY —
  // `send (a|the)? (message|note|email|telegram)` — so "send ME a telegram"
  // missed on the pronoun, and "ping me on telegram" / "notify me" missed
  // entirely. MEASURED: 1 of 5 natural phrasings reached `sendTelegram`, which
  // had never once surfaced in 467 turns. Bare "telegram" is now a trigger in
  // its own right (nobody says it accidentally), and the common self-notify
  // verbs are covered.
  if (
    /\b(email|inbox|gmail|telegram|message me|send (me )?(a |the )?(message|note|email|telegram)|reply to|draft|compose|forward)\b/.test(text) ||
    /\b(ping|text|notify|dm) me\b/.test(text) ||
    /\blet me know\b/.test(text)
  ) {
    addMatching(/email|gmail|telegram|compose/i);
  }

  // Image / generation / analysis / multimedia
  // CAREFUL · "image" is a common word · narrowing with intent triggers
  // 2026-09-17 · the READ side required "analyze this image" almost verbatim,
  // so "what's in this photo" and "look at this screenshot" were both dark and
  // `analyzeImage` reached 0 of 2 natural phrasings. Generation stays narrow —
  // "image" is a common word and the generate lane is expensive — but asking
  // ABOUT a supplied picture is a distinct, cheap, read-only intent.
  if (/\b(generate (an?|the)? (image|picture|photo|graphic)|create (an?|the)? (image|picture|photo)|draw (me )?(an?|the)? |make (an?|the)? (image|picture|photo)|analyze (this|the|that) (image|photo|picture)|extract from|run (this|the) code|solve (this|the)? (math|equation)|summarize this)\b/.test(text)) {
    addMatching(/image|analyze|extract|generateImage|runCode|solveMath|summarize|writeCreative/i);
  }
  // Asking about a picture that already exists — read-only, narrow on purpose:
  // it needs a demonstrative or possessive, so "a photo of the shop" (a topic)
  // does not drag the vision tools in.
  if (/\b(what('?s| is) (in|on)|look at|read|describe|what does)\b[^.?!]{0,30}\b(this|that|the|my|his|her|their) (photo|image|picture|screenshot|screen ?shot|scan)\b/.test(text)) {
    addMatching(/^analyzeImage$|^extractData$/i);
  }

  // Research / web search / external lookup
  if (/\b(research|web search|google (for|it|me)|look up|investigate|find (more about|info on|out about)|search the web|find leads|deep dive|fan.?out|multi.?agent)\b/.test(text)) {
    addMatching(/arsenal|research|fanout|web|deepResearch|multiAgent|findLeads/i);
  }

  // Drift / alerts / system health / status
  if (/\b(drift|alert|broken|crash|error|exception|outage|deploy(ed|ing)?|deploying|deployment|system (status|health)|tool (health|broken)|down|degraded|stale|fail(ed|ing)?)\b/.test(text)) {
    addMatching(/drift|alert|health|status|deploy|attention|tool/i);
  }

  // OKRs / MIT / weekly targets / goals · planning shape
  if (/\b(mit|main thing|top priority|okrs?|objectives?|key results?|weekly targets?|life goals?|set (a |my )?goal|north star|aim|targets?)\b/.test(text)) {
    addMatching(/mit|okr|target|goal|weeklyTargets|setLifeGoal/i);
  }

  // Routines · weekly / EOD / morning briefings
  if (/\b(weekly review|week (summary|recap|review)|end of day|eod|morning brief|daily pulse|analyze (my |this )?week)\b/.test(text)) {
    addMatching(/weeklyReview|analyzeWeek|endOfDay|dailyPulse|morningBrief/i);
  }

  // Browser automation / scrape / page extraction
  // 2026-09-16 · MEASURED: in 467 production turns the browser was used ZERO
  // times. Both BROWSERBASE credentials are present, six tools are built, and
  // the census put browser_navigate / browser_act / browser_observe /
  // browser_extract in `neverSurfaced` — offered to the model not once.
  //
  // Two defects, both here:
  //
  // 1. THE TRIGGER DID NOT MATCH HOW AN OPERATOR SPEAKS. It required "scrape",
  //    "automate the browser", "navigate to", or a literal "browser act". An
  //    episode against this very function (six unambiguous prompts, both modes)
  //    surfaced NO browser tool for any of them — including
  //    "go to monro.com and tell me what they charge" and a prompt containing a
  //    literal URL. A capability you cannot ask for in plain language is
  //    unreachable, whatever its tools can do.
  //
  // 2. `/browser_/` CANNOT MATCH `browseAndDo` — the tool meta.ts:298 names as
  //    the PREFERRED entry point ("For complete tasks … PREFER browseAndDo").
  //    So even on the rare trigger, the family surfaced the surgical low-level
  //    tools and skipped the recommended one. The comment at family #5 already
  //    recorded half of this ("the browser family pattern is /browser_/ only")
  //    and routed around it by adding a separate scrapeWebPage family instead.
  //
  // The split below follows the documented design rather than flattening it:
  // natural browse intent offers the ONE-CALL entry point (cheap on a 24-slot
  // budget); the surgical tools are offered only when named explicitly.
  //
  // Deliberately NOT stolen from family #5: "read the page", "fetch the url",
  // "convert to markdown" stay with scrapeWebPage. A static fetch is
  // deterministic and cheaper than a live browser session — prefer it when the
  // task is only to read a public page.
  if (
    /\b(scrape|extract from (the )?page|automate (the )?browser|navigate (to|the)|click (on|the)? button|fill (out|in) (the )?form|browse (to|the)|log ?in ?(to|into)|sign ?in ?(to|into)|go to (https?:\/\/|www\.)|look at (this|the|that) (site|website|page|url|link)|check (a|the|their|our|his|her) (site|website|listing|page))\b/.test(
      text,
    ) ||
    // "go to monro.com" — a bare domain, which no English-word pattern catches.
    /\bgo to [a-z0-9][a-z0-9-]*\.(com|org|net|io|co|us|gov|edu|info|biz)\b/.test(text) ||
    // The optional middle word carries "open our COMPETITOR'S website" and
    // "open the MONRO listing" — the possessive is rarely adjacent to the noun
    // in real phrasing, which is what the first cut of this pattern missed.
    /\bopen (the |their |our |its |his |her )?([\w'’-]+ )?(site|website|web ?page|portal|dashboard|listing|profile page)\b/.test(
      text,
    )
  ) {
    addMatching(/^browseAndDo$|^browser_do$/i);
  }

  // Surgical low-level control, only when the operator names the tool shape.
  // These are four extra budget slots; they should cost them on request, not
  // on every mention of a website.
  if (/\bbrowser (navigate|act|observe|extract)\b/.test(text)) {
    addMatching(/^browser_/i);
  }

  // v10.0.517 · Python / runtime execution / calculation
  // The v10.0.516 smoke test caught this gap · "run python", "calculate
  // this", "compute X", "plot Y" never surfaced runPython · Nick just
  // pasted text code back instead of executing.
  if (/\b(run python|run code|execute|python|pandas|numpy|matplotlib|plot|chart|calculate|compute|regression|geometric mean|standard deviation|histogram|scatter|csv)\b/.test(text)) {
    addMatching(/runPython|runCode|solveMath/i);
  }

  // v10.0.517 · Calendar / schedule / meetings
  // The v10.0.516 smoke test of "what's on my calendar today" returned a
  // generic "no events" reply with tools=0 in the trace · Nick was
  // bluffing because getTodaySchedule was pruned out. This family
  // surfaces it on schedule-shaped questions.
  if (/\b(calendar|schedule|meeting|appointment|event|free time|busy|available|book (me |a |some )?(time|slot|focus|block)|when (am|are|is) (i|we|my|the)|focus block|deep work block|reminder)\b/.test(text)) {
    addMatching(/Calendar|Schedule|Event/);
  }

  // v10.0.517 · Documents / files / uploaded artifacts
  // searchDocuments + ingestDocumentFromUrl pruned without this family.
  // Triggers when operator references "that PDF", "the spreadsheet",
  // "this document", or asks Nick to read a URL.
  if (/\b(document|pdf|word doc|spreadsheet|excel|csv file|read (this|that) (file|doc|pdf)|ingest|that (doc|pdf|file)|the (doc|pdf|spreadsheet)|search (my |the )?(docs|documents|files))\b/.test(text)) {
    // READ tools on a read-shaped trigger. `ingestDocumentFromUrl` is NOT in
    // this set: it fetches an arbitrary URL, parses and embeds it, and carries
    // a paid daily quota (tools/system.ts:292-299). "read the PDF in my Google
    // Drive" was surfacing it through THIS family, which made the read-only
    // boundary the Drive family claims untrue by a different route — narrowing
    // one matcher establishes nothing if a sibling matcher reopens it.
    addMatching(/^(searchDocuments|getDocument|readDocument)/);
    // Ingest is offered only when the operator actually ASKS to ingest.
    if (/\b(ingest|import|upload|add (this|that) (doc|pdf|file)|save (this|that) (doc|pdf|file))\b/.test(text)) {
      addMatching(/^ingestDocument/);
    }
  }

  // v10.0.524 · #1 Cross-conversation recall. Operator references
  // past discussions · "last time we talked about", "what did I
  // say about X", "pull up that thread".
  // 2026-07-04 · phrasing gap fix (chat-pipeline audit): the live
  // incident question "what else we chatted about today in other
  // sessions?" matched NOTHING — "sessions", plural "conversations",
  // and "we chatted" were never triggers, so the transcript tools were
  // pruned out on exactly the query class they exist for. Qualified
  // forms only ("other sessions", "my chats") so "gym session" doesn't
  // fire. MIRRORED in tests/ai/chat-mode-keyword-families.test.ts.
  if (/\b(last (time|week|month)|previously|earlier we|we discussed|we (talked|chatted) about|we chatted|chatted (about|today|yesterday)|what did i (say|discuss|mention)|pull up|prior conversation|that thread|the thread about|past chat|history of|continuing from|(other|past|previous|earlier|prior|all|my) (sessions?|convos?|conversations?|chats?|threads?)|in another (session|conversation|chat|thread))\b/.test(text)) {
    addMatching(/findRelatedConversations|searchConversations/);
  }

  // v10.0.524 · #4 Multi-source verified web search. Fact-check
  // shaped questions · "is it true that", "verify", "current rate",
  // "latest", "fact-check".
  if (/\b(verify|fact.?check|is it true|cross.?check|double.?check|confirm (that|whether)|current (rate|price|status)|latest (news|info|update)|what's the (latest|current)|happening now|breaking)\b/.test(text)) {
    addMatching(/searchWebVerified|perplexity/);
  }

  // v10.0.524 · #6 Skill suggestion. Operator asks "which skill",
  // "is there a skill for X", "what skill applies".
  if (/\b(which skill|what skill|skill for|skills? to|specialist lens|recommend.*skill|apply.*skill)\b/.test(text)) {
    addMatching(/suggestSkills/);
  }

  // v10.0.524 · #10 Anti-pattern surfacing. Operator asks "what do
  // I keep getting wrong", "am I about to repeat", "warn me about".
  if (/\b(anti.?pattern|keep getting wrong|repeat (mistake|pattern)|warn me|broken commitment|same mistake|history of)\b/.test(text)) {
    addMatching(/surfaceAntiPatterns|antiPattern/);
  }

  // v10.0.526 · Arc C · F7 · Second-location feasibility. Operator
  // mentions expansion · scoring an address · evaluating a candidate ·
  // "score this location", "evaluate <city> address", "second shop",
  // "expansion address", "second location", "rank these addresses",
  // "feasibility of <address>".
  if (/\b(second (location|shop|store)|expansion (address|location|site|target)|new (location|shop) (in|near|at)|evaluate (this|that|the) (address|location|spot|site)|score (this|that|the) (location|address|spot|site)|is this a good (spot|location|address|site)|expansion (model|plan|candidate)|rank (these |candidate )?(addresses|locations|spots|sites)|feasibility (of|for) (a |the )?(location|address|site)|cleveland (address|location|spot))\b/.test(text)) {
    addMatching(/scoreLocation/);
  }

  // Instagram / Facebook autoposting & scheduling
  // Covers spelling mistakes like "scheduale", "publis", "generat"
  if (/\b(instagram|insta|ig|facebook|fb|post|posts|posting|autopost|autoposter|autoposting|publish|publis|publsih|generate|generat|pre-?generate|schedule|scheduale|schedul)\b/.test(text)) {
    addMatching(/InstagramAutopost/i);
  }

  // v10.0.530 · Tools / capabilities / help
  // Surfaces a rich, representative set of tools across all families when
  // the operator asks about capabilities or help.
  if (/\b(tools?|capabilities|functions?|what (can you do|actions can you|tools do you)|help (me|menu)?)\b/.test(text)) {
    const helpTools = [
      "getTasks", "createTask", "addTasksToProject", "completeTask", "setTaskPriority",
      "getCommitments", "createCommitment", "updateCommitment",
      "getMissions", "createMissionPlan", "queueMissionExecution",
      "dailyPulse", "weeklyReview", "endOfDay",
      "searchMemories", "searchColdMemory", "searchConversations",
      "findCustomer", "queryNickstire", "compareLiveRevenue",
      "runPython", "searchWebVerified", "generateImage",
      "runDeviceCommand", "sendTelegram", "composeEmail",
      "getBlindSpots", "surfaceAntiPatterns", "suggestSkills",
      "getBodyData", "getHabitStreaks", "getMasteryScores"
    ];
    for (const name of helpTools) {
      if (allTools[name]) exactMentioned.add(name);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // v10.0.531 · TOOL-ATTACHMENT AUDIT · 13 confirmed coverage gaps
  // Same root-cause class as v10.0.510: the tool exists in the catalog
  // but no keyword family surfaced it on natural phrasings, so on a cold
  // embedding cache (semantic layer OFF) the model saw no tool and either
  // hallucinated or reported "no tool". A 13-category audit (2026-07-06)
  // confirmed each gap against the live regexes. MIRRORED in
  // tests/ai/chat-mode-keyword-families.test.ts.
  // ─────────────────────────────────────────────────────────────

  // #1 · Inline chart / data-viz. "chart of", "pie chart", "visualize" hit
  // the Python family (runPython/solveMath) — WRONG tool. Attach the
  // renderer too so the model can pick it for viz-shaped asks.
  if (/\b(chart of|pie chart|bar chart|line chart|render (a |the )?chart|visuali[sz]e|visuali[sz]ation|graph (of|this|the)|plot (of|this|the) (data|tasks|metrics))\b/.test(text)) {
    addMatching(/renderInlineChart/i);
  }

  // #2 · Business escape-hatch. queryNickstire runs free-form shop queries
  // (revenue_today, leads_pipeline, callbacks_pending, work_orders_active).
  // The business family trigger fires but its name-pattern never matched it.
  if (/\b(query (the )?(shop|business|nickstire)|shop data|business data|bookings?|pending callbacks?|work orders?|status of (our|the) (bookings?|jobs?|orders?))\b/.test(text)) {
    addMatching(/queryNickstire/i);
  }

  // #3 · Personal health · mental-health + burnout + composure. "am I okay",
  // "burning out", "overworking" matched NO family (the brain family needs
  // the bounded "emotional state"/"brain health"). Read-only analyzers.
  if (/\b(mental health|how (am|'?m) i doing (emotional|mental)|am i okay|am i ok\b|burn(ing)? ?out|burnout|overwork(ing|ed)?|work.?life balance|workload sustainable|work health|composure|am i composed|emotional regulation|how('?s| is) my (mood|stress|mental)|how stressed)\b/.test(text)) {
    addMatching(/analyzeMentalHealth|analyzeWorkHealth|analyzeComposure|getEmotionalState/i);
  }

  // #4 · Trend detection across personal metrics (analyzeTrends is
  // advertised in the system prompt but had no family). "what's changing",
  // "trending", "top movers".
  if (/\b(trend(ing|s| analysis)?|what'?s changing|what changed|top movers?|moving (up|down)|biggest changes?|shifts? in my)\b/.test(text)) {
    addMatching(/analyzeTrends/i);
  }

  // #5 · Web scraping / page extraction (scrapeWebPage / Firecrawl). The
  // browser family pattern is /browser_/ only; research never fired on
  // "scrape".
  if (/\b(scrape|scraping|extract (the )?(content|text) from|read (the |this |that )?(page|webpage|web page|url|link)|convert (the )?(page|url) to markdown|fetch (the )?(page|url))\b/.test(text)) {
    addMatching(/scrapeWebPage/i);
  }

  // #6 · Decision pre-flight. Planning shape "should I", "risks before I
  // decide". Deliberately separate from the brain family (which scopes
  // "decision" to history/replay/journal).
  if (/\b(should i|help me (think through|decide)|thinking through|before i decide|risks? before|pros and cons|weigh (this|the) (option|choice|decision)|i'?m considering|what if i)\b/.test(text)) {
    addMatching(/decisionPreFlight/i);
  }

  // #7 · Power dynamics / leverage / Greene tactics. analyzePowerDynamics,
  // getPowerBalanceSummary, getDarkPsychologyTactics, getContextualGreeneLaws
  // had no family. "power dynamics", "leverage over", "manipulation tactics".
  // AG-31 · recommendNextMove joins the family + move-asking phrasings.
  if (/\b(power (dynamics?|balance|position)|leverage (over|across|with)|who (has|holds) power|relationship (leverage|strategy)|cognitive bias|manipulation (tactics?|techniques?)|psychology tactics?|dark psychology|next move|my move|how (do|should) i (respond|handle|counter|play))\b/.test(text)) {
    addMatching(/analyzePowerDynamics|getPowerBalanceSummary|getDarkPsychologyTactics|getContextualGreeneLaws|recommendNextMove/i);
  }

  // #8 · Recent-sentiment research + short-video generation. last30days
  // (Reddit/HN/GitHub/YouTube) and moneyprinter (video gen) had no trigger.
  // 2026-07-15 · social/web-trends phrasing gap (live incident): "current
  // internet trends / recent content on twitter and reddit" matched NO web
  // family — platform names (twitter/reddit), "social media", "forums", and
  // qualified "trends" phrasings were never triggers, so Nick replied
  // "search tools aren't available this session" while last30days /
  // searchWebVerified / arsenalWebSearch sat pruned. Triggers broadened and
  // the family now attaches the full web stack, not just last30days. Bare
  // "trend(s|ing)" stays with the analyzeTrends family (#4). 2026-07-15b ·
  // typo variants per AGENTS.md §11.1 (twiter/tweeter, redit, trendin,
  // hackernews, socials) — matchers must survive fast phone typing. MIRRORED
  // in tests/ai/chat-mode-keyword-families.test.ts.
  if (/\b(twit?ter|tweeter|red?dit|x\.com|hacker ?news|social media|socials|(dating |online |internet |web )?forums?|(internet|online|current|latest|recent) trends?|what'?s trendin'?g?|trendin'?g? (on|in|online|lately|right now|these days)|trendin'?g? (in the )?last (month|30 ?days|week)|recent sentiment|recent (content|posts?)|what (are )?people (discussing|saying|posting) (lately|recently)|last 30 days|red?dit sentiment)\b/.test(text)) {
    addMatching(/last30days|searchWebVerified|arsenalWebSearch|scrapeWebPage/i);
  }
  if (/\b(tiktok|reel|short video|make (a |the )?video|generate (a |the )?video|create (a |the )?(short )?video|youtube short|video from (this|that|the) script)\b/.test(text)) {
    addMatching(/moneyprinter/i);
  }

  // #9 · Business dashboard + attention alerts. Names don't match the
  // business pattern, and "dashboard"/"alerts"/"urgent" weren't triggers.
  // (Note the PLURAL "alerts" — a bare /\balert\b/ misses it.)
  if (/\b(dashboard|business summary|what needs (my )?attention|what'?s urgent|show me (my )?alerts?|attention (alerts?|items?)|needs? action)\b/.test(text)) {
    addMatching(/getDashboardSummary|getAttentionAlerts/i);
  }

  // #10 · Cron / scheduled-job status. "cron" appears in no family trigger.
  if (/\b(cron|crons|cron jobs?|scheduled (tasks?|jobs?)|are my (crons?|jobs?) running|job status|which (crons?|jobs?) failed)\b/.test(text)) {
    addMatching(/getCronStatus/i);
  }

  // #11 · Competitive intelligence. "competitive analysis", "where are we
  // weak", "market position". No family covered competitive intent.
  if (/\b(competitive (analysis|intel|intelligence)|competitors?|where are we weak|our (weakness|vulnerabilit)|market position|how do we (compare|stack up)|benchmark)\b/.test(text)) {
    // 2026-07-11 review · compareCompetitors (business.ts) is a DIFFERENT
    // tool from analyzeCompetitiveIntel and had no family — unreachable on
    // cold start. Same trigger, both tools.
    addMatching(/analyzeCompetitiveIntel|compareCompetitors/i);
  }

  // #12 · Customer SMS staging (approval-gated). stageCustomerAlert is NOT
  // in the email family. "text this customer", "stage SMS for review".
  // Wave 3 (2026-07-29): the Decision-Inbox pair rides the same trigger —
  // opportunity rows get draft/send via the bounded bridge action (identity
  // from the queue row), free-form numbers stay on stageCustomerAlert. The
  // tool descriptions carry the routing rule; attach all three plus the
  // inbox read so the model can resolve "text the stale lead" end-to-end.
  if (/\b(sms|text (the |this |a )?customer|send (an? )?(sms|text) to|stage (a |an )?(customer )?(alert|sms|text)|(customer )?outreach via (sms|text)|text (the |that )?(lead|opportunity)|follow up with .* (lead|estimate|opportunity))\b/i.test(text)) {
    addMatching(/stageCustomerAlert|draftOpportunitySms|sendOpportunitySms|getTopDecisions/i);
  }

  // #13 · Situation logging. "log this situation", "record this moment". The
  // daily family catches "log" but its pattern doesn't match logSituation.
  if (/\b(log (this |the )?situation|record (this|a) (strategic )?(moment|situation)|i just (encountered|hit|ran into)|note this situation)\b/.test(text)) {
    addMatching(/logSituation/i);
  }

  // #14 · 2026-09-19 · Thought classification. `classifyThought` answers
  // "am I overthinking this" / "what am I doing right now" — it labels a
  // thought (raw / thinking / reasoning / insight / decision / reflection /
  // planning / venting) and stores NOTHING.
  //
  // ADDED AS A PRECONDITION OF DEMOTING IT, not as a nice-to-have. It was in
  // CORE_TOOLS, so it reached every turn for free and needed no family. A
  // coverage sweep of all 54 `addMatching` name-patterns found **zero** that
  // match it — and the reflect playbook does not carry it either. Demoting it
  // without this family would have removed its only deterministic path and
  // left exact-name mention plus a warm embedding cache, which is precisely
  // the "made it unreachable" outcome a demotion must not produce.
  //
  // Deliberately NOT keyed on bare "thought"/"thinking": those appear in
  // ordinary conversation constantly and would re-create the flood this tier
  // exists to avoid. Keyed on the ASKING shapes the description names.
  if (/\b(overthink(ing)?|am i (overthinking|spiralling|spiraling|ruminating)|what am i doing (right now|here)|classify (this|my) (thought|thinking)|what kind of thought|is this (a )?(decision|venting|reasoning|reflection)|just venting)\b/.test(text)) {
    addMatching(/classifyThought/i);
  }

  // ── v10.0.532 · TOOL-ATTACHMENT FOLLOWUPS ──
  // Camera Intelligence
  if (/\b(camera (intel|feed|security|shop|image|picture)|footage|what'?s on (the )?camera)\b/.test(text)) {
    addMatching(/getCameraIntelligence/i);
  }
  // Review Stats
  if (/\b(review stats|feedback ratings?|review count|shop reviews?|google reviews?)\b/.test(text)) {
    addMatching(/getReviewStats/i);
  }
  // Top Services: retired 2026-10-08 with the getTopServices tool. Its bridge query
  // (revenue_top_services) was never built, and invoice service descriptions have mostly
  // stopped arriving (1 of 30 in Aug 2026), so a ranked list would describe ~3% of tickets.
  // Pricing Advisory
  if (/\b(pricing advisory|price advice|pricing advice|pricing review|competitive pricing|pricing guide|what should we charge)\b/.test(text)) {
    addMatching(/pricingAdvisorySummary/i);
  }
  // Weight Trend
  if (/\b(weight trend|weight gain|weight loss|scale weight|my weight|body weight progress|weight stats)\b/.test(text)) {
    addMatching(/analyzeWeightTrend/i);
  }
  // SQL Generation
  if (/\b(generate sql|write sql|sql query for|write database query|raw sql for)\b/.test(text)) {
    addMatching(/generateSQL/i);
  }
  // Simulation
  if (/\b(run simulation|simulate project|project simulation|simulate scenario|simulation for)\b/.test(text)) {
    addMatching(/runSimulation/i);
  }
  // Fitness analysis (2026-07-11 review · analyzeFitness had no keyword
  // family — unreachable on a cold lambda when the embedding cache is
  // empty; the health family's score|habit|body|workout doesn't include
  // "fitness" and its addMatching pattern doesn't match analyzeFitness)
  if (/\b(fitness (analysis|progress|trend|report)|my fitness|analyze (my )?fitness|workout (progress|trend|analysis|history)|training progress|how('?s| is) my (fitness|training))\b/.test(text)) {
    addMatching(/analyzeFitness/i);
  }



  const selectedNames = new Set<string>();

  // 2026-08-12 · env-tunable tool budget (VNext wave). Tool-selection
  // precision degrades sharply as the exposed-tool count grows, and the
  // old ceiling was a hardcoded 50. NICK_TOOL_BUDGET tunes it (default
  // 24 — halves deep-mode exposure; floor 10 keeps CORE + ACTION_CORE
  // coherent). The tiers below are priority-ordered, so the budget keeps
  // the highest-priority tools: core → action-core → exact mentions →
  // keyword families → semantic rank. Intent-critical tools remain
  // guaranteed REGARDLESS of this budget — prepare-tools re-adds
  // alwaysOn / action-intent / web-search tools AFTER pruning, so a
  // tight budget can never break a step-0 toolChoice force.
  const TOOL_BUDGET = Math.max(10, Number(process.env.NICK_TOOL_BUDGET) || 24);

  // 2026-09-03 · selection telemetry. Records WHICH tier supplied each
  // tool and which candidates fell off the budget cliff. Previously a
  // dropped tool left no trace at all, so the ~40 keyword regexes in
  // tier 4 could only be maintained one anecdote at a time.
  const tierOf = new Map<string, number>();
  const budgetedOut = new Map<string, number>();
  // A skipped tier is not a cold cache. Keep those states separate so the
  // telemetry cannot fabricate a cache failure when earlier tiers filled the
  // budget or the turn had no embedding.
  let semanticTierAttempted = false;
  let embeddingCacheWarm = false;

  // ── STAGE 1 · GATHER ──────────────────────────────────────────────────
  //
  // 2026-09-18 · two-stage selection. This used to be ONE pass: every tier
  // called `addIfSpace`, which stopped adding at TOOL_BUDGET, so each tier's
  // share of the 24 slots was decided by ARRIVAL ORDER rather than relevance.
  // Measured over 2,616 prod gate decisions: candidates p50 43 against
  // selected p50 24, the budget truncating on 80.4% of turns, and tier 4
  // (keyword families) taking the median turn's entire non-core allowance —
  // which left the SEMANTIC tier skipped on 73.2% of turns while 65.3% of
  // tier-4 ALLOWED impressions went to tools the model never chose.
  //
  // A pre-emptive RESERVE for the semantic tier was tried first and reverted:
  // it allocates before it knows, so it changed membership even on turns where
  // the budget never truncated. Two-stage ranks AFTER it knows — stage 1 drops
  // nothing, and stage 2 owns the entire cliff.
  //
  // Tiers 1/2/3/7 are INTENT, not similarity: core, action-core, an explicit
  // tool name in the prompt, a matched playbook. They are never contested, so
  // no similarity score can displace something the operator literally asked
  // for. Only tiers 4/5/6 compete.
  //
  // ⚠ ONE DELIBERATE REORDER, CALLED OUT BECAUSE IT IS A BEHAVIOUR CHANGE:
  // the single pass ran 1,2,3,4,7,5,6, so tier 7 (playbook) filled AFTER the
  // keyword families and could be truncated away by them. Splitting on
  // intent-vs-similarity necessarily moves it to 1,2,3,7 then 4/5/6. A
  // playbook is a small curated bundle matched on explicit intent; the ~40
  // tier-4 regex families are generic. Under truncation the bundle should win,
  // and 65.3% of tier-4 impressions going to never-chosen tools is the
  // evidence that it was losing to the wrong thing. Putting tier 7 into the
  // contested pool instead is NOT an option: it carries no similarity score,
  // and one unscored candidate disables ranking for the whole pool.
  const guaranteed: { name: string; tier: number }[] = [];
  const contested: { name: string; tier: number; arrival: number; score?: number }[] = [];
  const offeredOnce = new Set<string>();

  /**
   * FIRST TIER WINS on a duplicate. A tool offered by both the keyword families
   * and the semantic ranker is attributed to keywords — which is what the
   * single-pass version did, and what the tier telemetry has always meant.
   * Attribution is not a union.
   */
  const keep = (name: string, tier: number) => {
    if (!allTools[name] || offeredOnce.has(name)) return;
    offeredOnce.add(name);
    guaranteed.push({ name, tier });
  };
  const contend = (name: string, tier: number, score?: number) => {
    if (!allTools[name] || offeredOnce.has(name)) return;
    offeredOnce.add(name);
    contested.push({ name, tier, arrival: contested.length, score });
  };

  // Tier 1: CORE_TOOLS
  for (const name of CORE_TOOLS) {
    keep(name, 1);
  }

  // Tier 2: ACTION_CORE
  for (const name of ACTION_CORE) {
    keep(name, 2);
  }

  // Tier 3: Exact tool-name mentions (explicit user intent)
  const sortedExact = Array.from(exactMentioned).sort();
  for (const name of sortedExact) {
    keep(name, 3);
  }

  // Tier 4: Deterministic natural-language keyword-family matches.
  //
  // ORDER IS POLICY here, not presentation — see orderKeywordCandidates for
  // the production measurement. Rank by semantic similarity so that when the
  // budget truncates it drops the least relevant candidates instead of the
  // alphabetically-last ones.
  let keywordScores: Map<string, number> | null = null;
  if (userEmbedding && userEmbedding.length > 0 && keywordMatches.size > 0) {
    try {
      const { scoreToolsBySimilarity, isToolEmbeddingCacheWarm } = await import("./tool-embeddings");
      // Rank only against a WARM cache, so every candidate is comparable.
      // A partial score map would sort the measured against the unmeasured —
      // a different policy from the alphabetical one, and not obviously better.
      if (isToolEmbeddingCacheWarm()) {
        keywordScores = scoreToolsBySimilarity(userEmbedding, keywordMatches);
      }
    } catch (err) {
      // Ranking is an optimisation. A failure here must never change WHICH
      // tools are candidates — fall through to the alphabetical order this
      // replaced, and say so rather than swallowing it.
      void import("@/lib/utils/error-log")
        .then(({ logError }) => logError("ai.chat-mode", err, { fn: "pruneTools/keywordRank" }))
        .catch((e) => console.error("ai.chat-mode import error", e));
    }
  }
  const sortedKeyword = orderKeywordCandidates(keywordMatches, keywordScores);
  // Position within the tier-4 priority list, so the telemetry can later show
  // WHERE the cliff fell and whether ranking moved the right tools above it.
  // `rank`/`score` have existed on GateDecision since the table shipped and
  // nothing ever wrote them — a column with no producer reports nothing.
  const keywordRank = new Map<string, number>();
  sortedKeyword.forEach((name, i) => keywordRank.set(name, i));
  for (const name of sortedKeyword) {
    contend(name, 4, keywordScores?.get(name));
  }

  // Tier 7 (U7 · 2026-09-08): intent playbooks — one bundle per recurring job
  // (reflect / execute / publish). Adds only; recorded under its own tier so the
  // telemetry can answer whether the bundle was used.
  const playbook = matchPlaybook(userContent);
  if (playbook) {
    for (const name of playbook.tools) keep(name, 7);
  }

  // Tier 5: Semantic-ranked tools.
  //
  // The `selectedNames.size < TOOL_BUDGET` guard that used to sit here is GONE,
  // and removing it is the point of the rewrite: that guard is precisely what
  // made the semantic tier a leftovers tier, skipped on 73.2% of prod turns
  // because tier 4 had already filled the budget. Gathering costs one cosine
  // pass over a warm in-memory cache; the cliff moved to stage 2.
  if (userEmbedding && userEmbedding.length > 0) {
    semanticTierAttempted = true;
    try {
      const { rankToolsBySimilarity, isToolEmbeddingCacheWarm } = await import("./tool-embeddings");
      embeddingCacheWarm = isToolEmbeddingCacheWarm();
      if (embeddingCacheWarm) {
        const topN = isDeep ? 40 : 15;
        const ranked = rankToolsBySimilarity(userEmbedding, topN, 0.25);
        for (const [name, score] of ranked) {
          contend(name, 5, score);
        }
      }
    } catch (err) {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.chat-mode", err, { fn: "pruneTools" })).catch((e) => console.error("ai.chat-mode import error", e));
    }
  }

  // Tier 6: Default extras (if only core tools were matched).
  //
  // The old condition was `selectedNames.size === coreAndActionInRegistry.length`
  // — "nothing but core got in". Stage 1 has not selected anything yet, so the
  // equivalent test is the one below: no exact mention, no keyword family, no
  // playbook and no semantic candidate offered anything. Same turns, stated
  // against what is actually known at this point.
  const coreAndActionInRegistry = [...CORE_TOOLS, ...ACTION_CORE].filter(n => allTools[n]);
  if (guaranteed.length === coreAndActionInRegistry.length && contested.length === 0) {
    // 2026-08-12 · getAgendaItems added: the default tier fires exactly
    // on casual turns — the same turns the JIT prompt gate drops the
    // inline agenda section on, so the retrieval path must be present.
    const defaults = ["getCommitments", "getAgendaItems", "getTasks", "dailyPulse", "findCustomer"];
    for (const name of defaults) {
      contend(name, 6);
    }
  }

  // ── STAGE 2 · RANK, THEN TRUNCATE ─────────────────────────────────────
  //
  // Guaranteed tools take their slots first, in tier order, exactly as before.
  // Whatever remains is fought over by tiers 4/5/6 on ONE comparable scale.
  //
  // WHY THE SCALES ARE COMPARABLE AT ALL, which is the fact this rests on:
  // tier 4 scores its candidates with `scoreToolsBySimilarity(userEmbedding, …)`
  // and tier 5 ranks with `rankToolsBySimilarity(userEmbedding, …)` — the same
  // cosine metric against the same embedding. They were never incomparable;
  // they were just never compared.
  //
  // PARTIAL COVERAGE DISABLES RANKING, matching `orderKeywordCandidates`. If any
  // contested candidate is unscored, sorting would rank the measured against the
  // unmeasured, which is a different policy and not obviously a better one. The
  // fallback is arrival order — byte-identical to the single-pass behaviour.
  // That is also what makes "no embedding" and "cold cache" structurally safe:
  // both leave every candidate unscored, so both keep today's exact output.
  // `Number.isFinite`, NOT `typeof === "number"`. Cosine similarity divides by
  // the product of two magnitudes, so a zero-magnitude embedding yields NaN —
  // and `typeof NaN === "number"` is TRUE. A NaN would pass this guard, then
  // `b.score - a.score` is NaN, and `NaN !== 0` is true, so the comparator
  // RETURNS NaN. A comparator that returns NaN makes the sort order
  // implementation-defined: the budget would then cut by nothing in particular
  // while every log said ranking was applied. Non-finite scores fall the whole
  // pool back to arrival order instead, which is the documented safe path.
  const everyContenderScored =
    contested.length > 0 && contested.every((c) => Number.isFinite(c.score));
  const ranked = [...contested];
  if (everyContenderScored && process.env.NICK_TOOL_RANK_MERGED !== "0") {
    ranked.sort((a, b) => {
      const d = (b.score ?? 0) - (a.score ?? 0);
      // Ties break by arrival, which is tier order then within-tier rank, so
      // the output is deterministic for a fixed input.
      return d !== 0 ? d : a.arrival - b.arrival;
    });
  }

  // THE BUDGET BINDS ON GUARANTEED TOOLS TOO. The single-pass version ran
  // every tier through the same `addIfSpace`, so even CORE_TOOLS stopped at
  // TOOL_BUDGET. Exempting `guaranteed` here would let an operator who sets
  // NICK_TOOL_BUDGET=10 still receive core + exact mentions + a playbook well
  // past their own ceiling — a budget that is not a budget.
  const take = (name: string, tier: number) => {
    if (selectedNames.size >= TOOL_BUDGET) {
      // Considered and lost. Recorded under the tier that offered it, so the
      // telemetry still answers "which tier paid for the cliff".
      if (!budgetedOut.has(name)) budgetedOut.set(name, tier);
      return;
    }
    tierOf.set(name, tier);
    selectedNames.add(name);
  };

  for (const { name, tier } of guaranteed) take(name, tier);
  for (const { name, tier } of ranked) take(name, tier);

  const kept: Record<string, unknown> = {};
  for (const name of selectedNames) {
    kept[name] = allTools[name];
  }

  // 2026-09-03 · Fire-and-forget selection telemetry. Opt-in on
  // opts.turnId, so every existing caller is byte-identical. Never
  // awaited and never throws (CIITTY: don't crash the API on a missing
  // table) - the backing tables land with
  // prisma/migrations-pending/20260903120000_tool_selection_telemetry.
  if (opts?.turnId) {
    const turnId = opts.turnId;
    const conversationId = opts.conversationId;
    void import("./tool-selection-telemetry")
      .then(({ recordToolSelection }) =>
        recordToolSelection({
          turnId,
          conversationId,
          mode,
          // ⚠⚠ 2026-09-18 · TWO-STAGE MOVED THIS METRIC'S DENOMINATOR. Do not
          // compare a post-two-stage `candidateCount` or `budgetTruncated`
          // against a pre-two-stage baseline.
          //
          // The single pass SKIPPED tier 5 whenever the budget was already
          // full, so on those turns its candidates were never considered and
          // never landed in `budgetedOut` — they were invisible to this count.
          // Stage 1 now gathers from every tier unconditionally, so the same
          // traffic reports MORE candidates and MORE truncation. Both numbers
          // going up is the instrument seeing what it previously missed, not
          // the cliff getting worse.
          //
          // `scripts/tool-reachability-census.ts` compares `budgetTruncated`
          // to a 72.9% baseline and will read the rise as a regression unless
          // the reader knows this. Its header carries the same warning.
          candidateCount: selectedNames.size + budgetedOut.size,
          selectedCount: selectedNames.size,
          budget: TOOL_BUDGET,
          budgetTruncated: budgetedOut.size > 0,
          semanticTierAttempted,
          embeddingCacheWarm,
          decisions: [
            ...Array.from(selectedNames).map((name) => ({
              toolName: name,
              verdict: "ALLOWED" as const,
              tier: tierOf.get(name),
              rank: keywordRank.get(name),
              score: keywordScores?.get(name),
            })),
            ...Array.from(budgetedOut.entries()).map(([name, tier]) => ({
              toolName: name,
              verdict: "BUDGETED_OUT" as const,
              tier: tier || undefined,
              // A cut candidate's rank is the whole point: it says how far
              // past the cliff the tool sat, which distinguishes "just
              // missed" from "never close".
              rank: keywordRank.get(name),
              score: keywordScores?.get(name),
            })),
          ],
        })
      )
      .catch(() => {
        /* telemetry must never affect the turn */
      });
  }

  return kept;
}

/**
 * Metrics for the chat route to log so we can see how often each mode
 * is triggered and how the pruning is performing in production.
 */
export function describeMode(
  mode: ChatMode,
  allToolCount: number,
  prunedToolCount: number
): string {
  return `mode=${mode} tools=${prunedToolCount}/${allToolCount}`;
}
