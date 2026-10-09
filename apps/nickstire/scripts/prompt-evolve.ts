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
 *                              (banned price quotes, guarantees, silent turns,
 *                              claim-guard violations). Audit only — these
 *                              seeds never train the optimizer. Every defect
 *                              found before this mode came from calls already
 *                              labeled a failure.
 *   --filter <regex>           restrict seeds to matching caller turns and
 *                              print the actual dialogue (targeted
 *                              behavioral verification, e.g. after a prompt
 *                              fix). MoE models stay ±1-2 seeds noisy even
 *                              at temp 0 — targeted checks, not small-n
 *                              aggregates, are the verification unit.
 *   --baseline live|repository WHICH prompt every mode measures (2026-10-09).
 *                              live (default): the prompt the assistant that
 *                              answers the shop line serves, read from the
 *                              provider (resolveLiveReceptionistBaseline) --
 *                              what callers hear, learned lessons included. It
 *                              refuses (and this CLI exits 1) when routing is
 *                              not a proven match. repository: the code
 *                              constant ASSISTANT_SYSTEM_PROMPT, for an offline
 *                              run with no provider credentials; it is NOT what
 *                              callers hear, and every printout says so.
 *
 * The full cycle never runs the sealed confirmation stage from here: the
 * consumed-seed list lives in production kv and only the weekly cron writes
 * it, so a local run treats every confirmation seed as already spent and ends
 * at accepted-unconfirmed at best. A CLI run never spends a sealed seed the
 * cron does not know about.
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

type BaselineMode = "live" | "repository";

function baselineModeOf(args: string[]): BaselineMode {
  const i = args.indexOf("--baseline");
  if (i < 0) return "live";
  const mode = args[i + 1];
  if (mode === "live" || mode === "repository") return mode;
  throw new Error(`--baseline takes "live" or "repository" (got ${JSON.stringify(mode ?? null)})`);
}

async function resolveBaseline(mode: BaselineMode) {
  const { resolveLiveReceptionistBaseline, repositoryBaseline } = await import("../server/services/receptionistBaseline");
  const baseline = mode === "repository" ? repositoryBaseline() : await resolveLiveReceptionistBaseline();
  if (baseline.source === "repository") {
    console.log(`baseline: REPOSITORY prompt ${baseline.promptHash} (--baseline repository) — NOT the prompt callers hear: no learned lessons, no dashboard settings`);
  } else {
    console.log(`baseline: LIVE prompt ${baseline.promptHash} from assistant ${baseline.assistantId} · parity ${baseline.parity}: ${baseline.parityDetail}`);
  }
  return baseline;
}

async function main() {
  const args = process.argv.slice(2);
  const nIdx = args.indexOf("--seeds");
  const kIdx = args.indexOf("--candidates");
  const fIdx = args.indexOf("--filter");
  const seedCount = nIdx >= 0 ? Math.max(1, Math.min(40, parseInt(args[nIdx + 1], 10) || 12)) : 12;
  const k = kIdx >= 0 ? Math.max(1, Math.min(3, parseInt(args[kIdx + 1], 10) || 2)) : 2;
  const filterRx = fIdx >= 0 ? new RegExp(args[fIdx + 1], "i") : null;
  const mode = baselineModeOf(args);

  if (args.includes("--audit-successes")) {
    const { loadSuccessSeeds, auditSuccessCalls } = await import("../server/services/promptEvolution");
    const baseline = await resolveBaseline(mode);
    const seeds = await loadSuccessSeeds(seedCount, filterRx);
    if (!seeds.length) throw new Error("no won-call seeds matched");
    console.log(`success audit: replaying ${seeds.length} call(s) the classifier scored as WINS...`);
    const r = await auditSuccessCalls(baseline.prompt, seeds, (l) => console.log(`  ${l}`));
    console.log(`\n── success audit readout ──`);
    console.log(`${r.audited} won calls replayed · ${r.clean} clean · ${r.findings.length} carrying a defect`);
    for (const f of r.findings) {
      console.log(`\n  ✗ ${f.id} (${f.evalOutcome}) — priceLeaks=${f.priceLeaks} guarantees=${f.guarantees} empty=${f.emptyReplies} claims=${f.claimViolations.join(",") || "none"}`);
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
    const baseline = await resolveBaseline(mode);
    const { seeds, excludedVerified } = await loadSeeds(seedCount, filterRx);
    if (!seeds.length) throw new Error("no seeds matched");
    console.log(`baseline: ghost-replaying the ${baseline.source === "repository" ? "REPOSITORY" : "LIVE"} prompt over ${seeds.length} seed(s) (${excludedVerified} verified conversions excluded)...`);
    // keepReplies in filter mode: the display MUST show the graded
    // conversation — a fresh sampling once showed a passing dialogue while
    // the grade was judged on a differently-phrased one.
    const scored = await scorePrompt(baseline.prompt, seeds, { keepReplies: !!filterRx });
    console.log(`baseline: ${scored.passes}/${scored.total}${scored.unresolvable ? ` (${scored.unresolvable} unresolvable excluded — no next step was possible)` : ""} · ${scored.usage.replays} replays, ${scored.usage.judgeCalls} judge calls`);
    for (const g of scored.grades) {
      const verdict = g.unresolvable ? "UNRESOLVABLE" : g.pass ? "PASS" : g.deflected ? "fail (deflected)" : "fail";
      const judged = g.judgeReason ? ` [judge${g.judgeUnavailable ? " UNAVAILABLE" : ""}: ${g.judgeReason}]` : "";
      console.log(`  seed ${g.id}: ${verdict} (resolution=${g.resolutionOffered}, priceLeaks=${g.priceLeaks}, guarantees=${g.guarantees}, empty=${g.emptyReplies}, claims=${g.claimViolations.join(",") || "none"})${judged}`);
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
  const { describeSuccessVerdict, describeVerdict } = await import("../server/services/promptEvolutionGate");
  const baseline = await resolveBaseline(mode);
  const result = await runPromptEvolution({
    baseline,
    seedCount,
    candidates: k,
    // Confirmation is cron-only (see header): every sealed seed reads as spent here.
    consumedConfirmationIds: null,
    log: (l) => console.log(`  ${l}`),
  });
  console.log(`seeds: ${result.usableSeeds} (train ${result.trainCount} / holdout ${result.holdoutCount} / confirm ${result.cohorts.confirmEligible} sealed, not run from the CLI) · ${result.excludedVerified} verified conversions excluded from the failure pool`);
  console.log(`baseline: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`);
  console.log(result.lanes.parity ? "lane: the replay matches the live lane" : `lane: PROXY — ${result.lanes.differences.join("; ")}`);
  for (const c of result.candidateSummaries) {
    const margin = c.trainMargin === undefined ? "" : ` (paired margin ${c.trainMargin}${c.trainUsable === false ? ", UNUSABLE: judge outage" : ""})`;
    console.log(`  candidate ${c.promptHash ?? "?"}: train ${c.train}${margin}${c.rejectedInvariants ? ` REJECTED unscored (policy: ${c.rejectedInvariants.join(",")})` : ""} — ${c.rationale.slice(0, 90)}`);
  }
  console.log(`outcome: ${result.outcome} · promotion stage ${result.promotionStage}`);
  if (result.gates.holdout) console.log(`holdout gate: ${describeVerdict(result.gates.holdout)}`);
  if (result.gates.success) console.log(`success cohort: ${describeSuccessVerdict(result.gates.success)}`);
  if (result.gates.confirmation) console.log(`confirmation: ${describeVerdict(result.gates.confirmation)}`);
  console.log(`cost: ${result.usage.replays} replays · ${result.usage.judgeCalls} judge calls · ${result.usage.optimizerCalls} optimizer calls · ${Math.round(result.usage.durationMs / 1000)}s`);

  const outDir = join(process.cwd(), "eval-datasets", "prompt-evolution");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const baselineLabel = baseline.source === "repository"
    ? `REPOSITORY prompt ${baseline.promptHash} (--baseline repository: NOT the prompt callers hear)`
    : `LIVE prompt ${baseline.promptHash} from assistant ${baseline.assistantId} (parity ${baseline.parity})`;
  if (result.accepted) {
    const proposalPath = join(outDir, `proposal-${stamp}.md`);
    const diff = result.candidateDiff;
    writeFileSync(proposalPath, [
      `# Prompt evolution proposal — ${stamp}`,
      ``,
      `PROPOSAL ONLY. The served prompt is unchanged; applying this is an operator decision via the normal edit + Push Config gate.`,
      ``,
      `- Outcome: ${result.outcome} (${result.accepted.confirmed ? "confirmed" : "UNCONFIRMED: the sealed confirmation set is cron-only"})`,
      `- Baseline: ${baselineLabel}`,
      `- Baseline scores: train ${result.baselineTrain} · holdout ${result.baselineHoldout}`,
      `- Candidate ${result.accepted.promptHash} holdout (paired permutation test): ${result.accepted.holdout}`,
      `- Lane: ${result.lanes.parity ? "replay matches the live lane" : `proxy (${result.lanes.differences.join("; ")})`}`,
      `- Rationale: ${result.accepted.rationale}`,
      `- Placement: ${
        diff?.codeEdit === true ? "code edit: the candidate keeps the served lessons block verbatim at its end, so the text before it is the new ASSISTANT_SYSTEM_PROMPT"
          : diff?.codeEdit === false ? "CAUTION: the edit changes or follows the learned-lessons block; applied as a code edit it would sit before the lessons, so Push Config would serve a different text from the one measured"
            : "unknown: the baseline has no code/lessons boundary (diverged or no diff)"
      }`,
      ``,
      ...(diff
        ? [`## Line diff (baseline line ${diff.startLine}: ${diff.removedCount} removed, ${diff.addedCount} added${diff.truncated ? ", truncated" : ""})`, "", "```diff", ...diff.removed.map((l) => `- ${l}`), ...diff.added.map((l) => `+ ${l}`), "```", ""]
        : []),
      `## Full candidate prompt`,
      ``,
      "```",
      result.accepted.prompt,
      "```",
    ].join("\n"));
    console.log(`proposal written → ${proposalPath}`);
  } else {
    appendFileSync(join(outDir, "rejected.jsonl"), JSON.stringify({
      date: stamp,
      outcome: result.outcome,
      baseline: result.baseline,
      lanes: { parity: result.lanes.parity, differences: result.lanes.differences },
      candidates: result.candidateSummaries,
      gates: result.gates,
      usage: result.usage,
    }) + "\n");
    console.log("no proposal shipped — negative feedback recorded.");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[prompt-evolve] fatal:", err);
  process.exit(1);
});
