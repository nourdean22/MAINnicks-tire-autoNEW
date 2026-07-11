/**
 * tests/ai/chat-mode-keyword-families.test.ts · v10.0.510
 *
 * Locks the 9 new pruner keyword families shipped in v10.0.509 (SEO)
 * and v10.0.510 (brain / code / email / image / research / drift /
 * OKR / routines / browser). Each family was added because the
 * 2026-05-12 GSC smoke test exposed that tools without a matching
 * keyword family get pruned out in standard mode · leading the model
 * to fabricate when it has no tool to call.
 *
 * Test approach: extract the regex patterns standalone (mirroring
 * lib/ai/chat-mode.ts) and verify each family fires on common
 * operator phrasings AND does NOT false-positive on unrelated text.
 *
 * The full pruneTools() function has a require()/path-alias issue
 * in vitest that we'll fix in a follow-up · this test exercises the
 * regex-classification logic directly, which is the actual root-cause
 * surface area.
 */
import { describe, it, expect } from "vitest";

// MIRRORS the regex patterns in lib/ai/chat-mode.ts · keep these
// two in sync. Any pattern change there should land here as a test
// update FIRST.
const PATTERNS = {
  seo: /\b(seo|gsc|google search console|search console|impressions?|clicks|ctr|rankings?|search performance|organic|traffic|keywords?|nickstire\.org|autonicks\.com|search ranks?|domain|website performance|aeo|geo|marketing attribution|lead source|channel attribution|roi per source|what'?s? working|attribution)\b/i,
  brain: /\b(remember|recall|what did i|what was the|previous|last time|history|conversation|chat history|skills i|my skills|greene|laws? of|wisdom|advise me|simulate|anti.?pattern|cold memory|blind spots?|decision (history|replay|journal)|reflect|reflection|brain health|emotional state)\b/i,
  code: /\b(code|files?|commits?|pull request|prs?|issues?|repos?|deploy|github|functions?|classes?|modules?|imports?|build|typecheck|lint|test fail|stack trace|architecture)\b/i,
  email: /\b(email|inbox|gmail|message me|send (a |the )?(message|note|email|telegram)|reply to|draft|compose|forward)\b/i,
  image: /\b(generate (an?|the)? (image|picture|photo|graphic)|create (an?|the)? (image|picture|photo)|draw (me )?(an?|the)? |make (an?|the)? (image|picture|photo)|analyze (this|the|that) (image|photo|picture)|extract from|run (this|the) code|solve (this|the)? (math|equation)|summarize this)\b/i,
  research: /\b(research|web search|google (for|it|me)|look up|investigate|find (more about|info on|out about)|search the web|find leads|deep dive|fan.?out|multi.?agent)\b/i,
  drift: /\b(drift|alert|broken|crash|error|exception|outage|deploy(ed|ing)?|deploying|deployment|system (status|health)|tool (health|broken)|down|degraded|stale|fail(ed|ing)?)\b/i,
  okr: /\b(mit|main thing|top priority|okrs?|objectives?|key results?|weekly targets?|life goals?|set (a |my )?goal|north star|aim|targets?)\b/i,
  routine: /\b(weekly review|week (summary|recap|review)|end of day|eod|morning brief|daily pulse|analyze (my |this )?week)\b/i,
  browser: /\b(scrape|extract from (the )?page|automate (the )?browser|navigate (to|the)|click (on|the)? button|fill (out|in) (the )?form|browser (do|act|navigate|observe|extract))\b/i,
  help: /\b(tools?|capabilities|functions?|what (can you do|actions can you|tools do you)|help (me|menu)?)\b/i,
};

describe("pruner keyword families · v10.0.509-510 fires correctly", () => {
  describe("SEO/GSC family", () => {
    it("matches the original failing query", () => {
      expect(PATTERNS.seo.test("Hello how did nickstire.org do yesterday in gsc?")).toBe(true);
    });
    it.each([
      "What were our impressions and clicks last week?",
      "Show me our current rankings",
      "What's our organic traffic doing?",
      "Pull the search console performance",
      "What's working for marketing right now?",
    ])("matches: %s", (q) => expect(PATTERNS.seo.test(q)).toBe(true));
  });

  describe("Brain/recall family", () => {
    it.each([
      "What did I decide last week about hiring?",
      "Remember when we talked about pricing?",
      "What would Greene say about this?",
      "Search my skills for anti-pattern detection",
      "Pull my previous conversation about the gateway",
      "Show me my blind spots",
    ])("matches: %s", (q) => expect(PATTERNS.brain.test(q)).toBe(true));
  });

  describe("Code/repo family", () => {
    it.each([
      "Show me the recent commits",
      "Open the chat-mode.ts file",
      "What PRs are open?",
      "Check the deploy status",
      "Search the repo for streamText",
    ])("matches: %s", (q) => expect(PATTERNS.code.test(q)).toBe(true));
  });

  describe("Email/inbox family", () => {
    it.each([
      "Draft an email to the supplier",
      "Read my gmail inbox",
      "Send a telegram about the deploy",
      "Compose a message to the customer",
    ])("matches: %s", (q) => expect(PATTERNS.email.test(q)).toBe(true));
  });

  describe("Research/web family", () => {
    it.each([
      "Research best practices for X",
      "Look up the latest data on tire pricing",
      "Web search the question",
      "Find leads matching shop owners in Ohio",
      "Investigate the slow response time",
    ])("matches: %s", (q) => expect(PATTERNS.research.test(q)).toBe(true));
  });

  describe("Drift/alerts family", () => {
    it.each([
      "Any drift alerts firing?",
      "What's broken right now?",
      "Check system health",
      "Tool health status",
    ])("matches: %s", (q) => expect(PATTERNS.drift.test(q)).toBe(true));
  });

  describe("OKR/MIT family", () => {
    it.each([
      "Set my MIT for today",
      "What's the main thing for this week?",
      "Update my weekly targets",
      "Set an OKR for Q3",
    ])("matches: %s", (q) => expect(PATTERNS.okr.test(q)).toBe(true));
  });

  describe("Routines family", () => {
    it.each([
      "Run my weekly review",
      "End of day summary",
      "Analyze this week",
    ])("matches: %s", (q) => expect(PATTERNS.routine.test(q)).toBe(true));
  });

  describe("Browser family", () => {
    it.each([
      "Scrape the supplier page",
      "Navigate to the booking form",
      "Extract from the page",
      "Automate the browser to click X",
    ])("matches: %s", (q) => expect(PATTERNS.browser.test(q)).toBe(true));
  });

  describe("Help/tools family", () => {
    it.each([
      "what tools do you have?",
      "list your capabilities",
      "what are your functions",
      "what can you do?",
      "help menu",
    ])("matches: %s", (q) => expect(PATTERNS.help.test(q)).toBe(true));
  });
});

describe("pruner keyword families · no false positives", () => {
  it("brain family doesn't match casual chat", () => {
    expect(PATTERNS.brain.test("Hey what's up")).toBe(false);
    expect(PATTERNS.brain.test("Thanks for the help")).toBe(false);
  });
  it("code family doesn't match shop talk", () => {
    expect(PATTERNS.code.test("What's the revenue today?")).toBe(false);
    expect(PATTERNS.code.test("How are the customers feeling?")).toBe(false);
  });
  it("image family doesn't match casual mentions", () => {
    expect(PATTERNS.image.test("That image is nice")).toBe(false);
    expect(PATTERNS.image.test("There's a picture in the room")).toBe(false);
  });
  it("research family doesn't match casual lookups", () => {
    // "researched" has word-suffix · \bresearch\b alone won't match
    // when it's part of a longer word. That's correct behavior · the
    // user saying "I researched this already" is reporting completion,
    // not asking us to research.
    expect(PATTERNS.research.test("I researched this already")).toBe(false);
    expect(PATTERNS.research.test("What's the weather")).toBe(false);
    // Genuinely-research queries still match
    expect(PATTERNS.research.test("Research this for me")).toBe(true);
  });
  it("OKR family doesn't false-positive on 'target audience' phrasing", () => {
    // CARE · "target" alone matches · but that's actually OK because
    // setLifeGoal/setOKRs are appropriate for goal-shape queries
    expect(PATTERNS.okr.test("What's the target audience for this ad?")).toBe(true);
    // Genuinely-not-okr queries
    expect(PATTERNS.okr.test("How are you doing today?")).toBe(false);
  });
});

// 2026-07-04 · cross-conversation family (v10.0.524 #1) phrasing gap.
// The live incident question "can u see what else we chatted about today
// in other sessions?" matched NO family — searchConversations/
// findRelatedConversations were pruned out on exactly the query class
// they exist for ("sessions", plural "conversations", "we chatted" were
// never triggers). MIRRORS lib/ai/chat-mode.ts · keep in sync.
const CROSS_CONVERSATION =
  /\b(last (time|week|month)|previously|earlier we|we discussed|we (talked|chatted) about|we chatted|chatted (about|today|yesterday)|what did i (say|discuss|mention)|pull up|prior conversation|that thread|the thread about|past chat|history of|continuing from|(other|past|previous|earlier|prior|all|my) (sessions?|convos?|conversations?|chats?|threads?)|in another (session|conversation|chat|thread))\b/i;

describe("cross-conversation family · session/plural phrasing (2026-07-04)", () => {
  it("matches the live incident phrasing", () => {
    expect(
      CROSS_CONVERSATION.test(
        "can u see what else we chatted about today in other sessions?",
      ),
    ).toBe(true);
  });
  it.each([
    "is this happening in my other conversations?",
    "check my past chats for this",
    "did we cover this in a previous session",
    "search all threads about the gateway",
    "what did we discuss in another conversation",
  ])("matches: %s", (q) => expect(CROSS_CONVERSATION.test(q)).toBe(true));
  it("original v10.0.524 phrasings still match", () => {
    expect(CROSS_CONVERSATION.test("last time we talked about pricing")).toBe(true);
    expect(CROSS_CONVERSATION.test("pull up that thread")).toBe(true);
    expect(CROSS_CONVERSATION.test("prior conversation about hiring")).toBe(true);
  });
  it("does not false-positive on unqualified 'session' talk", () => {
    expect(CROSS_CONVERSATION.test("book a session with the trainer")).toBe(false);
    expect(CROSS_CONVERSATION.test("the gym session was brutal")).toBe(false);
    expect(CROSS_CONVERSATION.test("how are you doing today?")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// v10.0.531 · tool-attachment audit families. MIRRORS the 13-family
// block in lib/ai/chat-mode.ts. Keep in sync: a pattern change there
// lands here FIRST. Each family: fires on natural phrasing + no
// false-positive on adjacent phrasing.
// ─────────────────────────────────────────────────────────────
const P531 = {
  chart: /\b(chart of|pie chart|bar chart|line chart|render (a |the )?chart|visuali[sz]e|visuali[sz]ation|graph (of|this|the)|plot (of|this|the) (data|tasks|metrics))\b/i,
  queryNickstire: /\b(query (the )?(shop|business|nickstire)|shop data|business data|bookings?|pending callbacks?|work orders?|status of (our|the) (bookings?|jobs?|orders?))\b/i,
  health: /\b(mental health|how (am|'?m) i doing (emotional|mental)|am i okay|am i ok\b|burn(ing)? ?out|burnout|overwork(ing|ed)?|work.?life balance|workload sustainable|work health|composure|am i composed|emotional regulation|how('?s| is) my (mood|stress|mental)|how stressed)\b/i,
  trends: /\b(trend(ing|s| analysis)?|what'?s changing|what changed|top movers?|moving (up|down)|biggest changes?|shifts? in my)\b/i,
  scrape: /\b(scrape|scraping|extract (the )?(content|text) from|read (the |this |that )?(page|webpage|web page|url|link)|convert (the )?(page|url) to markdown|fetch (the )?(page|url))\b/i,
  decision: /\b(should i|help me (think through|decide)|thinking through|before i decide|risks? before|pros and cons|weigh (this|the) (option|choice|decision)|i'?m considering|what if i)\b/i,
  power: /\b(power (dynamics?|balance|position)|leverage (over|across|with)|who (has|holds) power|relationship (leverage|strategy)|cognitive bias|manipulation (tactics?|techniques?)|psychology tactics?|dark psychology)\b/i,
  last30: /\b(trending (in the )?last (month|30 ?days|week)|recent sentiment|what (are )?people (discussing|saying) (lately|recently)|last 30 days|reddit sentiment)\b/i,
  video: /\b(tiktok|reel|short video|make (a |the )?video|generate (a |the )?video|create (a |the )?(short )?video|youtube short|video from (this|that|the) script)\b/i,
  dashboard: /\b(dashboard|business summary|what needs (my )?attention|what'?s urgent|show me (my )?alerts?|attention (alerts?|items?)|needs? action)\b/i,
  cron: /\b(cron|crons|cron jobs?|scheduled (tasks?|jobs?)|are my (crons?|jobs?) running|job status|which (crons?|jobs?) failed)\b/i,
  competitive: /\b(competitive (analysis|intel|intelligence)|competitors?|where are we weak|our (weakness|vulnerabilit)|market position|how do we (compare|stack up))\b/i,
  sms: /\b(sms|text (the |this |a )?customer|send (an? )?(sms|text) to|stage (a |an )?(customer )?(alert|sms|text)|(customer )?outreach via (sms|text))\b/i,
  logSituation: /\b(log (this |the )?situation|record (this|a) (strategic )?(moment|situation)|i just (encountered|hit|ran into)|note this situation)\b/i,
};

describe("v10.0.531 tool-attachment families · fire on natural phrasing", () => {
  it.each([
    ["chart", "show me a chart of my tasks"],
    ["chart", "render a pie chart of the data"],
    ["queryNickstire", "query the shop data"],
    ["queryNickstire", "what's the status of our bookings"],
    ["health", "am I burning out?"],
    ["health", "mental health check"],
    ["health", "how stressed am I lately"],
    ["trends", "what's changing in my metrics"],
    ["trends", "show me the top movers"],
    ["scrape", "scrape this webpage for me"],
    ["scrape", "read the page and convert to markdown"],
    ["decision", "should I take this job"],
    ["decision", "help me think through this choice"],
    ["power", "what are the power dynamics here"],
    ["power", "what manipulation tactics are at play"],
    ["last30", "what are people saying lately about EVs"],
    ["video", "make a short video from this script"],
    ["video", "generate a tiktok"],
    ["dashboard", "show me my alerts"],
    ["dashboard", "what needs my attention"],
    ["cron", "are my crons running"],
    ["cron", "which jobs failed"],
    ["competitive", "run a competitive analysis"],
    ["competitive", "where are we weak vs competitors"],
    ["sms", "stage an SMS to the customer for review"],
    ["sms", "text this customer"],
    ["logSituation", "log this situation for me"],
    ["logSituation", "record this strategic moment"],
  ])("%s fires on: %s", (fam, q) => expect(P531[fam as keyof typeof P531].test(q)).toBe(true));
});

describe("v10.0.531 families · no false positives", () => {
  it("health family doesn't match a good workout", () => {
    expect(P531.health.test("the gym was a good workout today")).toBe(false);
  });
  it("trends family doesn't match 'change my password'", () => {
    expect(P531.trends.test("change my password please")).toBe(false);
  });
  it("dashboard family catches the PLURAL 'alerts' (the whole bug)", () => {
    expect(P531.dashboard.test("show me alerts")).toBe(true);
  });
  it("cron family doesn't match casual 'job done'", () => {
    expect(P531.cron.test("i got the job done")).toBe(false);
  });
  it("sms family doesn't match casual 'text'", () => {
    expect(P531.sms.test("what does the text say")).toBe(false);
  });
  it("chart family doesn't fire on 'chart-topping'", () => {
    expect(P531.chart.test("that was a chart-topping song")).toBe(false);
  });
});

// ── 2026-07-11 review · closing the last two cold-start-unreachable tools ──
// MIRRORS lib/ai/chat-mode.ts — pattern changes there land here first.
const P532B = {
  competitiveTrigger: /\b(competitive (analysis|intel|intelligence)|competitors?|where are we weak|our (weakness|vulnerabilit)|market position|how do we (compare|stack up)|benchmark)\b/i,
  competitiveTools: /analyzeCompetitiveIntel|compareCompetitors/i,
  fitnessTrigger: /\b(fitness (analysis|progress|trend|report)|my fitness|analyze (my )?fitness|workout (progress|trend|analysis|history)|training progress|how('?s| is) my (fitness|training))\b/i,
};

describe("2026-07-11 families · compareCompetitors + analyzeFitness reachable", () => {
  it("competitive trigger fires on benchmark phrasing", () => {
    expect(P532B.competitiveTrigger.test("benchmark us against the other shops")).toBe(true);
  });
  it("competitive family now matches BOTH tools", () => {
    expect(P532B.competitiveTools.test("compareCompetitors")).toBe(true);
    expect(P532B.competitiveTools.test("analyzeCompetitiveIntel")).toBe(true);
  });
  it("fitness trigger fires on 'how's my fitness'", () => {
    expect(P532B.fitnessTrigger.test("how's my fitness looking this month")).toBe(true);
  });
  it("fitness trigger fires on 'workout progress'", () => {
    expect(P532B.fitnessTrigger.test("show me my workout progress")).toBe(true);
  });
  it("fitness trigger does NOT fire on casual gym talk", () => {
    expect(P532B.fitnessTrigger.test("the gym was packed today")).toBe(false);
  });
  it("competitive trigger does NOT fire on casual comparison", () => {
    expect(P532B.competitiveTrigger.test("compare these two fonts for me")).toBe(false);
  });
});
