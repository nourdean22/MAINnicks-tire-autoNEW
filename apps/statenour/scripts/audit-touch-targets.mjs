#!/usr/bin/env node
/**
 * scripts/audit-touch-targets.mjs · v10.0.419
 *
 * Heuristic audit for mobile touch-target compliance.
 *
 * iOS HIG · 44×44pt minimum
 * Android Material · 48×48dp minimum
 *
 * We flag <button> / <a> elements whose Tailwind class string sets
 * mobile sizing under 44px:
 *   · w-N h-N where N < 11 (without sm: override that increases it)
 *   · py-1 without min-h-[44px] (text-only buttons → ~28px high)
 *   · px-2 py-1 without sm: bumping (compact desktop chip with no
 *     mobile bump)
 *
 * False-positive prone · skip files in /admin, /system/ as those
 * are desktop-first dashboards. Focus on chat, brain, ultron, body.
 *
 * Run · node scripts/audit-touch-targets.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SCAN_ROOTS = ["components/chat", "components/brain", "components/ultron", "components/body", "components/ui"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const findings = [];

for (const root of SCAN_ROOTS) {
  let files;
  try { files = walk(root); } catch { continue; }
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // Detect button/anchor opening with className
      if (!/<(button|a)\b/.test(ln) && !/className=/.test(ln)) continue;
      // Get a 5-line window with the className string
      const window = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 6)).join(" ");
      if (!/<(button|a)\b/.test(window)) continue;

      // Compact-undersized patterns
      const hasMobileSizingFlaw =
        // size class < 44px without sm: increase
        (/\bw-(?:8|9|10)\b/.test(ln) && !/sm:w-(?:11|12|14|16)/.test(ln)) ||
        (/\bh-(?:8|9|10)\b/.test(ln) && !/sm:h-(?:11|12|14|16)/.test(ln)) ||
        // py-1 with no min-h, no sm: bump
        (/\bpy-(?:0|1)\b/.test(ln) && !/(min-h-\[(?:44|48)px\]|sm:py-)/.test(ln) && /<(button|a)/.test(window));

      if (!hasMobileSizingFlaw) continue;
      if (/role="presentation"/.test(window)) continue; // decorative

      findings.push({
        file: f,
        line: i + 1,
        snippet: ln.trim().slice(0, 100),
      });
    }
  }
}

if (findings.length === 0) {
  console.log("✓ no obviously undersized touch targets in scanned roots");
  process.exit(0);
}

console.log(`✗ ${findings.length} potentially undersized touch target(s):\n`);
const grouped = new Map();
for (const f of findings) {
  if (!grouped.has(f.file)) grouped.set(f.file, []);
  grouped.get(f.file).push(f);
}
for (const [file, hits] of grouped) {
  console.log(`${file}  (${hits.length})`);
  for (const h of hits.slice(0, 3)) {
    console.log(`  L${h.line} · ${h.snippet}`);
  }
  if (hits.length > 3) console.log(`  +${hits.length - 3} more`);
}
console.log("\nguidance · iOS HIG = 44px min · Android Material = 48dp min");
console.log("            for chips · w-11 h-11 sm:w-8 sm:h-8 (44 mobile, 32 desktop)");
console.log("            for text buttons · py-2 sm:py-1 min-h-[44px] sm:min-h-0");
process.exit(0);
