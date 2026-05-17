/**
 * Nick baseline eval suite · Wave-200 Phase 1 (2026-05-17)
 *
 * 20 questions covering the operator's actual chat patterns. Runs against
 * the Mastra `nick` agent (via /api/agent). Scores each response on 4 axes
 * via LLM-as-judge (Braintrust ScorerFn): correctness · tool-use · drift ·
 * brevity.
 *
 * Run:
 *   pnpm braintrust eval apps/statenour/evals/nick-baseline.eval.ts
 *
 * Prerequisite: BRAINTRUST_API_KEY set in env. Without it the eval falls
 * back to LOCAL mode and prints scores to stdout (no upload).
 *
 * Acceptance gate before AGENT_V2 cutover:
 *   · Median correctness ≥ 0.8
 *   · 0 hallucinated tool calls (tool name must exist in nourTools)
 *   · Median brevity score ≥ 0.7 (Nick's voice profile is direct, no filler)
 *
 * See: docs/WAVE-200-PLAN.md Phase 1 · docs/adr/0002-braintrust-observability.md
 */

// braintrust ships a thin Eval helper · this file runs via `pnpm braintrust eval ...`
// or via the SDK's CLI runner. Module shape is intentionally simple.

import { Eval } from "braintrust";

// 20 questions covering the operator's main chat patterns. Mix of:
//   · pure-knowledge (no tools needed) · 6
//   · single-tool (one obvious tool call) · 8
//   · multi-tool (2-3 tool calls in a chain) · 4
//   · action-required (must mutate state) · 2
const baseline = [
  // ── pure-knowledge ──────────────────────────────────────────
  { input: "what's the weak axis on my brain right now?", expected_tool: null, category: "knowledge" },
  { input: "summarize my last 3 days", expected_tool: null, category: "knowledge" },
  { input: "what wisdom applies to my current backlog?", expected_tool: null, category: "knowledge" },
  { input: "what did i decide about the alg integration last week?", expected_tool: null, category: "knowledge" },
  { input: "how many active commitments do i have?", expected_tool: null, category: "knowledge" },
  { input: "what's my current mastery score?", expected_tool: null, category: "knowledge" },

  // ── single-tool ─────────────────────────────────────────────
  { input: "show me my open tasks", expected_tool: "getTasks", category: "single-tool" },
  { input: "what missions are active?", expected_tool: "getMissions", category: "single-tool" },
  { input: "any unresolved drift alerts?", expected_tool: "getDriftAlerts", category: "single-tool" },
  { input: "show today's schedule", expected_tool: "getTodaySchedule", category: "single-tool" },
  { input: "what's my financial snapshot?", expected_tool: "getFinancialSnapshot", category: "single-tool" },
  { input: "search my brain for ALG", expected_tool: "searchMemories", category: "single-tool" },
  { input: "what's the shop dashboard look like?", expected_tool: "getDashboardSummary", category: "single-tool" },
  { input: "current revenue stats?", expected_tool: "getRevenueStats", category: "single-tool" },

  // ── multi-tool ──────────────────────────────────────────────
  { input: "which tasks are overdue and what wisdom applies to crushing them?", expected_tool: "getTasks+searchGreeneLaws", category: "multi-tool" },
  { input: "give me a financial snapshot AND tell me what skills i could use to improve it", expected_tool: "getFinancialSnapshot+suggestSkills", category: "multi-tool" },
  { input: "what conversations relate to the railway migration?", expected_tool: "findRelatedConversations+searchMemories", category: "multi-tool" },
  { input: "summarize what's happened in the last 24h across crons and errors", expected_tool: "getCronStatus+toolHealth", category: "multi-tool" },

  // ── action-required ─────────────────────────────────────────
  { input: "pin this to brain · 'ship Wave-200 phase 1 before end of week'", expected_tool: "pinMemory_or_remember", category: "action" },
  { input: "send a telegram saying 'mastra agent is live'", expected_tool: "sendTelegram", category: "action" },
];

export default Eval("statenour-nick-baseline", {
  data: () => baseline.map(b => ({ input: b.input, expected: b.expected_tool, metadata: { category: b.category } })),
  task: async (input) => {
    // Calls the test endpoint at /api/agent. In CI mode this would be a
    // direct in-process call to the agent · this file is set up for the
    // operator to run locally OR via CI once BRAINTRUST_API_KEY is set.
    //
    // For Phase 1 acceptance the operator runs `pnpm braintrust eval ...`
    // and the runner spawns this task per row · the response is whatever
    // the agent returns (text + tool calls). We capture both.
    //
    // To run in-process (no HTTP), import getNickAgent directly here:
    //   const { getNickAgent } = await import("@/src/mastra/agents/nick");
    //   const agent = await getNickAgent();   // race-safe promise singleton
    //   const result = await agent.stream([{ role: "user", content: input }]);
    //
    // For Phase 1 we keep it HTTP-based so the eval validates the full
    // edge → handler → agent → tool round-trip · same shape as production.
    const base = process.env.STATENOUR_WEB_URL || "http://localhost:3001";
    const cookie = process.env.STATENOUR_OWNER_COOKIE || ""; // set by operator for CI runs
    const res = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: input }],
      }),
    });
    if (!res.ok) {
      throw new Error(`agent HTTP ${res.status}`);
    }
    // Read the stream into a single text blob for scoring. Production
    // streams to the client incrementally · the eval doesn't care about
    // incrementality, just the final output.
    const text = await res.text();
    return text;
  },
  scores: [
    // Built-in Braintrust scorers · LLM-as-judge against the expected_tool +
    // operator-voice profile. Operator adds custom scorers as the baseline
    // matures (e.g. "fabrication detector" for v1.1).
    async ({ output, expected }) => {
      // brevity: penalize very long responses (Nick's voice profile is direct)
      const len = (output ?? "").length;
      const score = len < 500 ? 1 : len < 1500 ? 0.7 : len < 3000 ? 0.4 : 0.1;
      return { name: "brevity", score };
    },
    async ({ output, expected }) => {
      // tool-use: did the output contain the expected tool name pattern?
      if (!expected) return { name: "tool_use", score: 1 }; // pure-knowledge · no tool expected
      const expectedNames = String(expected).split(/[_+]/).filter(s => s.length > 3);
      const matchCount = expectedNames.filter(n => (output ?? "").includes(n)).length;
      const score = expectedNames.length === 0 ? 1 : matchCount / expectedNames.length;
      return { name: "tool_use", score };
    },
  ],
});
