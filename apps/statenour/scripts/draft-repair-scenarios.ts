/**
 * scripts/draft-repair-scenarios.ts — turn operator repairs into eval scenarios (2026-09-22).
 *
 * THE LOOP THIS CLOSES. `harvest:repairs` finds the turns where the operator
 * corrected Nick in his own words and pairs each with the reply it corrects.
 * That is the strongest failure signal the corpus has — and until now it
 * stopped in a gitignored JSON file. This script carries it the last step:
 * each candidate becomes a MULTI-TURN scenario draft,
 *
 *     user      · the original ask (fetched: the user message before the reply)
 *     assistant · the reply the operator rejected, verbatim (truncated)
 *     user      · the repair, in the operator's own words
 *
 * and the judge scores whether the NEXT reply actually improves. That is the
 * most faithful representation of a repair: the scenario replays the exact
 * state Nick was in when he was told "try again", including his own weak
 * answer, so a regression is "Nick still cannot recover from this".
 *
 * DRAFTS, NOT SCENARIOS. Output goes to the gitignored `eval-datasets/`, not
 * to tests/eval/scenarios/. Drafts carry verbatim operator content; the
 * README's rule is "review before promoting", and the judge criteria drafted
 * here per failure class are a starting point a human sharpens. Promotion is
 * a copy into tests/eval/scenarios/ by hand, with the description edited to
 * say what THIS case is really testing.
 *
 * READ-ONLY BY CONSTRUCTION — findFirst/findUnique only, pinned by the same
 * source-scan contract as the harvesters (tests/eval/draft-repair-scenarios.test.ts).
 *
 * POSITIVE CONTROL. Every draft is validated against the REAL scenario schema
 * (tests/eval/types.ts) before it is written, and the run refuses to emit a
 * draft that fails it. A converter whose output the suite would reject is not
 * a converter.
 *
 * Usage (from apps/statenour):
 *   pnpm eval:draft-repairs                          # reads eval-datasets/repair-signal-candidates.json
 *   pnpm eval:draft-repairs --in other.json --out eval-datasets/repair-scenario-drafts
 */

import { loadEnvConfig } from "@next/env";
import Module from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REQUIRES_TOOLS_TAG,
  scenarioSchema,
  type Scenario,
  type ScenarioCategory,
} from "@/tests/eval/types";
import { resolveOutPath, type RepairCandidate, type RepairClass } from "./harvest-repair-signals";

/** Same reasons as scripts/harvest-repair-signals.ts — see its header. */
function installScriptEnvironment(): void {
  loadEnvConfig(process.cwd());
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

// ── Per-class judging ────────────────────────────────────────────────────

/**
 * What "recovered" means for each failure shape. Weights follow the persona
 * set's rule: the criterion that names the failure carries the dominant weight,
 * so a warm-but-unchanged answer cannot out-score a blunt fixed one.
 */
export const CRITERIA_BY_CLASS: Record<RepairClass, Scenario["judgeCriteria"]> = {
  UNDER_RESEARCH: [
    { id: "goes-beyond-obvious", description: "Adds something the operator plausibly did NOT already know — specific, concrete, non-boilerplate. A restatement of common knowledge fails.", weight: 4 },
    { id: "uses-known-context", description: "Draws on what Nick knows about the operator's business/context rather than generic advice.", weight: 3 },
    { id: "not-a-repeat", description: "Does not re-serve the rejected reply's points in new wording.", weight: 2 },
  ],
  GENERIC: [
    { id: "specific-and-actionable", description: "Every recommendation is specific enough to act on today — named steps, numbers, or examples. Vague verbs ('optimize', 'leverage') fail.", weight: 4 },
    { id: "ordered", description: "Prioritised or sequenced, not a flat list.", weight: 2 },
    { id: "not-a-repeat", description: "Does not re-serve the rejected reply's points in new wording.", weight: 2 },
  ],
  MEMORY_MISS: [
    { id: "uses-supplied-fact", description: "Uses the fact the operator just supplied in the repair; does not contradict it or ask for it again.", weight: 4 },
    { id: "no-re-ask", description: "Does not ask the operator to repeat what he already said.", weight: 2 },
  ],
  INSTRUCTION_MISS: [
    { id: "does-what-was-asked", description: "Does the thing actually asked for, not an adjacent thing; the repair's constraint is honoured.", weight: 4 },
    { id: "acknowledges-constraint", description: "Briefly acknowledges the constraint it previously missed, without apologising at length.", weight: 2 },
  ],
  STALE_DATA: [
    { id: "re-verifies", description: "Actually re-checks or fetches current data rather than restating the previous answer with hedges.", weight: 4 },
    { id: "states-as-of", description: "States the as-of date and source of the numbers it gives.", weight: 2 },
  ],
  REPETITION: [
    { id: "genuinely-new", description: "Names things NOT already recommended; if it must reference an old one, says so explicitly.", weight: 4 },
    { id: "acknowledges-repeat", description: "Acknowledges the repeat rather than presenting the same items as fresh.", weight: 2 },
  ],
  FALSE_COMPLETION: [
    { id: "no-unverified-done", description: "Does not claim the action is done unless the reply shows verified evidence; otherwise states exactly what did and did not happen.", weight: 4 },
    { id: "next-step", description: "Gives the concrete next step to actually complete it.", weight: 2 },
  ],
  NO_TOOL: [
    { id: "uses-the-tool", description: "Actually performs the lookup/search/check the operator asked for, or states precisely why it cannot.", weight: 4 },
    { id: "no-guessing", description: "Does not substitute a guess for the lookup.", weight: 2 },
  ],
  WRONG_TOOL: [
    { id: "right-capability", description: "Uses the capability appropriate to the ask, not the one it used before.", weight: 4 },
  ],
  OVERCOACHING: [
    { id: "no-lecture", description: "Answers without unrequested advice, moralising, or a coaching preamble.", weight: 4 },
    { id: "direct", description: "Leads with the answer.", weight: 2 },
  ],
};

/**
 * Category is about what the judge is looking at, not the topic. Every repair
 * draft is a multi-turn replay by construction — the judged reply follows the
 * operator's correction of a real prior reply — so `multi-turn` is the honest
 * default; classes with a more specific existing category use it.
 */
export const CATEGORY_BY_CLASS: Record<RepairClass, ScenarioCategory> = {
  UNDER_RESEARCH: "multi-turn",
  GENERIC: "multi-turn",
  MEMORY_MISS: "memory",
  INSTRUCTION_MISS: "multi-turn",
  STALE_DATA: "multi-turn",
  REPETITION: "multi-turn",
  FALSE_COMPLETION: "multi-turn",
  NO_TOOL: "multi-turn",
  WRONG_TOOL: "multi-turn",
  OVERCOACHING: "persona",
};

/**
 * Classes whose "recovered" criterion is a REAL tool action — a lookup, a
 * re-fetch, a verified write. `pnpm eval:live` replays through aiChat, which
 * has no tool support, so a draft of one of these classes is born tagged
 * REQUIRES_TOOLS_TAG and the live runner skips it with a stated reason instead
 * of scoring an impossible criterion (review on PR #2487, 2026-09-22: eight
 * hand-curated repairs had shipped untagged). The tag travels with the draft
 * so curation cannot forget it.
 */
export const TOOL_DEPENDENT_CLASSES: ReadonlySet<RepairClass> = new Set<RepairClass>([
  "FALSE_COMPLETION",
  "NO_TOOL",
  "WRONG_TOOL",
  "STALE_DATA",
]);

/** The rejected reply is context for the judge, not the subject; cap it so the rubric stays readable. */
export const ASSISTANT_CONTEXT_CAP = 1500;

function tidy(text: string, cap: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= cap ? t : `${t.slice(0, cap - 1)}…`;
}

/** Pure — exported for tests. */
export function draftScenario(
  candidate: RepairCandidate,
  originalAsk: string,
  now: Date = new Date(),
): Scenario {
  const cls = candidate.failureClass;
  const slug = `repair-${cls.toLowerCase().replace(/_/g, "-")}-${candidate.repairMessageId.slice(-8).toLowerCase()}`;
  const draft: Scenario = {
    id: slug,
    name: `Repair · ${cls.toLowerCase().replace(/_/g, " ")} · "${tidy(candidate.repairText, 48)}"`,
    description:
      `Mined from a real operator repair (${candidate.tier} tier, ${candidate.label}) on ${candidate.repairedAt.slice(0, 10)}` +
      `${candidate.latencySeconds !== null ? `, ${candidate.latencySeconds}s after the reply` : ""}. ` +
      `The operator's own words are the repair message; the judge scores whether the NEXT reply recovers. ` +
      `Provenance: ${candidate.id} · drafted ${now.toISOString().slice(0, 10)}. CURATE BEFORE PROMOTING — sharpen the criteria to what this case really tests.`,
    category: CATEGORY_BY_CLASS[cls],
    input: {
      messages: [
        { role: "user", content: tidy(originalAsk, 2000) },
        { role: "assistant", content: tidy(candidate.assistantPreview ?? "", ASSISTANT_CONTEXT_CAP) },
        { role: "user", content: tidy(candidate.repairText, 1000) },
      ],
    },
    judgeCriteria: CRITERIA_BY_CLASS[cls],
    expectedBehavior: `A reply the operator would NOT have to correct again: it addresses the failure the repair names (${cls.toLowerCase().replace(/_/g, " ")}) rather than re-serving the rejected reply politely.`,
    tags: [
      "repair-mined",
      cls.toLowerCase(),
      candidate.tier,
      ...(TOOL_DEPENDENT_CLASSES.has(cls) ? [REQUIRES_TOOLS_TAG] : []),
    ],
  };
  // Positive control: the suite's own schema is the acceptance test.
  return scenarioSchema.parse(draft);
}

// ── Main ─────────────────────────────────────────────────────────────────

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  installScriptEnvironment();
  const inPath = arg("--in") ?? "eval-datasets/repair-signal-candidates.json";
  // Same boundary as the harvester (review on #2480): a draft carries the
  // operator's ask and repair verbatim, so --out may not leave eval-datasets/.
  const outDir = resolveOutPath(arg("--out") ?? "eval-datasets/repair-scenario-drafts");

  const report = JSON.parse(readFileSync(inPath, "utf8")) as { candidates: RepairCandidate[] };
  const eligible = report.candidates.filter((c) => c.tier !== "weak" && c.assistantMessageId);
  console.log(`\neval:draft-repairs · ${eligible.length} eligible of ${report.candidates.length} candidates (strong+medium with a paired reply)`);

  const { prisma } = await import("@/lib/prisma");
  mkdirSync(outDir, { recursive: true });

  let drafted = 0;
  let noAsk = 0;
  let rejected = 0;
  const byClass: Record<string, number> = {};
  const index: Array<{ id: string; failureClass: string; category: string; file: string }> = [];

  for (const c of eligible) {
    // The reply's own row, for its timestamp; then the user message just before it
    // in the SAME conversation — the ask the rejected reply was answering.
    const reply = await prisma.chatMessage.findUnique({
      where: { id: c.assistantMessageId! },
      select: { createdAt: true, conversationId: true },
    });
    if (!reply) {
      noAsk += 1;
      continue;
    }
    const ask = await prisma.chatMessage.findFirst({
      where: { conversationId: reply.conversationId, role: "user", createdAt: { lt: reply.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (!ask?.content?.trim()) {
      noAsk += 1;
      continue;
    }
    try {
      const draft = draftScenario(c, ask.content);
      const file = join(outDir, `${draft.id}.json`);
      writeFileSync(file, JSON.stringify(draft, null, 2), "utf8");
      drafted += 1;
      byClass[c.failureClass] = (byClass[c.failureClass] ?? 0) + 1;
      index.push({ id: draft.id, failureClass: c.failureClass, category: draft.category, file });
    } catch (e) {
      rejected += 1;
      console.error(`  ✗ ${c.id}: draft failed the scenario schema — ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }

  writeFileSync(join(outDir, "_index.json"), JSON.stringify({ draftedAt: new Date().toISOString(), drafted, noAsk, rejected, byClass, index }, null, 2), "utf8");
  console.log(`drafted:            ${drafted}`);
  console.log(`no original ask:    ${noAsk}`);
  console.log(`schema-rejected:    ${rejected}`);
  console.log("by class:");
  for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(`\nwrote drafts -> ${outDir}/ (gitignored · curate into tests/eval/scenarios/ by hand)`);
  if (rejected > 0) process.exit(1);
}

const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("scripts/draft-repair-scenarios.ts")) {
  main().catch((e) => {
    console.error("eval:draft-repairs crashed:", e);
    process.exit(1);
  });
}
