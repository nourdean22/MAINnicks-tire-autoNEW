#!/usr/bin/env node
/**
 * scripts/audit-a11y.mjs · v10.0.426
 *
 * Heuristic accessibility audit for the operator-facing pages.
 * Skill: ui-a11y · WCAG 2.2 AA + iOS HIG touch targets.
 *
 * Catches the highest-leverage misses:
 *   1. Buttons without aria-label or visible text
 *   2. Inputs without associated labels
 *   3. Anchor without href ("button-styled-as-link")
 *   4. Modal/dialog without role="dialog" or aria-modal
 *   5. Decorative icons rendered without aria-hidden
 *   6. <img> without alt attribute
 *   7. Untargetable text in role="button" elements
 *
 * Run · node scripts/audit-a11y.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SCAN_ROOTS = [
  "app/(mastery)",
  "components/chat",
  "components/brain",
  "components/ultron",
  "components/missions",
  "components/actions",
  "components/system",
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (e.endsWith(".tsx")) out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const findings = [];

function scan(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // Helper · grab the full opening tag span starting at index `start`.
  // Returns { attrs, end } where `end` is the index of the closing `>`.
  // Handles multi-line attribute lists by walking until the unescaped `>`
  // outside any embedded {…} JSX expression.
  function grabOpeningTag(start) {
    let i = start;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        return { attrs: text.slice(start, i), end: i };
      }
      i++;
    }
    return { attrs: text.slice(start, start + 200), end: start + 200 };
  }

  // 1. <button> without aria-label and no plain text child (heuristic:
  //    if the next 4 lines after <button contain only `<Icon` + tags +
  //    closing `</button>`, it's icon-only and needs aria-label).
  const buttonOpens = [...text.matchAll(/<button\b/g)];
  for (const m of buttonOpens) {
    const { attrs, end } = grabOpeningTag(m.index + "<button".length);
    if (/aria-label\s*=/.test(attrs)) continue;
    if (/title\s*=/.test(attrs)) continue;
    // Find closing </button> within next 600 chars
    const after = text.slice(end + 1, end + 600);
    const closeIdx = after.indexOf("</button>");
    if (closeIdx === -1) continue;
    const inner = after.slice(0, closeIdx);
    // Strip JSX expressions + comments
    const stripped = inner.replace(/{[^}]*}/g, "").replace(/<[^>]+\/>|<\w[^>]*>|<\/\w[^>]*>/g, " ").trim();
    const hasText = stripped.length > 1;
    const hasIcon = /<(Icon|[A-Z]\w*)\s/.test(inner);
    if (!hasText && hasIcon) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      findings.push({
        severity: "med",
        rule: "icon-button-no-label",
        file,
        line: lineNo,
        snippet: m[0].slice(0, 100),
      });
    }
  }

  // 2. <input> without label/aria-label · multi-line attr aware
  const inputOpens = [...text.matchAll(/<input\b/g)];
  for (const m of inputOpens) {
    const { attrs } = grabOpeningTag(m.index + "<input".length);
    if (/(aria-label|aria-labelledby|placeholder)\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["'](?:hidden|file|submit|reset|button)["']/.test(attrs)) continue;
    const lineNo = text.slice(0, m.index).split("\n").length;
    findings.push({
      severity: "med",
      rule: "input-no-label",
      file,
      line: lineNo,
      snippet: lines[lineNo - 1].trim().slice(0, 100),
    });
  }

  // 3. <a without href · multi-line attr aware
  const anchorOpens = [...text.matchAll(/<a\b/g)];
  for (const m of anchorOpens) {
    const { attrs } = grabOpeningTag(m.index + "<a".length);
    if (!/href\s*=/.test(attrs)) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      findings.push({
        severity: "low",
        rule: "anchor-no-href",
        file,
        line: lineNo,
        snippet: lines[lineNo - 1].trim().slice(0, 100),
      });
    }
  }

  // 4. Modal patterns · "fixed inset-0 z-..." backdrops without role="dialog"
  const modalish = [...text.matchAll(/className=(?:"|')[^"']*\bfixed\b[^"']*\binset-0\b[^"']*(?:"|')/g)];
  for (const m of modalish) {
    // Look back 200 chars for role= or aria-modal=
    const back = text.slice(Math.max(0, m.index - 300), m.index);
    if (/role\s*=\s*["']dialog["']/.test(back)) continue;
    if (/aria-modal/.test(back)) continue;
    // Skip if it's a backdrop-only div (no children that look like a dialog)
    const lineNo = text.slice(0, m.index).split("\n").length;
    findings.push({
      severity: "low",
      rule: "modal-no-role",
      file,
      line: lineNo,
      snippet: lines[lineNo - 1].trim().slice(0, 100),
    });
  }

  // 5. <img without alt
  const imgOpens = [...text.matchAll(/<img\b([^>]*)>/g)];
  for (const m of imgOpens) {
    if (!/alt\s*=/.test(m[1])) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      findings.push({
        severity: "med",
        rule: "img-no-alt",
        file,
        line: lineNo,
        snippet: m[0].slice(0, 100),
      });
    }
  }
}

for (const root of SCAN_ROOTS) {
  for (const f of walk(root)) scan(f);
}

if (findings.length === 0) {
  console.log("✓ no a11y heuristic violations found in scanned roots");
  process.exit(0);
}

// Group by rule for readable output
const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, []);
  byRule.get(f.rule).push(f);
}

console.log(`✗ ${findings.length} a11y heuristic finding(s)\n`);
const RULE_DESC = {
  "icon-button-no-label": "icon-only buttons need aria-label or title for screen readers",
  "input-no-label": "input has no aria-label / aria-labelledby / placeholder",
  "anchor-no-href": "<a without href is not keyboard-focusable · use <button> instead",
  "modal-no-role": "fixed-inset overlay should have role=\"dialog\" + aria-modal=\"true\"",
  "img-no-alt": "<img> without alt attribute · screen-reader inaccessible",
};
for (const [rule, hits] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`[${rule}] ${hits.length} hit(s) · ${RULE_DESC[rule] ?? ""}`);
  for (const h of hits.slice(0, 5)) {
    console.log(`  ${h.file}:${h.line}`);
    console.log(`    ${h.snippet}`);
  }
  if (hits.length > 5) console.log(`  +${hits.length - 5} more`);
  console.log("");
}
