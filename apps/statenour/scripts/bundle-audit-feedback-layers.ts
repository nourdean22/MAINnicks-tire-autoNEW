/**
 * scripts/bundle-audit-feedback-layers.ts · v10.0.415
 *
 * Lightweight bundle-size audit for the v10.0.397-414 wave.
 * Reports raw + minified-equivalent line/byte counts for each
 * new file added in the wave so we have a baseline · run before
 * + after future iterations to catch bloat.
 */
import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FILES = [
  // Endpoints + libs
  "lib/brain/improve-agent.ts",
  "lib/brain/wisdom-evolution.ts",
  "lib/brain/violation-context.ts",
  "lib/db/vector-tuning.ts",
  "lib/ai/prompt/policy/operator-rules.ts",
  // API routes
  "app/api/brain/wisdom/[id]/related/route.ts",
  "app/api/brain/wisdom/violations/route.ts",
  "app/api/brain/wisdom/evolution/route.ts",
  "app/api/brain/improve-agent/route.ts",
  "app/api/cron/brain-feedback-loop/route.ts",
  // Components
  "components/brain/brain-insights-panel.tsx",
  "components/brain/related-wisdom-links.tsx",
  "components/brain/wisdom-evolution-panel.tsx",
  "components/chat/mode-persona-chip.tsx",
  // Pages
  "app/(mastery)/brain/improve/page.tsx",
];

interface Row { file: string; bytes: number; lines: number; chars: number }

function strip(s: string): number {
  // rough · strip block + line comments and blank lines for "code chars"
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*$/gm, "")
    .length;
}

async function main() {
  const out: Row[] = [];
  for (const f of FILES) {
    try {
      const path = resolve(process.cwd(), f);
      const s = await stat(path);
      const text = await readFile(path, "utf8");
      const lines = text.split("\n").length;
      out.push({ file: f, bytes: s.size, lines, chars: strip(text) });
    } catch (err) {
      console.warn(`skip · ${f} · ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("=== bundle-audit · feedback layers v10.0.397-414 ===\n");
  console.log("file".padEnd(60) + "bytes".padStart(10) + "lines".padStart(8) + "code-chars".padStart(12));
  console.log("-".repeat(90));
  let totalBytes = 0;
  let totalLines = 0;
  let totalCode = 0;
  for (const r of out.sort((a, b) => b.bytes - a.bytes)) {
    console.log(
      r.file.padEnd(60) +
        String(r.bytes).padStart(10) +
        String(r.lines).padStart(8) +
        String(r.chars).padStart(12),
    );
    totalBytes += r.bytes;
    totalLines += r.lines;
    totalCode += r.chars;
  }
  console.log("-".repeat(90));
  console.log(
    "TOTAL · 15 files".padEnd(60) +
      String(totalBytes).padStart(10) +
      String(totalLines).padStart(8) +
      String(totalCode).padStart(12),
  );
  console.log(`\nestimated client bundle delta · ~${Math.round(totalCode * 0.65 / 1024)}KB raw, ~${Math.round(totalCode * 0.65 / 1024 * 0.4)}KB gzipped`);
  console.log("note · server-only routes/libs do NOT ship to client · client delta ≈ 4 components only.");
}

main().catch((e) => { console.error(e); process.exit(1); });
