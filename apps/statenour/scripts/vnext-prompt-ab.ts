#!/usr/bin/env tsx
/**
 * NICK VNEXT · compact-prompt A/B — $0, flat subscription (2026-08-12).
 *
 * Builds the INCUMBENT default-scenario system prompt through the real
 * assembly path (same as measure-prompt-size.ts), derives the COMPACT
 * candidate MECHANICALLY — incumbent minus the census hit-list sections,
 * split on the trimmer's own `\n## ` boundary — and A/Bs both on the
 * same main-lane model with the shared judge core. Mechanical derivation
 * means no hand-maintained parallel prompt to drift; the candidate is
 * always "today's prompt minus the named sections".
 *
 * The user-prompt set deliberately includes an AGENDA-DEPENDENT ask so
 * the A/B can CATCH what dropping ACTIVE AGENDA costs — if compact loses
 * that case, the census hit-list's "move agenda behind JIT retrieval"
 * needs the retrieval half built before the sections can leave.
 *
 * Usage:
 *   railway run --service statenour-web -- pnpm exec tsx scripts/vnext-prompt-ab.ts --yes
 */

import { Module } from "node:module";
import { loadEnv } from "./_lib/safety";
import { requireKey, chat, judgePairBothOrders, writeArtifacts } from "./_lib/ollama-ab";

function neutralizeServerOnly(): void {
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

const MAIN_MODEL = (process.env.OLLAMA_MODEL || "minimax-m3").trim();
const JUDGE_MODEL = (
  process.env.JUDGE_MODEL ||
  process.env.OLLAMA_FAST_MODEL ||
  "deepseek-v4-flash:0731"
).trim();

/** Census hit-list (docs/PROMPT-CENSUS-2026-08-12.md) — sections the
 *  compact candidate drops. Title-prefix match on the `## ` boundary. */
const DROP_SECTION_PREFIXES = [
  "## ACTIVE AGENDA ITEMS",
  "## Behavioral patterns",
  "## Processing intake",
];

const USER_PROMPTS: Array<{ id: string; prompt: string }> = [
  { id: "strategy-1", prompt: "I have $80K. Open a second tire shop, or reinvest in the current one? What decides it?" },
  { id: "strategy-2", prompt: "A competitor two blocks away started undercutting our oil-change price by $10. What do we actually do?" },
  { id: "agenda-dependent", prompt: "What should I focus on today and why?" },
  { id: "casual", prompt: "hey — anything need my attention?" },
  { id: "decision", prompt: "Should I raise prices at the shop?" },
  { id: "content-lite", prompt: "Give me one instagram post idea for today." },
];

async function main(): Promise<void> {
  neutralizeServerOnly();
  loadEnv();
  if (!requireKey()) return;

  const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");
  const incumbent = await buildSystemPrompt(undefined as never, null);

  const parts = incumbent.split(/\n(?=## )/g);
  const dropped: string[] = [];
  const keptParts = parts.filter((p) => {
    const hit = DROP_SECTION_PREFIXES.find((prefix) => p.startsWith(prefix));
    if (hit) {
      dropped.push(`${hit} (${p.length} ch)`);
      return false;
    }
    return true;
  });
  const compact = keptParts.join("\n");
  const pct = Math.round(((incumbent.length - compact.length) / incumbent.length) * 100);
  console.log(
    `incumbent=${incumbent.length} ch · compact=${compact.length} ch (−${pct}%) · dropped: ${dropped.join(" · ") || "NONE (titles not found?)"}`,
  );
  if (dropped.length === 0) {
    console.error("No hit-list sections found in the built prompt — census titles may have drifted. Aborting (an A/B of identical prompts measures noise).");
    process.exitCode = 3;
    return;
  }

  interface AbResult {
    id: string;
    verdict: "A" | "B" | "tie-unstable" | "error";
    note?: string;
  }
  const RUBRIC = `You are grading two assistant replies to the same operator message. The assistant is a small-business chief-of-staff. Pick the reply that is more USEFUL to the operator: concrete and grounded in his actual business context, direct, decision-advancing, and free of invented specifics. End your answer with exactly one word: FIRST or SECOND.`;

  const results: AbResult[] = [];
  for (const u of USER_PROMPTS) {
    try {
      const [a, b] = await Promise.all([
        chat(MAIN_MODEL, incumbent, u.prompt, 600), // A = incumbent
        chat(MAIN_MODEL, compact, u.prompt, 600), // B = compact
      ]);
      const verdict = await judgePairBothOrders(JUDGE_MODEL, u.prompt, a, b, RUBRIC);
      results.push({ id: u.id, verdict });
      console.log(`${u.id} · verdict=${verdict}`);
    } catch (err) {
      results.push({
        id: u.id,
        verdict: "error",
        note: (err instanceof Error ? err.message : String(err)).slice(0, 120),
      });
      console.log(`${u.id} · ERROR ${results[results.length - 1].note}`);
    }
  }

  const wins = (v: AbResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  const date = process.env.AB_DATE || "undated";
  const lines = [
    `# Compact-prompt A/B · ${date}`,
    "",
    `main=${MAIN_MODEL} · judge=${JUDGE_MODEL} · A=incumbent (${incumbent.length.toLocaleString()} ch) · B=compact (${compact.length.toLocaleString()} ch, −${pct}%)`,
    `Dropped sections: ${dropped.join(" · ")}`,
    "Verdicts count ONLY when both judge orders agree.",
    "",
    "| case | verdict |",
    "|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.verdict}${r.note ? ` (${r.note})` : ""} |`),
    "",
    `**Wins:** incumbent=${wins("A")} · compact=${wins("B")} · unstable=${wins("tie-unstable")} · errors=${wins("error")}`,
    "",
    "Graduation rule (plan #21 / additive migration): compact may replace incumbent only if it wins-or-ties overall AND does not lose the agenda-dependent case — losing that case means the JIT-retrieval half must ship BEFORE the sections leave the prompt.",
  ];
  await writeArtifacts(`PROMPT-AB-${date}`, lines.join("\n"), { incumbentChars: incumbent.length, compactChars: compact.length, dropped, results });
  console.log(`incumbent=${wins("A")} compact=${wins("B")} unstable=${wins("tie-unstable")}`);
}

void main();
