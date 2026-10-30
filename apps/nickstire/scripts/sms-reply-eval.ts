/**
 * SMS reply eval runner (2026-10-30). Runs every case in
 * server/services/smsReplyEval.ts through the REAL orchestrateSms decision and
 * scores it from the customer's side: right / wrong / fragment / none.
 *
 * Isolation, reused from scripts/replay-sms-orchestrator.ts:
 *   - every orchestrator write, send and notify runs inside runInSmsReplayScope and
 *     is skipped and recorded; REPLAY_DRY_RUN is set as the second guard; a startup
 *     self-test proves the scope works in this process;
 *   - fetch reaches ONLY ollama.com, the Gemini host and router.huggingface.co (the
 *     intent classifier); OpenAI, OpenRouter, Anthropic, Twilio, Telegram, email,
 *     Langfuse and webhooks are refused and counted, and a paid-lane attempt exits 1;
 *   - LLM_LEDGER_ENABLED is forced off (the ledger is the one write outside the scope);
 *   - phones are fictional 216-555 numbers; the database is READ for customer context
 *     (none exists for these numbers), and a read-only before/after row count for them
 *     must come back unchanged, or the run exits 1.
 * It needs the production environment for the real drafter lane and feature flags:
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/sms-reply-eval.ts --i-understand-this-reads-production
 * Prints case ids, scores, reasons, latency and the bot's own reply (cut to 160 chars).
 */
import { orchestrateSms } from "../server/services/smsOrchestrator";
import {
  REPLAY_PHONE_TABLES,
  createSmsEffectRecorder,
  evaluateReplayIsolation,
  flushThenExit,
  hasProductionReadAck,
  isSmsReplayActive,
  readLeakCount,
  replayLeakCheckQuery,
  replayPhoneCountQuery,
  replayPhoneKeys,
  replayScopeSelfTest,
  runInSmsReplayScope,
  truncateForPrint,
  type ReplayPhoneDelta,
} from "../server/services/smsReplayScope";
import { SMS_EVAL_CASES, installModelOnlyFetch, scoreEvalOutcome, type EvalScore } from "../server/services/smsReplyEval";
import { getDbTyped } from "../server/db";

process.env.REPLAY_DRY_RUN = "true";
process.env.LLM_LEDGER_ENABLED = "false";

async function main(): Promise<number> {
  if (!hasProductionReadAck(process.argv)) {
    console.error("Refusing to start: pass --i-understand-this-reads-production (the drafter lane and flags come from the production env).");
    return 2;
  }
  const selfTest = replayScopeSelfTest();
  if (!selfTest.ok || !isSmsReplayActive()) {
    console.error("Replay scope self-test FAILED; not running.", selfTest);
    return 1;
  }
  const db = await getDbTyped();
  if (!db) { console.error("No database connection"); return 1; }

  const cases = SMS_EVAL_CASES.map((c, i) => ({ c, phone: `216555${String(7000 + i)}`, conversationId: 990000 + i }));
  const keys = replayPhoneKeys(cases.map((x) => x.phone));
  const deltas: ReplayPhoneDelta[] = [];
  for (const table of REPLAY_PHONE_TABLES) {
    let before: number | null = null;
    try { before = readLeakCount(await db.execute(replayPhoneCountQuery(table, keys))); } catch { before = null; }
    deltas.push({ table, kind: "fictional", phoneCount: keys.length, before, after: null });
  }

  const recorder = createSmsEffectRecorder();
  // Manager ruling 2026-10-30: Ollama (W1's lane), the Gemini host (what origin/main's
  // drafter calls in prod today, so the baseline needs it) and the HF intent classifier
  // prod already calls. OpenAI, OpenRouter and Anthropic are paid lanes: refused, and
  // any attempt at one fails the run so it can never fall through to a second bill.
  const guard = installModelOnlyFetch(globalThis as { fetch?: unknown }, ["ollama.com", "generativelanguage.googleapis.com", "router.huggingface.co"]);
  const PAID_LANES = ["api.openai.com", "openrouter.ai", "api.anthropic.com"];
  const startedAt = Date.now();
  const rows: Array<{ id: string; group: string; expect: string; score: EvalScore | "error"; why: string; ms: number; reply: string }> = [];
  try {
    for (const { c, phone, conversationId } of cases) {
      const t0 = Date.now();
      try {
        const r = await runInSmsReplayScope(() => orchestrateSms({ type: "inbound_sms", phone, body: c.body, conversationId } as never), recorder);
        const s = scoreEvalOutcome(c, { status: r.status, shouldAutoSend: r.shouldAutoSend, body: r.body ?? "", holdingReply: r.holdingReply });
        rows.push({ id: c.id, group: c.group, expect: c.expect.kind, score: s.score, why: s.why, ms: Date.now() - t0, reply: r.shouldAutoSend ? truncateForPrint(r.body ?? "", 160) : `(${r.status}) ${truncateForPrint(r.body ?? "", 120)}` });
      } catch (err) {
        rows.push({ id: c.id, group: c.group, expect: c.expect.kind, score: "error", why: err instanceof Error ? err.message.slice(0, 120) : "error", ms: Date.now() - t0, reply: "" });
      }
    }
  } finally {
    guard.restore();
  }

  const windowSeconds = (Date.now() - startedAt) / 1000 + 60;
  let sidRows: number | null = null;
  try { sidRows = readLeakCount(await db.execute(replayLeakCheckQuery(windowSeconds))); } catch { sidRows = null; }
  for (const d of deltas) {
    try { d.after = readLeakCount(await db.execute(replayPhoneCountQuery(d.table, keys))); } catch { d.after = null; }
  }
  const isolation = evaluateReplayIsolation({ sidRows, windowSeconds, phoneDeltas: deltas });

  const tally = (group: string) => {
    const t: Record<string, number> = { right: 0, wrong: 0, fragment: 0, none: 0, error: 0 };
    for (const r of rows.filter((x) => x.group === group)) t[r.score]++;
    return t;
  };
  console.table(rows.map(({ id, expect, score, why, ms, reply }) => ({ id, expect, score, why, ms, reply })));
  const customer = tally("customer");
  const customerN = rows.filter((r) => r.group === "customer").length;
  console.log(`CUSTOMER ${customer.right}/${customerN} right · ${customer.wrong} wrong · ${customer.fragment} fragment · ${customer.none} none · ${customer.error} error`);
  const noise = tally("noise");
  console.log(`NOISE ${noise.right}/${rows.length - customerN} right (silent, not queued) · ${noise.wrong} wrong · ${noise.error} error`);
  const answered = rows.filter((r) => r.group === "customer" && r.score === "right").map((r) => r.ms).sort((a, b) => a - b);
  console.log(`decision latency for right answers: median ${answered[Math.floor(answered.length / 2)] ?? "n/a"} ms, max ${answered.at(-1) ?? "n/a"} ms`);
  console.log("skipped effects:", recorder.counts());
  const blockedCounts: Record<string, number> = {};
  for (const h of guard.blockedHosts) blockedCounts[h] = (blockedCounts[h] ?? 0) + 1;
  const paidAttempts = guard.blockedHosts.filter((h) => PAID_LANES.some((p) => h === p || h.endsWith(`.${p}`))).length;
  console.log(`outbound fetches refused: ${guard.blockedHosts.length}`, blockedCounts);
  console.log(`paid-lane attempts (OpenAI/OpenRouter/Anthropic): ${paidAttempts}`);
  console.log(`isolation: ${isolation.verdict.toUpperCase()}`);
  for (const line of isolation.lines) console.log(`- ${line}`);
  if (paidAttempts > 0) {
    console.error("FAILED: the drafter attempted a paid lane (refused). Report before trusting these scores.");
    return 1;
  }
  return isolation.verdict === "clean" ? 0 : 1;
}

main().then((code) => flushThenExit(code)).catch((err) => { console.error("eval crashed", err); flushThenExit(1); });
