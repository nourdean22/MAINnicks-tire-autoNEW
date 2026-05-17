#!/usr/bin/env node
/**
 * scripts/motion-perf-audit.mjs · v10.0.455
 *
 * Catalogs every @keyframes block in app/globals.css and classifies
 * the animated properties by their browser pipeline cost:
 *
 *   ✓ compositor (cheap)  · transform · opacity · filter (some)
 *   ⚠ paint     (medium)  · color · background · border-color · box-shadow
 *   ✗ layout    (slow)    · width · height · top · left · margin · padding
 *
 * Mixed keyframes (compositor + paint) are flagged for conversion
 * priority so the box-shadow → opacity-on-pseudo refactor has a
 * data-driven priority list.
 *
 * Usage:
 *   node scripts/motion-perf-audit.mjs           # human-readable report
 *   node scripts/motion-perf-audit.mjs --json    # machine output
 *
 * Skill provenance: fixing-motion-performance + baseline-ui
 * (top-50 always-on floor).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Properties grouped by browser pipeline cost.
const COMPOSITOR = new Set(["transform", "opacity", "filter", "backdrop-filter"]);
const PAINT = new Set([
  "color", "background", "background-color", "background-image",
  "background-position", "background-size",
  "border-color", "border", "box-shadow", "text-shadow", "outline",
  "outline-color", "fill", "stroke", "stroke-dashoffset",
  "stroke-dasharray",
]);
const LAYOUT = new Set([
  "width", "height", "top", "right", "bottom", "left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font-size", "line-height", "letter-spacing",
  "display", "position", "flex", "grid",
]);

function classify(prop) {
  if (COMPOSITOR.has(prop)) return "compositor";
  if (PAINT.has(prop)) return "paint";
  if (LAYOUT.has(prop)) return "layout";
  return "unknown";
}

// Extract @keyframes blocks. Each block's body lives between the
// keyframe-name's opening { and the matching closing }.
function parseKeyframes(text) {
  const blocks = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    blocks.push({ name, body: text.slice(start, i - 1) });
  }
  return blocks;
}

function propsAnimated(body) {
  // Strip nested keyframe stops (e.g. "0%, 100% {" or "from {") and
  // find every "property: value" declaration regardless of whether
  // it's inline with the stop or on its own line. The regex matches
  // a CSS identifier followed by a colon, but only when preceded by
  // whitespace/{/; (so it doesn't match inside `value:`-shaped URLs
  // or pseudo-class selectors).
  const props = new Set();
  const re = /(?:^|[\s{;])([a-z][a-z-]*)\s*:/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const prop = m[1].toLowerCase();
    // Filter out keyframe-stop keywords that aren't real properties
    if (prop === "from" || prop === "to") continue;
    props.add(prop);
  }
  return [...props];
}

function pipelineFor(propsList) {
  const cats = new Set(propsList.map(classify));
  // Worst-case wins (layout > paint > compositor)
  if (cats.has("layout")) return "layout";
  if (cats.has("paint")) return "paint";
  if (cats.has("compositor")) return "compositor";
  return "unknown";
}

const blocks = parseKeyframes(css);
const findings = blocks.map((b) => {
  const props = propsAnimated(b.body);
  return {
    name: b.name,
    props,
    pipeline: pipelineFor(props),
    isMixed:
      props.some((p) => COMPOSITOR.has(p)) &&
      props.some((p) => PAINT.has(p) || LAYOUT.has(p)),
  };
});

const json = process.argv.includes("--json");
if (json) {
  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: findings.length,
    counts: {
      compositor: findings.filter((f) => f.pipeline === "compositor").length,
      paint: findings.filter((f) => f.pipeline === "paint").length,
      layout: findings.filter((f) => f.pipeline === "layout").length,
      mixed: findings.filter((f) => f.isMixed).length,
    },
    findings,
  }, null, 2));
  process.exit(0);
}

const groups = {
  layout: findings.filter((f) => f.pipeline === "layout"),
  paint: findings.filter((f) => f.pipeline === "paint"),
  compositor: findings.filter((f) => f.pipeline === "compositor"),
  unknown: findings.filter((f) => f.pipeline === "unknown"),
};

console.log(`Motion-perf audit · ${findings.length} keyframes scanned\n`);

if (groups.layout.length) {
  console.log(`✗ LAYOUT (slow · forces reflow on every frame) · ${groups.layout.length}`);
  for (const f of groups.layout) console.log(`  · ${f.name} → ${f.props.join(", ")}`);
  console.log("");
}

if (groups.paint.length) {
  console.log(`⚠ PAINT (medium · forces repaint each frame) · ${groups.paint.length}`);
  for (const f of groups.paint) {
    const tag = f.isMixed ? " [MIXED · conversion candidate]" : "";
    console.log(`  · ${f.name} → ${f.props.join(", ")}${tag}`);
  }
  console.log("");
}

console.log(`✓ COMPOSITOR (cheap · GPU-only) · ${groups.compositor.length}`);
for (const f of groups.compositor) console.log(`  · ${f.name} → ${f.props.join(", ")}`);
console.log("");

if (groups.unknown.length) {
  console.log(`? UNKNOWN (no recognized animated property) · ${groups.unknown.length}`);
  for (const f of groups.unknown) console.log(`  · ${f.name} → ${f.props.join(", ")}`);
  console.log("");
}

const cat = groups.layout.length + groups.paint.length;
const compositor = groups.compositor.length;
const ratio = (compositor / findings.length * 100).toFixed(1);
console.log(`Summary: ${compositor}/${findings.length} (${ratio}%) compositor-only · ${cat} need conversion`);

// Exit non-zero when there are layout-class keyframes — those should
// never ship. Paint-class is acceptable but flagged for backlog.
if (groups.layout.length > 0) process.exitCode = 1;
