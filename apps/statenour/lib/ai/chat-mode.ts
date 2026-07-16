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
 * (2026-07-15 · stale Venice note removed — Venice is retired from
 * RUNTIME_PROVIDERS and every live provider in the chain is
 * tool-capable. The prune's job is purely context-budget control.)
 */
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
  opts?: { conversationTail?: string }
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

  // 2026-07-06 · the most-used WRITE tools are always attached too.
  const ACTION_CORE = ["createTask", "completeTask"];

  // ── Exact tool name mention ──
  // If the user explicitly mentions a tool name (case-insensitive check), always include it
  const exactMentioned = new Set<string>();
  for (const name of Object.keys(allTools)) {
    const lowerName = name.toLowerCase();
    if (text.includes(lowerName)) {
      exactMentioned.add(name);
    }
  }

  const keywordMatches = new Set<string>();
  // Keyword-based tool families
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

  // v10.0.530 · Tools / capabilities / help
  // Surfaces a rich, representative set of tools across all families when
  // the operator asks about capabilities or help.
  if (/\b(tools?|capabilities|functions?|what (can you do|actions can you|tools do you)|help (me|menu)?)\b/.test(text)) {
    const helpTools = [
      "getTasks", "createTask", "addTasksToProject", "completeTask", "setTaskPriority",
      "getCommitments", "createCommitment", "updateCommitment",
      "getMissions", "createMissionPlan",
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
  if (/\b(sms|text (the |this |a )?customer|send (an? )?(sms|text) to|stage (a |an )?(customer )?(alert|sms|text)|(customer )?outreach via (sms|text))\b/.test(text)) {
    addMatching(/stageCustomerAlert/i);
  }

  // #13 · Situation logging. "log this situation", "record this moment". The
  // daily family catches "log" but its pattern doesn't match logSituation.
  if (/\b(log (this |the )?situation|record (this|a) (strategic )?(moment|situation)|i just (encountered|hit|ran into)|note this situation)\b/.test(text)) {
    addMatching(/logSituation/i);
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
  // Top Services
  if (/\b(top services|popular services|common jobs|most frequent jobs|highest volume services)\b/.test(text)) {
    addMatching(/getTopServices/i);
  }
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

  const addIfSpace = (name: string) => {
    if (selectedNames.size >= 50) return;
    if (allTools[name]) {
      selectedNames.add(name);
    }
  };

  // Tier 1: CORE_TOOLS
  for (const name of CORE_TOOLS) {
    addIfSpace(name);
  }

  // Tier 2: ACTION_CORE
  for (const name of ACTION_CORE) {
    addIfSpace(name);
  }

  // Tier 3: Exact tool-name mentions (explicit user intent)
  const sortedExact = Array.from(exactMentioned).sort();
  for (const name of sortedExact) {
    addIfSpace(name);
  }

  // Tier 4: Deterministic natural-language keyword-family matches
  const sortedKeyword = Array.from(keywordMatches).sort();
  for (const name of sortedKeyword) {
    addIfSpace(name);
  }

  // Tier 5: Semantic-ranked tools
  if (userEmbedding && userEmbedding.length > 0 && selectedNames.size < 50) {
    try {
      const { rankToolsBySimilarity, isToolEmbeddingCacheWarm } = await import("./tool-embeddings");
      if (isToolEmbeddingCacheWarm()) {
        const topN = isDeep ? 40 : 15;
        const ranked = rankToolsBySimilarity(userEmbedding, topN, 0.25);
        for (const [name] of ranked) {
          addIfSpace(name);
        }
      }
    } catch (err) {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.chat-mode", err, { fn: "pruneTools" })).catch((e) => console.error("ai.chat-mode import error", e));
    }
  }

  // Tier 6: Default extras (if only core tools were matched)
  const coreAndActionInRegistry = [...CORE_TOOLS, ...ACTION_CORE].filter(n => allTools[n]);
  if (selectedNames.size === coreAndActionInRegistry.length) {
    const defaults = ["getCommitments", "getTasks", "dailyPulse", "findCustomer"];
    for (const name of defaults) {
      addIfSpace(name);
    }
  }

  const kept: Record<string, unknown> = {};
  for (const name of selectedNames) {
    kept[name] = allTools[name];
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
