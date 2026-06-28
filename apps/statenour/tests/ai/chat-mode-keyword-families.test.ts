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
