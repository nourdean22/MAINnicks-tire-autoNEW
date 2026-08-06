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
  const seedCount = nIdx >= 0 ? Math.max(1, Math.min(20, parseInt(args[nIdx + 1], 10) || 12)) : 12;
  const k = kIdx >= 0 ? Math.max(1, Math.min(3, parseInt(args[kIdx + 1], 10) || 2)) : 2;
  const filterRx = fIdx >= 0 ? new RegExp(args[fIdx + 1], "i") : null;

  if (args.includes("--baseline-only")) {
    const { loadSeeds, scorePrompt } = await import("../server/services/promptEvolution");
    const { ASSISTANT_SYSTEM_PROMPT } = await import("../server/services/vapi");
    const seeds = await loadSeeds(seedCount, filterRx);
    if (!seeds.length) throw new Error("no seeds matched");
    console.log(`baseline: ghost-replaying the CURRENT served prompt over ${seeds.length} seed(s)...`);
    // keepReplies in filter mode: the display MUST show the graded
    // conversation — a fresh sampling once showed a passing dialogue while
    // the grade was judged on a differently-phrased one.
    const scored = await scorePrompt(ASSISTANT_SYSTEM_PROMPT, seeds, { keepReplies: !!filterRx });
    console.log(`baseline: ${scored.passes}/${scored.total}`);
    for (const g of scored.grades) {
      console.log(`  seed ${g.id}: ${g.pass ? "PASS" : "fail"} (resolution=${g.resolutionOffered}, priceLeaks=${g.priceLeaks}, guarantees=${g.guarantees}, empty=${g.emptyReplies})`);
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
  console.log(`seeds: ${result.usableSeeds} (train ${result.trainCount} / holdout ${result.holdoutCount})`);
  console.log(`baseline: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`);
  for (const c of result.candidateSummaries) {
    console.log(`  candidate: train ${c.train}${c.rejectedInvariants ? ` REJECTED unscored (invariants: ${c.rejectedInvariants.join(",")})` : ""} — ${c.rationale.slice(0, 90)}`);
  }
  console.log(`outcome: ${result.outcome}`);

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
      `- Candidate holdout: ${result.accepted.holdout} — STRICT improvement`,
      `- Rationale: ${result.accepted.rationale}`,
      ``,
      "```",
      result.accepted.prompt,
      "```",
    ].join("\n"));
    console.log(`proposal written → ${proposalPath}`);
  } else {
    appendFileSync(join(outDir, "rejected.jsonl"), JSON.stringify({ date: stamp, outcome: result.outcome, candidates: result.candidateSummaries }) + "\n");
    console.log("no proposal shipped — negative feedback recorded.");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[prompt-evolve] fatal:", err);
  process.exit(1);
});
