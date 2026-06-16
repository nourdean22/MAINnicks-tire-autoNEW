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
 * Note: the current Venice model (venice-uncensored) doesn't support
 * tool calling at all; veniceFetch strips tools+tool_choice before
 * hitting Venice. This prune still runs so that when we route to a
 * tool-capable provider or model, we pass the right slice.
 */
export async function pruneTools(
  mode: ChatMode,
  allTools: Record<string, unknown>,
  userContent: string,
  userEmbedding?: number[]
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

  // Standard mode: core + semantic + keyword
  const text = userContent.toLowerCase();
  const kept: Record<string, unknown> = {};

  // Core tools — always included in standard mode. These are cheap
  // reads Nick should always be able to reach for basic situational
  // awareness.
  const CORE_TOOLS = [
    // ingestThought removed Apr 15 — brain-dump NL interceptor in
    // /api/ai/chat handles capture before the model is invoked.
    "classifyThought",
    "searchMemories",
    "getRecentReflections",
    "searchReflections",
    "rankNextActions",
    "getBlindSpots",
    "syncKnowledge",
    "dailyPulse",
    // Apr 20 — setTaskPriority is cheap + high-intent (Nour
    // explicitly saying "this is critical"). Always surface.
    "setTaskPriority",
    // Apr 20 — runDeviceCommand bridges chat → physical devices.
    // "lock the front door" / "turn off shop lights" etc.
    "runDeviceCommand",
  ];
  for (const name of CORE_TOOLS) {
    if (allTools[name]) kept[name] = allTools[name];
  }

  // ── SEMANTIC LAYER (when available) ──
  // If the tool embedding cache is warm AND we have a user message
  // embedding, rank tools by cosine similarity. Deep mode gets a
  // wider net (top 40) so agentic workflows have room to plan;
  // standard mode keeps the tight top-15.
  if (userEmbedding && userEmbedding.length > 0) {
    try {
      // Dynamic import (ESM/Edge-safe) — avoids module cycles + the
      // bare-require() throw in non-CommonJS runtimes.
      const { rankToolsBySimilarity, isToolEmbeddingCacheWarm } = await import("./tool-embeddings");
      if (isToolEmbeddingCacheWarm()) {
        const topN = isDeep ? 40 : 15;
        const ranked = rankToolsBySimilarity(userEmbedding, topN, 0.25);
        for (const [name] of ranked) {
          if (allTools[name]) kept[name] = allTools[name];
        }
      }
    } catch {
      // Fall through to keyword path
    }
  }

  // Keyword-based tool families
  const addMatching = (pattern: RegExp) => {
    for (const [name, tool] of Object.entries(allTools)) {
      if (pattern.test(name)) kept[name] = tool;
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
  // "simulate", "anti-pattern"
  if (/\b(remember|recall|what did i|what was the|previous|last time|history|conversation|chat history|skills i|my skills|greene|laws? of|wisdom|advise me|simulate|anti.?pattern|cold memory|blind spots?|decision (history|replay|journal)|reflect|reflection|brain health|emotional state|contradict|which is current|current belief|changed my mind|i was wrong|never mind|scratch that|i still believe)\b/.test(text)) {
    addMatching(/search|memory|conversation|reflection|greene|wisdom|simulate|anti.?pattern|brain|emotional|decision|skill|cold|contradiction|resolveContradiction/i);
  }

  // Code / repo / GitHub / deploy
  // Operator is a developer · talks about code constantly
  if (/\b(code|files?|commits?|pull request|prs?|issues?|repos?|deploy|github|functions?|classes?|modules?|imports?|build|typecheck|lint|test fail|stack trace|architecture)\b/.test(text)) {
    addMatching(/github|repo|deploy|file|code|architecture|coding/i);
  }

  // Email / inbox / Gmail / Telegram
  if (/\b(email|inbox|gmail|message me|send (a |the )?(message|note|email|telegram)|reply to|draft|compose|forward)\b/.test(text)) {
    addMatching(/email|gmail|telegram|compose/i);
  }

  // Image / generation / analysis / multimedia
  // CAREFUL · "image" is a common word · narrowing with intent triggers
  if (/\b(generate (an?|the)? (image|picture|photo|graphic)|create (an?|the)? (image|picture|photo)|draw (me )?(an?|the)? |make (an?|the)? (image|picture|photo)|analyze (this|the|that) (image|photo|picture)|extract from|run (this|the) code|solve (this|the)? (math|equation)|summarize this)\b/.test(text)) {
    addMatching(/image|analyze|extract|generateImage|runCode|solveMath|summarize|writeCreative/i);
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
  if (/\b(scrape|extract from (the )?page|automate (the )?browser|navigate (to|the)|click (on|the)? button|fill (out|in) (the )?form|browser (do|act|navigate|observe|extract))\b/.test(text)) {
    addMatching(/browser_/i);
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
    addMatching(/Document|searchDocuments|ingestDocument/);
  }

  // v10.0.524 · #1 Cross-conversation recall. Operator references
  // past discussions · "last time we talked about", "what did I
  // say about X", "pull up that thread".
  if (/\b(last (time|week|month)|previously|earlier we|we discussed|we talked about|what did i (say|discuss|mention)|pull up|prior conversation|that thread|the thread about|past chat|history of|continuing from)\b/.test(text)) {
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

  // v10.0.525 · Session-recording recall (VideoDB). Operator captures
  // own chat + computer-use sessions externally and references them
  // later · "what did I see on screen yesterday", "from that recording",
  // "in last week's session", "recall from video", "earlier on screen",
  // "the part where I", "did I do X in that session".
  if (/\b(what did i see|on screen|recording|recall from (video|session)|in (last week'?s|that|the|yesterday'?s) session|earlier on screen|from that (video|recording|session)|in the video|in that video|the part where i|did i (do|see|click|run|type)|screen capture|video archive|session capture)\b/.test(text)) {
    addMatching(/searchSessionRecordings|recallFromSession/);
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

  // If nothing matched, add a small default bundle so the model
  // still has SOME tools available for unknown queries.
  if (Object.keys(kept).length === CORE_TOOLS.length) {
    // Only core tools were added — add a minimal read bundle
    for (const name of [
      "getCommitments",
      "getTasks",
      "dailyPulse",
      "findCustomer",
    ]) {
      if (allTools[name]) kept[name] = allTools[name];
    }
  }

  // Hard cap for deep mode — stay inside Venice's effective budget.
  // With ~200 chars per tool schema, 50 tools = ~10K in the prompt,
  // which is tolerable on top of a 57K system prompt + 4K output.
  if (isDeep && Object.keys(kept).length > 50) {
    const entries = Object.entries(kept);
    // Keep the CORE_TOOLS slots first (always), then fill with the rest
    // in insertion order (which came from semantic-ranked high → low).
    const keptCore = entries.filter(([n]) => CORE_TOOLS.includes(n));
    const keptExtra = entries.filter(([n]) => !CORE_TOOLS.includes(n)).slice(0, 50 - keptCore.length);
    return Object.fromEntries([...keptCore, ...keptExtra]);
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
