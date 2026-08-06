/**
 * Refuted-claims miner (2026-08-05) — corpus alchemy over the agent memory.
 *
 * The operator's memory index is an unusual asset: dozens of dated topic
 * files recording, with receipts, exactly where model claims were REFUTED
 * ("5 of 7 leak claims refuted", "3 of my own mid-session claims refuted",
 * "built != wired"). That is a fabrication-critic training corpus made of
 * the precise hallucination shapes THIS repo induces — and the UPSTREAMS
 * Unsloth + Ax WATCH rows are both blocked on "zero labeled corpus".
 *
 * This miner parses refutation-shaped lines into the WP-21 EvalCase JSONL
 * shape (same {input, expected, metadata} contract as
 * export-eval-datasets.ts) under eval-datasets/ — LOCAL + NO-SEND, exactly
 * like that exporter: nothing leaves the machine, and promotion into a
 * committed corpus or Braintrust stays a deliberate reviewed step.
 *
 * Extraction is deliberately shallow: a refutation line plus its immediate
 * context, flagged clean/context by shape. The harvest review lane is the
 * quality gate; a miner that over-cleans silently is a miner that invents
 * labels.
 *
 * Run:  pnpm exec tsx scripts/mine-refuted-claims.ts [--dir <memory-dir>] [--self-test]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MEMORY_DIR = "C:/Users/nourd/.claude/projects/C--Users-nourd-NOURCITY/memory";
const OUT_DIR = join(process.cwd(), "eval-datasets");

export interface RefutedCase {
  input: { claim: string; context: string };
  expected: { verdict: "refuted"; note: string };
  metadata: {
    app: "statenour";
    feature: "fabrication-critic";
    source: string;
    quality: "clean" | "context";
    exported_at: string;
  };
}

const REFUTE_RX = /refut/i;
/** Lines that reference refutation without carrying a claim (index pointers, "do not re-flag" reminders). */
const CONTEXT_ONLY_RX = /(do not re-flag|never re-plan|refuted list|REFUTED list|list inside|superseded)/i;

export function mineLines(fileName: string, text: string, exportedAt: string): RefutedCase[] {
  const lines = text.split(/\r?\n/);
  const out: RefutedCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!REFUTE_RX.test(line)) continue;
    // Strip markdown furniture; what remains must still look like a statement.
    const stripped = line.replace(/^[-*#>\s\[\]]+/, "").trim();
    if (stripped.length < 25) continue;
    const context = [lines[i - 1]?.trim(), lines[i + 1]?.trim()].filter(Boolean).join(" · ").slice(0, 400);
    const quality: RefutedCase["metadata"]["quality"] =
      CONTEXT_ONLY_RX.test(stripped) || stripped.length < 60 ? "context" : "clean";
    out.push({
      input: { claim: stripped.slice(0, 500), context },
      expected: {
        verdict: "refuted",
        note: "recorded in agent memory with receipts — a claim this shape was made and disproven in this repo",
      },
      metadata: {
        app: "statenour",
        feature: "fabrication-critic",
        source: `${fileName}:${i + 1}`,
        quality,
        exported_at: exportedAt,
      },
    });
  }
  return out;
}

function selfTest(): never {
  const fixture = [
    "# topic",
    "- [vapi arc](x.md) — 5 of 7 leak claims REFUTED; I overstated the defect 3.3x against the measured rows",
    "- short REFUTED", // < 25 chars after strip → dropped
    "- see the REFUTED list inside for details of that audit and its receipts", // context-only phrasing
    "The claim that exceptionFeed had zero consumers was refuted: OverviewSection.tsx:414 renders it today.",
  ].join("\n");
  const cases = mineLines("fixture.md", fixture, "t");
  const clean = cases.filter((c) => c.metadata.quality === "clean");
  const ok =
    cases.length === 3 &&
    clean.length === 2 &&
    cases.some((c) => c.input.claim.includes("exceptionFeed")) &&
    !cases.some((c) => c.input.claim === "short REFUTED");
  console.log(ok ? "self-test PASS" : `self-test FAIL — ${cases.length} cases, ${clean.length} clean: ${JSON.stringify(cases.map((c) => c.input.claim))}`);
  process.exit(ok ? 0 : 1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) selfTest();
  const dirIdx = args.indexOf("--dir");
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : DEFAULT_MEMORY_DIR;
  const exportedAt = new Date().toISOString();

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  let all: RefutedCase[] = [];
  for (const f of files) {
    all = all.concat(mineLines(f, readFileSync(join(dir, f), "utf8"), exportedAt));
  }
  const clean = all.filter((c) => c.metadata.quality === "clean");

  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, "refuted-claims.jsonl");
  writeFileSync(file, clean.map((c) => JSON.stringify(c)).join("\n") + (clean.length ? "\n" : ""));

  console.log(`scanned ${files.length} memory files`);
  console.log(`${all.length} refutation-shaped lines · ${clean.length} clean cases → ${file}`);
  console.log(`UPSTREAMS trigger context: Unsloth + Ax rows reopen at ~200 correction cases; clean cases here count toward the fabrication-critic seat AFTER harvest review.`);
}

main();
