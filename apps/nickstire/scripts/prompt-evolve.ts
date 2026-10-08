/**
 * Prompt evolution CLI (2026-08-06) — thin shell over
 * server/services/promptEvolution.ts, which the weekly cron
 * (prompt-evolution-weekly) also runs. One loop, two callers.
 *
 * Modes:
 *   pnpm exec tsx scripts/prompt-evolve.ts [--seeds 12] [--candidates 2]
 *     Full gated cycle; accepted proposals land under
 *     eval-datasets/prompt-evolution/ (local runs may use files — the cron
 *     path uses kv + Telegram because Railway's filesystem is ephemeral).
 *   --baseline-only            score the CURRENT served prompt and stop —
 *                              the standing A/B measurement mode.
 *   --audit-successes          WIDEN THE APERTURE: replay calls the classifier
 *                              called a WIN and report only real defects
 *                              (banned price quotes, guarantees, silent turns).
 *                              Audit only — these seeds never train the
 *                              optimizer. Every defect found before this mode
 *                              came from calls already labeled a failure.
 *   --filter <regex>           restrict seeds to matching caller turns and
 *                              print the actual dialogue (targeted
 *                              behavioral verification, e.g. after a prompt
 *                              fix). MoE models stay ±1-2 seeds noisy even
 *                              at temp 0 — targeted checks, not small-n
 *                              aggregates, are the verification unit.
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

async function main() {
  const args = process.argv.slice(2);
  const nIdx = args.indexOf("--seeds");
  const kIdx = args.indexOf("--candidates");
  const fIdx = args.indexOf("--filter");
  const seedCount = nIdx >= 0 ? Math.max(1, Math.min(40, parseInt(args[nIdx + 1], 10) || 12)) : 12;
  const k = kIdx >= 0 ? Math.max(1, Math.min(3, parseInt(args[kIdx + 1], 10) || 2)) : 2;
  const filterRx = fIdx >= 0 ? new RegExp(args[fIdx + 1], "i") : null;

  if (args.includes("--audit-successes")) {
    const { loadSuccessSeeds, auditSuccessCalls } = await import("../server/services/promptEvolution");
    const { ASSISTANT_SYSTEM_PROMPT } = await import("../server/services/vapi");
    const seeds = await loadSuccessSeeds(seedCount, filterRx);
    if (!seeds.length) throw new Error("no won-call seeds matched");
    console.log(`success audit: replaying ${seeds.length} call(s) the classifier scored as WINS...`);
    const r = await auditSuccessCalls(ASSISTANT_SYSTEM_PROMPT, seeds, (l) => console.log(`  ${l}`));
    console.log(`\n── success audit readout ──`);
    console.log(`${r.audited} won calls replayed · ${r.clean} clean · ${r.findings.length} carrying a defect`);
    for (const f of r.findings) {
      console.log(`\n  ✗ ${f.id} (${f.evalOutcome}) — priceLeaks=${f.priceLeaks} guarantees=${f.guarantees} empty=${f.emptyReplies}`);
      for (let i = 0; i < f.callerTurns.length; i++) {
        console.log(`      User: ${f.callerTurns[i].slice(0, 110)}`);
        console.log(`      AI:   ${(f.replies[i] ?? "").slice(0, 160)}`);
      }
    }
    if (!r.findings.length) console.log("no compliance defect found in the won calls sampled.");
    return;
  }

  if (args.includes("--baseline-only")) {
    const { loadSeeds, scorePrompt } = await import("../server/services/promptEvolution");
    const { ASSISTANT_SYSTEM_PROMPT } = await import("../server/services/vapi");
    const { seeds, excludedVerified } = await loadSeeds(seedCount, filterRx);
    if (!seeds.length) throw new Error("no seeds matched");
    console.log(`baseline: ghost-replaying the CURRENT served prompt over ${seeds.length} seed(s) (${excludedVerified} verified conversions excluded)...`);
    // keepReplies in filter mode: the display MUST show the graded
    // conversation — a fresh sampling once showed a passing dialogue while
    // the grade was judged on a differently-phrased one.
    const scored = await scorePrompt(ASSISTANT_SYSTEM_PROMPT, seeds, { keepReplies: !!filterRx });
    console.log(`baseline: ${scored.passes}/${scored.total}${scored.unresolvable ? ` (${scored.unresolvable} unresolvable excluded — no next step was possible)` : ""}`);
    for (const g of scored.grades) {
      const verdict = g.unresolvable ? "UNRESOLVABLE" : g.pass ? "PASS" : "fail";
      const judged = g.judgeReason ? ` [judge${g.judgeUnavailable ? " UNAVAILABLE" : ""}: ${g.judgeReason}]` : "";
      console.log(`  seed ${g.id}: ${verdict} (resolution=${g.resolutionOffered}, priceLeaks=${g.priceLeaks}, guarantees=${g.guarantees}, empty=${g.emptyReplies})${judged}`);
      if (g.replies) {
        const seed = seeds.find((s) => s.id === g.id)!;
        for (let i = 0; i < seed.callerTurns.length; i++) {
          console.log(`    User: ${seed.callerTurns[i].slice(0, 110)}`);
          console.log(`    AI:   ${(g.replies[i] ?? "").slice(0, 160)}`);
        }
      }
    }
    return;
  }

  const { runPromptEvolution } = await import("../server/services/promptEvolution");
  const result = await runPromptEvolution({ seedCount, candidates: k, log: (l) => console.log(`  ${l}`) });
  console.log(`seeds: ${result.usableSeeds} (train ${result.trainCount} / holdout ${result.holdoutCount}) · ${result.excludedVerified} verified conversions excluded from the failure pool`);
  console.log(`baseline: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`);
  for (const c of result.candidateSummaries) {
    console.log(`  candidate: train ${c.train}${c.rejectedInvariants ? ` REJECTED unscored (invariants: ${c.rejectedInvariants.join(",")})` : ""} — ${c.rationale.slice(0, 90)}`);
  }
  console.log(`outcome: ${result.outcome}`);
  if (result.gate) {
    const { describeVerdict } = await import("../server/services/promptEvolutionGate");
    console.log(`holdout gate: ${describeVerdict(result.gate)}`);
  }

  const outDir = join(process.cwd(), "eval-datasets", "prompt-evolution");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  if (result.outcome === "accepted" && result.accepted) {
    const proposalPath = join(outDir, `proposal-${stamp}.md`);
    writeFileSync(proposalPath, [
      `# Prompt evolution proposal — ${stamp}`,
      ``,
      `PROPOSAL ONLY. The served prompt is unchanged; applying this is an operator decision via the normal edit + Push Config gate.`,
      ``,
      `- Baseline: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`,
      `- Candidate holdout (paired permutation test): ${result.accepted.holdout}`,
      `- Rationale: ${result.accepted.rationale}`,
      ``,
      "```",
      result.accepted.prompt,
      "```",
    ].join("\n"));
    console.log(`proposal written → ${proposalPath}`);
  } else {
    appendFileSync(join(outDir, "rejected.jsonl"), JSON.stringify({ date: stamp, outcome: result.outcome, candidates: result.candidateSummaries, gate: result.gate }) + "\n");
    console.log("no proposal shipped — negative feedback recorded.");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[prompt-evolve] fatal:", err);
  process.exit(1);
});
