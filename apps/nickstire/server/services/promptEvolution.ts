/**
 * Prompt evolution service (2026-08-06) — the gated-edit loop as a callable,
 * extracted from scripts/prompt-evolve.ts so the weekly cron and the manual
 * CLI run the SAME code path.
 *
 * Mechanism (SkillOpt-shaped, #1400): real failed calls with vaulted
 * transcripts → deterministic train/holdout split → ghost-replay baseline →
 * optimizer proposes bounded candidate prompts (different model family) →
 * invariant guard → train selection → STRICT holdout gate. Output is a
 * serializable result; persistence and notification are the caller's job.
 * Nothing here ever writes the served prompt — Push Config stays the one
 * serving gate.
 */
import { invokeLLM } from "../_core/llm";
import {
  extractCallerTurns,
  ghostReplay,
  gradeReplies,
  splitSeeds,
  violatedInvariants,
} from "./ghostReplay";

const OPTIMIZER_MODEL = process.env.PROMPT_EVOLVE_OPTIMIZER || "gpt-oss:120b";

export interface Seed {
  id: string;
  callerTurns: string[];
  evalOutcome: string;
  summary: string | null;
}

export interface ScoredPrompt {
  passRate: number;
  passes: number;
  total: number;
  grades: Array<{ id: string; pass: boolean; priceLeaks: number; resolutionOffered: boolean; guarantees: number; emptyReplies: number; replies?: string[] }>;
}

export async function loadSeeds(seedCount: number, filterRx?: RegExp | null): Promise<Seed[]> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { sql } = await import("drizzle-orm");
  const [raw] = await d.execute(sql`
    SELECT a.vapi_call_id AS id, a.transcript, l.eval_outcome AS evalOutcome, l.aiSummary AS summary
    FROM vapi_call_archives a
    JOIN vapi_call_logs l ON l.vapiCallId = a.vapi_call_id
    WHERE a.transcript IS NOT NULL
      AND l.eval_outcome IN ('lost_opportunity','callback_needed')
    ORDER BY a.started_at DESC
    LIMIT ${seedCount * 3}
  `);
  return (raw as unknown as Array<{ id: string; transcript: string; evalOutcome: string; summary: string | null }>)
    .map((r) => ({ id: r.id, callerTurns: extractCallerTurns(r.transcript), evalOutcome: r.evalOutcome, summary: r.summary }))
    .filter((s) => s.callerTurns.length >= 2 && s.callerTurns.length <= 10)
    .filter((s) => !filterRx || filterRx.test(s.callerTurns.join("\n")))
    .slice(0, seedCount);
}

export async function scorePrompt(prompt: string, seeds: Seed[], opts: { keepReplies?: boolean } = {}): Promise<ScoredPrompt> {
  const grades: ScoredPrompt["grades"] = [];
  for (const s of seeds) {
    const replies = await ghostReplay(prompt, s.callerTurns, { priority: 3 });
    const g = gradeReplies(replies);
    grades.push({
      id: s.id, pass: g.pass, priceLeaks: g.priceLeaks, resolutionOffered: g.resolutionOffered,
      guarantees: g.guarantees, emptyReplies: g.emptyReplies,
      // The GRADED conversation — a display must show what was judged, not a
      // fresh sampling (MoE models re-phrase run to run; a re-sampled display
      // misled a live verification once).
      ...(opts.keepReplies ? { replies } : {}),
    });
  }
  const passes = grades.filter((g) => g.pass).length;
  return { passRate: seeds.length ? passes / seeds.length : 0, passes, total: seeds.length, grades };
}

async function proposeCandidates(
  basePrompt: string,
  trainFailures: Array<{ seed: Seed; grade: ScoredPrompt["grades"][0] }>,
  k: number,
  log: (line: string) => void,
): Promise<Array<{ prompt: string; rationale: string }>> {
  const out: Array<{ prompt: string; rationale: string }> = [];
  for (let i = 0; i < k; i++) {
    const failureBrief = trainFailures.slice(0, 6).map((f) =>
      `- Call ${f.seed.id} (${f.seed.evalOutcome}): caller said "${f.seed.callerTurns[0]?.slice(0, 140)}"; grade: resolution=${f.grade.resolutionOffered} priceLeaks=${f.grade.priceLeaks}`,
    ).join("\n");
    const res = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You optimize a phone-receptionist system prompt for a tire shop. Make ONE bounded improvement: add, delete, or rewrite exactly ONE section to fix the failure pattern shown. HARD CONSTRAINTS: keep the shop identity, keep every compliance rule (never quote repair prices, never guarantee outcomes, never diagnose by phone), keep the tire-first default. Output format: one line "RATIONALE: <why this one edit>" then the COMPLETE edited prompt between <PROMPT> and </PROMPT> markers. Attempt ${i + 1} of ${k} — make each attempt a DIFFERENT single edit.`,
        },
        {
          role: "user",
          content: `CURRENT PROMPT:\n${basePrompt}\n\nREAL FAILED CALLS the current prompt did not resolve under ghost replay:\n${failureBrief}\n\nPropose your single bounded edit now.`,
        },
      ],
      maxTokens: 8192,
      timeoutMs: 120000,
      model: OPTIMIZER_MODEL,
      priority: 3,
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    let text = typeof raw === "string" ? raw : JSON.stringify(raw);
    let m = /<PROMPT>([\s\S]*?)<\/PROMPT>/.exec(text);
    if (!(m && m[1].trim().length > 200)) {
      // ONE bounded format retry — reasoning models sometimes spend the
      // answer on analysis and skip the markers. A second failure is
      // recorded, never patched around.
      log(`candidate ${i + 1}: no <PROMPT> block (${text.trim().length} chars) — one format retry`);
      const retry = await invokeLLM({
        messages: [
          { role: "system", content: "You return exactly one line starting with RATIONALE: and then the complete prompt between <PROMPT> and </PROMPT>. No other output." },
          { role: "user", content: `Your previous answer lacked the <PROMPT> markers. Here it is:\n\n${text.slice(0, 6000)}\n\nRe-emit it now as: RATIONALE: <one line>\n<PROMPT>\n<the complete edited prompt>\n</PROMPT>` },
        ],
        maxTokens: 8192,
        timeoutMs: 120000,
        model: OPTIMIZER_MODEL,
        priority: 3,
      });
      const retryRaw = retry.choices?.[0]?.message?.content ?? "";
      text = typeof retryRaw === "string" ? retryRaw : JSON.stringify(retryRaw);
      m = /<PROMPT>([\s\S]*?)<\/PROMPT>/.exec(text);
    }
    const rationale = /RATIONALE:\s*(.+)/.exec(text)?.[1]?.trim() ?? "(no rationale emitted)";
    if (m && m[1].trim().length > 200) out.push({ prompt: m[1].trim(), rationale });
    else log(`candidate ${i + 1}: no usable <PROMPT> block after retry — recorded as a failed proposal`);
  }
  return out;
}

export interface EvolutionResult {
  usableSeeds: number;
  trainCount: number;
  holdoutCount: number;
  baselineTrain: string;
  baselineHoldout: string;
  candidateSummaries: Array<{ rationale: string; train: string; rejectedInvariants?: string[] }>;
  accepted: null | { rationale: string; holdout: string; prompt: string };
  outcome: "accepted" | "rejected-holdout" | "rejected-train" | "no-candidates" | "baseline-clean";
}

/** One full gated evolution cycle. Throws on infrastructure failure (no DB,
 *  LLM lane down) — a failed run must be a failed cron run, never a quiet
 *  success. */
export async function runPromptEvolution(
  opts: { seedCount?: number; candidates?: number; log?: (line: string) => void } = {},
): Promise<EvolutionResult> {
  const seedCount = Math.max(4, Math.min(20, opts.seedCount ?? 12));
  const k = Math.max(1, Math.min(3, opts.candidates ?? 2));
  const log = opts.log ?? (() => undefined);
  const { ASSISTANT_SYSTEM_PROMPT } = await import("./vapi");

  const seeds = await loadSeeds(seedCount);
  if (seeds.length < 4) throw new Error(`only ${seeds.length} usable seeds — need >= 4`);
  const { train, holdout } = splitSeeds(seeds);
  if (!train.length || !holdout.length) throw new Error("degenerate split");

  const baseTrain = await scorePrompt(ASSISTANT_SYSTEM_PROMPT, train);
  const baseHold = await scorePrompt(ASSISTANT_SYSTEM_PROMPT, holdout);
  const base = {
    usableSeeds: seeds.length,
    trainCount: train.length,
    holdoutCount: holdout.length,
    baselineTrain: `${baseTrain.passes}/${baseTrain.total}`,
    baselineHoldout: `${baseHold.passes}/${baseHold.total}`,
  };

  const trainFailures = baseTrain.grades
    .filter((g) => !g.pass)
    .map((g) => ({ seed: train.find((s) => s.id === g.id)!, grade: g }));
  if (!trainFailures.length) {
    return { ...base, candidateSummaries: [], accepted: null, outcome: "baseline-clean" };
  }

  const candidates = await proposeCandidates(ASSISTANT_SYSTEM_PROMPT, trainFailures, k, log);
  const summaries: EvolutionResult["candidateSummaries"] = [];
  let best: { prompt: string; rationale: string; train: ScoredPrompt } | null = null;
  for (const c of candidates) {
    const violated = violatedInvariants(c.prompt);
    if (violated.length) {
      summaries.push({ rationale: c.rationale, train: "unscored", rejectedInvariants: violated });
      continue;
    }
    const scored = await scorePrompt(c.prompt, train);
    summaries.push({ rationale: c.rationale, train: `${scored.passes}/${scored.total}` });
    if (!best || scored.passRate > best.train.passRate) best = { ...c, train: scored };
  }

  if (!candidates.length) return { ...base, candidateSummaries: summaries, accepted: null, outcome: "no-candidates" };
  if (!best || best.train.passRate <= baseTrain.passRate) {
    return { ...base, candidateSummaries: summaries, accepted: null, outcome: "rejected-train" };
  }

  const candHold = await scorePrompt(best.prompt, holdout);
  if (candHold.passRate > baseHold.passRate) {
    return {
      ...base,
      candidateSummaries: summaries,
      accepted: { rationale: best.rationale, holdout: `${candHold.passes}/${candHold.total}`, prompt: best.prompt },
      outcome: "accepted",
    };
  }
  return { ...base, candidateSummaries: summaries, accepted: null, outcome: "rejected-holdout" };
}
