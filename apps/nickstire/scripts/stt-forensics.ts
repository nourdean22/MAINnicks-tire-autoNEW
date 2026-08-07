/**
 * STT / turn-taking forensics (2026-08-07) — READ-ONLY, SELECT statements only.
 *
 * WHY THIS EXISTS. The evolution loop kept finding "failures" that no prompt
 * could fix: five of fourteen recent failure-labeled calls were pure fragments
 * ("Yeah. So I was wonder." · "I put" · "Four of my words. Hey." · "Hello?"
 * ×4). Those are audio/transcription outcomes, not receptionist behaviour, and
 * they were quietly inflating the failure pool.
 *
 * The suspected mechanism: Deepgram `smartFormat` punctuates a pause to think,
 * and `transcriptionEndpointingPlan.onPunctuationSeconds` was 0.1 — so the
 * assistant answered the punctuation mark rather than the caller.
 *
 * ★ WHAT THIS CAN AND CANNOT DO. Transcripts cannot PROVE the assistant cut a
 * caller off — that needs the audio, which VAPI keeps but this script does not
 * read. Every number below is a SIGNAL, not a verdict. Their value is
 * comparative: run this before and after a turn-taking config change and see
 * whether the signals move.
 *
 * BASELINE at onPunctuationSeconds = 0.1 (2026-08-07, 416 calls / 1,460 turns):
 *   turns <= 3 words ............ 50.0%   (730)
 *   ...ending in . ? ! .......... 88%     (643) — smartFormat punctuated a stub
 *   hesitation stubs ............ 16.4%   (239)
 *   calls with 2+ bare "Hello?" .. 0.7%   (3)  <- barge-in theory REFUTED here
 *   tiny-turn rate by outcome ... lost_opportunity 55.0% vs walk_in_directed 49.1%
 *
 * The 6-point spread between failing and succeeding outcomes is WEAK evidence.
 * If onPunctuation 0.45 is the right call, the hesitation-stub rate and that
 * spread should both fall as new calls vault. If they do not move, revert the
 * value rather than tuning further on a hunch.
 *
 * Run:  pnpm exec tsx scripts/stt-forensics.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFromDotenv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* shell may already carry the vars */ }
}
loadEnvFromDotenv();

/** A pause-to-think that smartFormat closed with punctuation. Pure — unit-tested. */
export const HESITATION_STUB =
  /^(yeah|yes|okay|ok|hello|hi|hey|uh|um|so|well|no|sure)\b[\s\S]{0,12}[.?!]$/i;

/** A bare "Hello?" turn — the barge-in-loop signature. Pure — unit-tested. */
export const BARE_HELLO = /^\s*hello\s*[.?!]*\s*$/i;

export interface SttSignals {
  calls: number;
  turns: number;
  tinyTurns: number;
  tinyPunctuated: number;
  hesitationStubs: number;
  helloLoopCalls: number;
  byOutcome: Array<{ outcome: string; calls: number; turns: number; tinyRate: number }>;
}

/** Pure: compute every signal from already-extracted caller turns. Unit-tested. */
export function computeSttSignals(
  calls: Array<{ outcome: string; turns: string[] }>,
): SttSignals {
  const agg = new Map<string, { calls: number; turns: number; tiny: number }>();
  let turns = 0, tinyTurns = 0, tinyPunctuated = 0, hesitationStubs = 0, helloLoopCalls = 0, counted = 0;

  for (const call of calls) {
    if (!call.turns.length) continue;
    counted += 1;
    const a = agg.get(call.outcome) ?? { calls: 0, turns: 0, tiny: 0 };
    a.calls += 1;
    let helloCount = 0;
    for (const turn of call.turns) {
      turns += 1; a.turns += 1;
      if (turn.split(/\s+/).filter(Boolean).length <= 3) {
        tinyTurns += 1; a.tiny += 1;
        if (/[.?!]$/.test(turn)) tinyPunctuated += 1;
      }
      if (HESITATION_STUB.test(turn.trim())) hesitationStubs += 1;
      if (BARE_HELLO.test(turn)) helloCount += 1;
    }
    if (helloCount >= 2) helloLoopCalls += 1;
    agg.set(call.outcome, a);
  }

  return {
    calls: counted, turns, tinyTurns, tinyPunctuated, hesitationStubs, helloLoopCalls,
    byOutcome: [...agg.entries()]
      .filter(([, v]) => v.calls >= 5)
      .map(([outcome, v]) => ({ outcome, calls: v.calls, turns: v.turns, tinyRate: v.turns ? v.tiny / v.turns : 0 }))
      .sort((x, y) => y.tinyRate - x.tinyRate),
  };
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0.0");

async function main() {
  const { getDb } = await import("../server/db");
  const { extractCallerTurns } = await import("../server/services/ghostReplay");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { sql } = await import("drizzle-orm");
  const [raw] = await d.execute(sql`
    SELECT a.transcript, l.eval_outcome AS outcome
    FROM vapi_call_archives a JOIN vapi_call_logs l ON l.vapiCallId = a.vapi_call_id
    WHERE a.transcript IS NOT NULL
  `);
  const rows = raw as unknown as Array<{ transcript: string; outcome: string | null }>;
  if (!rows.length) {
    // A zero-row read must never render as a clean report.
    console.error("NO VAULTED TRANSCRIPTS FOUND — this run measured nothing.");
    process.exit(1);
  }

  const s = computeSttSignals(rows.map((r) => ({ outcome: r.outcome ?? "(null)", turns: extractCallerTurns(r.transcript) })));

  console.log(`vaulted calls with caller turns : ${s.calls}`);
  console.log(`total caller turns              : ${s.turns}`);
  console.log(`turns of <= 3 words             : ${s.tinyTurns}  (${pct(s.tinyTurns, s.turns)}%)`);
  console.log(`  ...of those, ENDING in . ? !  : ${s.tinyPunctuated}  <- smartFormat punctuated a stub`);
  console.log(`hesitation stubs ("Yeah." etc)  : ${s.hesitationStubs}  (${pct(s.hesitationStubs, s.turns)}% of turns)`);
  console.log(`calls with 2+ bare "Hello?"     : ${s.helloLoopCalls}  (${pct(s.helloLoopCalls, s.calls)}% of calls)`);
  console.log(`\n── tiny-turn rate by outcome (higher = more truncation) ──`);
  for (const o of s.byOutcome) {
    console.log(`  ${o.outcome.padEnd(26)} ${(o.tinyRate * 100).toFixed(1)}%  (${o.calls} calls, ${o.turns} turns)`);
  }
  console.log(`\nCompare against the BASELINE in this file's header. Signals, not verdicts.`);
  process.exit(0);
}

main().catch((e) => { console.error("[stt-forensics] fatal:", e instanceof Error ? e.message : e); process.exit(1); });
