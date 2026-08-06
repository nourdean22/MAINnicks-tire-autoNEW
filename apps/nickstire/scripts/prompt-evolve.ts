/**
 * Prompt evolution loop (2026-08-06) — the R&D Lab's first closed gated-edit
 * loop, built on the thesis the research wave selected:
 *
 *   The VAPI call lane is the estate's only stream with volume (~27/day),
 *   automatic ground-truth labels, and vaulted transcripts. SkillOpt-style
 *   validation-gated bounded edits are the strongest transferable frontier
 *   mechanism. Nothing previously closed rollouts→gated edit. This does.
 *
 * The loop:
 *   1. Seeds = real FAILED calls (lost_opportunity/callback_needed) with
 *      vaulted transcripts (the Ossuary), ≥2 caller turns.
 *   2. Deterministic train/holdout split (a candidate never meets its
 *      holdout in training).
 *   3. Baseline = ghost-replay the CURRENT served prompt over all seeds.
 *   4. An optimizer model (gpt-oss:120b — different family from the
 *      receptionist lane, anti-correlation doctrine) reads the train
 *      failures and proposes K bounded candidate prompts.
 *   5. Candidates violating the compliance invariants are rejected unscored.
 *   6. Candidates are scored on TRAIN; the best is confirmed on HOLDOUT and
 *      accepted ONLY on strict holdout improvement over baseline.
 *   7. Output is a PROPOSAL file + rejected-candidates buffer (negative
 *      feedback, append-only). This script NEVER writes the served prompt —
 *      the operator merges the proposal and Push Config remains the one
 *      serving gate.
 *
 * Run:  pnpm exec tsx scripts/prompt-evolve.ts [--seeds 10] [--candidates 2]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

const OPTIMIZER_MODEL = process.env.PROMPT_EVOLVE_OPTIMIZER || "gpt-oss:120b";

interface Seed {
  id: string;
  callerTurns: string[];
  evalOutcome: string;
  summary: string | null;
}

interface ScoredPrompt {
  passRate: number;
  passes: number;
  total: number;
  grades: Array<{ id: string; pass: boolean; priceLeaks: number; resolutionOffered: boolean }>;
}

async function scorePrompt(prompt: string, seeds: Seed[]): Promise<ScoredPrompt> {
  const { ghostReplay, gradeReplies } = await import("../server/services/ghostReplay");
  const grades: ScoredPrompt["grades"] = [];
  for (const s of seeds) {
    const replies = await ghostReplay(prompt, s.callerTurns, { priority: 3 });
    const g = gradeReplies(replies);
    grades.push({ id: s.id, pass: g.pass, priceLeaks: g.priceLeaks, resolutionOffered: g.resolutionOffered });
  }
  const passes = grades.filter((g) => g.pass).length;
  return { passRate: seeds.length ? passes / seeds.length : 0, passes, total: seeds.length, grades };
}

async function proposeCandidates(basePrompt: string, trainFailures: Array<{ seed: Seed; grade: ScoredPrompt["grades"][0] }>, k: number): Promise<Array<{ prompt: string; rationale: string }>> {
  const { invokeLLM } = await import("../server/_core/llm");
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
      // ONE bounded format retry (the judge-repair pattern): reasoning models
      // sometimes spend the answer on analysis and skip the markers. The
      // retry demands only the markers; a second failure is recorded, never
      // patched around.
      console.log(`  candidate ${i + 1}: no <PROMPT> block (got ${text.trim().length} chars: "${text.trim().slice(0, 80)}…") — one format retry`);
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
    else console.log(`  candidate ${i + 1}: optimizer emitted no usable <PROMPT> block after retry — recorded as a failed proposal`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const nIdx = args.indexOf("--seeds");
  const kIdx = args.indexOf("--candidates");
  const seedCount = nIdx >= 0 ? Math.max(4, Math.min(20, parseInt(args[nIdx + 1], 10) || 10)) : 10;
  const k = kIdx >= 0 ? Math.max(1, Math.min(3, parseInt(args[kIdx + 1], 10) || 2)) : 2;

  const { extractCallerTurns, splitSeeds, violatedInvariants } = await import("../server/services/ghostReplay");
  const { ASSISTANT_SYSTEM_PROMPT } = await import("../server/services/vapi");

  const { getDb } = await import("../server/db");
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
  const seeds: Seed[] = (raw as Array<{ id: string; transcript: string; evalOutcome: string; summary: string | null }>)
    .map((r) => ({ id: r.id, callerTurns: extractCallerTurns(r.transcript), evalOutcome: r.evalOutcome, summary: r.summary }))
    .filter((s) => s.callerTurns.length >= 2 && s.callerTurns.length <= 10)
    .slice(0, seedCount);
  if (seeds.length < 4) throw new Error(`only ${seeds.length} usable seeds — need >= 4`);

  const { train, holdout } = splitSeeds(seeds);
  console.log(`seeds: ${seeds.length} usable (train ${train.length} / holdout ${holdout.length})`);
  if (!train.length || !holdout.length) throw new Error("degenerate split");

  console.log("baseline: ghost-replaying the CURRENT served prompt...");
  const baseTrain = await scorePrompt(ASSISTANT_SYSTEM_PROMPT, train);
  const baseHold = await scorePrompt(ASSISTANT_SYSTEM_PROMPT, holdout);
  console.log(`baseline: train ${baseTrain.passes}/${baseTrain.total} · holdout ${baseHold.passes}/${baseHold.total}`);

  const trainFailures = baseTrain.grades
    .filter((g) => !g.pass)
    .map((g) => ({ seed: train.find((s) => s.id === g.id)!, grade: g }));
  if (!trainFailures.length) {
    console.log("the current prompt passes every train seed — nothing to optimize on this window; done.");
    process.exit(0);
  }

  console.log(`optimizer (${OPTIMIZER_MODEL}): proposing ${k} bounded candidates from ${trainFailures.length} train failures...`);
  const candidates = await proposeCandidates(ASSISTANT_SYSTEM_PROMPT, trainFailures, k);

  const outDir = join(process.cwd(), "eval-datasets", "prompt-evolution");
  mkdirSync(outDir, { recursive: true });
  const rejectedPath = join(outDir, "rejected.jsonl");
  const stamp = new Date().toISOString().slice(0, 10);

  let best: { prompt: string; rationale: string; train: ScoredPrompt } | null = null;
  for (const [i, c] of candidates.entries()) {
    const violated = violatedInvariants(c.prompt);
    if (violated.length) {
      console.log(`  candidate ${i + 1}: REJECTED unscored — edited away invariants: ${violated.join(", ")}`);
      appendFileSync(rejectedPath, JSON.stringify({ date: stamp, reason: `invariants: ${violated.join(",")}`, rationale: c.rationale }) + "\n");
      continue;
    }
    const scored = await scorePrompt(c.prompt, train);
    console.log(`  candidate ${i + 1}: train ${scored.passes}/${scored.total} (${c.rationale.slice(0, 90)})`);
    if (!best || scored.passRate > best.train.passRate) best = { ...c, train: scored };
  }

  if (!best || best.train.passRate <= baseTrain.passRate) {
    console.log(`no candidate beat baseline on train (${baseTrain.passes}/${baseTrain.total}) — all rejected; negative feedback recorded.`);
    for (const c of candidates) appendFileSync(rejectedPath, JSON.stringify({ date: stamp, reason: "no train improvement", rationale: c.rationale }) + "\n");
    process.exit(0);
  }

  console.log("holdout confirmation on the best candidate...");
  const candHold = await scorePrompt(best.prompt, holdout);
  const accepted = candHold.passRate > baseHold.passRate;
  console.log(`holdout: candidate ${candHold.passes}/${candHold.total} vs baseline ${baseHold.passes}/${baseHold.total} → ${accepted ? "ACCEPTED" : "REJECTED"}`);

  if (!accepted) {
    appendFileSync(rejectedPath, JSON.stringify({ date: stamp, reason: `holdout ${candHold.passes}/${candHold.total} <= baseline ${baseHold.passes}/${baseHold.total}`, rationale: best.rationale }) + "\n");
    process.exit(0);
  }

  const proposalPath = join(outDir, `proposal-${stamp}.md`);
  writeFileSync(proposalPath, [
    `# Prompt evolution proposal — ${stamp}`,
    ``,
    `PROPOSAL ONLY. The served prompt is unchanged; applying this is an operator decision via the normal edit + Push Config gate.`,
    ``,
    `- Optimizer: ${OPTIMIZER_MODEL} (different family from the receptionist lane)`,
    `- Seeds: ${seeds.length} real failed calls with vaulted transcripts (train ${train.length} / holdout ${holdout.length}, deterministic split)`,
    `- Baseline: train ${baseTrain.passes}/${baseTrain.total} · holdout ${baseHold.passes}/${baseHold.total}`,
    `- Candidate: train ${best.train.passes}/${best.train.total} · holdout ${candHold.passes}/${candHold.total} — STRICT holdout improvement`,
    `- Rationale: ${best.rationale}`,
    ``,
    `## Candidate prompt (full text)`,
    ``,
    "```",
    best.prompt,
    "```",
    ``,
    `## Per-seed holdout grades`,
    ...candHold.grades.map((g) => `- ${g.id}: ${g.pass ? "PASS" : "fail"} (resolution=${g.resolutionOffered}, priceLeaks=${g.priceLeaks})`),
  ].join("\n"));
  console.log(`proposal written → ${proposalPath}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[prompt-evolve] fatal:", err);
  process.exit(1);
});
