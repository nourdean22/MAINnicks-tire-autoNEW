#!/usr/bin/env tsx
/**
 * measure-prompt-size.ts — regression guard for the system prompt.
 *
 * The prompt now injects: permanent principles + pinned_user (top 5) +
 * identity/feedback memories (24 rows) + chat pattern + conversation
 * context + device list + recent syncs + market intel + continuity +
 * brain state. On a dense day the sum can drift past Venice's 50K
 * ceiling silently (truncation happens mid-sentence with no error).
 *
 * This script:
 *   1. Calls buildSystemPrompt() against LIVE Neon data so we see
 *      the real current prompt size.
 *   2. Prints a breakdown — total chars + estimated tokens (÷4).
 *   3. Exits non-zero if total > MAX_CHARS (default 40,000 = 20% headroom).
 *
 * Run:
 *   npm run prompt:size-check
 *   # or
 *   npx tsx scripts/measure-prompt-size.ts [--max 40000]
 *
 * CI wiring: add to GitHub Actions or Vercel prebuild if desired.
 * For now it's a manual check we run after any prompt change.
 */

import { Module } from "node:module";
import { loadEnv, confirmDatabase } from "./_lib/safety";

/**
 * Neutralize `server-only` for this standalone `tsx` script.
 *
 * measure-prompt-size imports the prompt-builder graph, which
 * transitively reaches modules that do `import "server-only"`
 * (extract-structured.ts, budget.ts, …). server-only's index.js throws
 * at load time unless the `react-server` export condition is set — and
 * a bare `tsx` script has no such condition, so the import crashed
 * before buildSystemPrompt() ever ran.
 *
 * `Module._load` is the CJS resolver every require() funnels through,
 * including the ESM→CJS bridge (confirmed by the original crash stack).
 * Returning an empty module for `server-only` is exactly what its own
 * `empty.js` (the react-server build) does — a no-op. Tooling-only:
 * the production RSC build is unaffected.
 */
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

async function main() {
  neutralizeServerOnly();
  loadEnv();
  const args = process.argv.slice(2);
  const maxArg = args.indexOf("--max");
  // v10.0.173 · cap raised 40K → 60K. Venice's actual context window
  // is ~1M tokens (~4M chars). The 40K cap was set when models had
  // small windows and is no longer the binding constraint. The true
  // ceiling is operator-readable prompt audit utility — beyond ~60K
  // the per-section breakdown becomes unreadable, so cap stays
  // meaningful as a "is this prompt getting unwieldy?" guard rather
  // than a "will the model accept it?" guard.
  // 2026-07-11 review · the cap is the REAL runtime ceiling — the
  // per-provider hard slice in finalize-system-prompt.ts (65,000 for every
  // non-anthropic provider). The old 60K "readability" number never matched
  // the runtime, and the script only ever measured the default slot, so the
  // heaviest real prompts (content +45K, content-deep +77-81K) sailed past
  // the guard. We now measure representative (tier, message) scenarios that
  // exercise the content / deep / sms slots and fail if ANY exceeds the cap.
  const RUNTIME_MAX = 65_000;
  const max = maxArg >= 0 ? Number(args[maxArg + 1]) : RUNTIME_MAX;
  const skipConfirm = args.includes("--yes") || !!process.env.CI;

  if (!skipConfirm) {
    await confirmDatabase("measure-prompt-size");
  }

  // Import AFTER loadEnv so Prisma picks up DATABASE_URL
  const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");
  const cacheMod = await import("@/lib/ai/system-prompt-cache").catch(
    () => null
  );

  const SCENARIOS: Array<{ label: string; tier?: string; message?: string }> = [
    { label: "default (full/greeting)" },
    { label: "business", tier: "business", message: "how's revenue tracking this week vs last?" },
    { label: "content (carousel)", tier: "business", message: "write me an instagram carousel about winter tire safety" },
    { label: "content-deep (plan)", tier: "business", message: "build my monthly content plan and posting strategy across reels and carousels" },
    { label: "sms (winback)", tier: "business", message: "send an sms winback to customers who haven't come in this year" },
  ];

  let worst = { label: "", chars: 0, prompt: "" };
  let failed = false;
  console.log("─".repeat(60));
  console.log(`PROMPT SIZE REPORT (multi-scenario) — ${new Date().toISOString()}`);
  console.log(`runtime cap: ${max.toLocaleString()} chars (finalize hard slice)`);
  console.log("─".repeat(60));
  for (const sc of SCENARIOS) {
    cacheMod?.invalidatePromptCache?.();
    const t = Date.now();
    const p = await buildSystemPrompt(sc.tier as never, sc.message ?? null);
    const ms = Date.now() - t;
    const over = p.length > max;
    if (over) failed = true;
    if (p.length > worst.chars) worst = { label: sc.label, chars: p.length, prompt: p };
    console.log(
      `${over ? "FAIL" : "ok  "}  ${String(p.length).padStart(6)} ch  ${String(Math.round(p.length / 4)).padStart(5)} tok  ${String(ms).padStart(4)}ms  ${sc.label}`,
    );
  }
  console.log("─".repeat(60));

  // Detailed section breakdown for the heaviest scenario.
  const prompt = worst.prompt;
  const elapsedMs = 0;
  const chars = prompt.length;
  const tokens = Math.round(chars / 4);
  const words = prompt.split(/\s+/).filter(Boolean).length;
  console.log(`heaviest scenario: ${worst.label} (${chars.toLocaleString()} chars)`);

  // Section-by-section breakdown — split on the bold "## " headers
  // the buildSystemPromptUncached function inserts.
  const sections = prompt.split(/\n(?=## )/g);
  const sectionStats = sections
    .map((sec) => {
      const firstLine = sec.split("\n")[0];
      const title = firstLine.replace(/^##\s*/, "").slice(0, 64);
      return { title, chars: sec.length, tokens: Math.round(sec.length / 4) };
    })
    .sort((a, b) => b.chars - a.chars);

  console.log("─".repeat(60));
  console.log(`PROMPT SIZE REPORT — ${new Date().toISOString()}`);
  console.log("─".repeat(60));
  console.log(`build time:       ${elapsedMs}ms`);
  console.log(`total chars:      ${chars.toLocaleString()}`);
  console.log(`estimated tokens: ${tokens.toLocaleString()}`);
  console.log(`words:            ${words.toLocaleString()}`);
  console.log(`section count:    ${sections.length}`);
  console.log(`cap (chars):      ${max.toLocaleString()}`);
  console.log(`headroom:         ${(max - chars).toLocaleString()} chars (${Math.round(((max - chars) / max) * 100)}%)`);
  console.log("─".repeat(60));
  console.log("TOP 10 SECTIONS BY SIZE");
  console.log("─".repeat(60));
  for (const s of sectionStats.slice(0, 10)) {
    const pct = Math.round((s.chars / chars) * 100);
    const bar = "█".repeat(Math.min(40, Math.round(pct / 2)));
    console.log(
      `${String(s.chars).padStart(6)} ch  ${String(s.tokens).padStart(5)} tok  ${String(pct).padStart(3)}%  ${bar} ${s.title}`
    );
  }
  console.log("─".repeat(60));

  if (failed) {
    console.error(
      `\nFAIL: at least one scenario exceeds the ${max.toLocaleString()}-char runtime cap (heaviest: ${worst.label} @ ${chars.toLocaleString()}). It will be hard-sliced mid-content at runtime — trim the top section above or drop a knowledge block.`
    );
    process.exit(1);
  }

  console.log(`PASS: every scenario fits under the ${max.toLocaleString()}-char runtime cap (heaviest ${chars.toLocaleString()}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("measure-prompt-size crashed:", err);
  process.exit(2);
});
