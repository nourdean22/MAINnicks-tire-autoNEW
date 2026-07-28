#!/usr/bin/env node
/**
 * source-to-skill validator (NL-1, 2026-07-28) — the gate that keeps
 * compiled skills from becoming polished hallucination factories.
 *
 * Checks (all must pass):
 *   V1  layout complete (SKILL.md, techniques, anti-patterns, glossary,
 *       chapters/map.md, provenance/source.json, evals/questions.json)
 *   V2  provenance has sha256 (64 hex), extractedAt, license field
 *   V3  chapters/map.md declares at least one section id
 *   V4  every technique entry carries: claim, source-section (declared
 *       in the map), quote-anchor (<=15 words), evidence-class (enum),
 *       confidence (enum)
 *   V5  at least 3 techniques, at least 1 anti-pattern entry
 *   V6  evals/questions.json: >=5 entries, each {q, expected,
 *       sourceSection (declared), kind recall|application}
 *   V7  SKILL.md no longer carries the draft marker
 *
 * Usage:  node scripts/skill-compiler/validate.mjs <skill-dir>
 *         node scripts/skill-compiler/validate.mjs --self-test
 */
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EVIDENCE = new Set(["author_asserted", "author_evidenced", "derived_inference"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const KINDS = new Set(["recall", "application"]);

export function validateSkillDir(dir) {
  const errors = [];
  const need = [
    "SKILL.md",
    "techniques.md",
    "anti-patterns.md",
    "glossary.md",
    join("chapters", "map.md"),
    join("provenance", "source.json"),
    join("evals", "questions.json"),
  ];
  for (const rel of need) {
    if (!existsSync(join(dir, rel))) errors.push(`V1 missing ${rel}`);
  }
  if (errors.length) return { ok: false, errors };

  const read = (rel) => readFileSync(join(dir, rel), "utf8");

  // V2 provenance
  let prov;
  try {
    prov = JSON.parse(read(join("provenance", "source.json")));
  } catch {
    return { ok: false, errors: ["V2 provenance/source.json is not valid JSON"] };
  }
  if (!/^[a-f0-9]{64}$/.test(prov.sha256 ?? "")) errors.push("V2 provenance.sha256 missing/invalid");
  if (!prov.extractedAt) errors.push("V2 provenance.extractedAt missing");
  if (!("license" in prov)) errors.push("V2 provenance.license missing ('unknown' is allowed - absence is not)");

  // V3 section map — id · title · location
  const mapText = read(join("chapters", "map.md"));
  const sectionIds = new Set(
    [...mapText.matchAll(/^[-*]?\s*`?([a-z0-9][a-z0-9._-]*)`?\s*·/gim)].map((m) => m[1].toLowerCase()),
  );
  if (sectionIds.size === 0) errors.push("V3 chapters/map.md declares no section ids (format: id · title · location)");

  // V4/V5 techniques
  const techText = read("techniques.md");
  const entries = techText.split(/^## /m).slice(1);
  let validTechniques = 0;
  for (const e of entries) {
    const name = e.split("\n")[0].trim();
    const field = (k) => (e.match(new RegExp(`^\\s*-\\s*${k}:\\s*(.+)$`, "m")) ?? [])[1]?.trim();
    const claim = field("claim");
    const section = field("source-section")?.toLowerCase().replace(/`/g, "");
    const anchor = field("quote-anchor");
    const evidence = field("evidence-class");
    const confidence = field("confidence");
    const eErr = [];
    if (!claim) eErr.push("claim");
    if (!section) eErr.push("source-section");
    else if (sectionIds.size > 0 && !sectionIds.has(section)) eErr.push(`source-section '${section}' not in map`);
    if (!anchor) eErr.push("quote-anchor");
    else if (anchor.replace(/"/g, "").trim().split(/\s+/).length > 15) eErr.push("quote-anchor >15 words");
    if (!evidence || !EVIDENCE.has(evidence)) eErr.push("evidence-class");
    if (!confidence || !CONFIDENCE.has(confidence)) eErr.push("confidence");
    if (eErr.length) errors.push(`V4 technique "${name}": ${eErr.join(", ")}`);
    else validTechniques++;
  }
  if (validTechniques < 3) errors.push(`V5 needs >=3 valid techniques (have ${validTechniques})`);
  const antiEntries = read("anti-patterns.md").split(/^## /m).slice(1).length;
  if (antiEntries < 1) errors.push("V5 needs >=1 anti-pattern entry");

  // V6 evals
  let evals;
  try {
    evals = JSON.parse(read(join("evals", "questions.json")));
  } catch {
    evals = null;
  }
  if (!Array.isArray(evals)) errors.push("V6 evals/questions.json is not a JSON array");
  else {
    if (evals.length < 5) errors.push(`V6 needs >=5 eval questions (have ${evals.length})`);
    evals.forEach((q, i) => {
      const bad = [];
      if (!q?.q) bad.push("q");
      if (!q?.expected) bad.push("expected");
      const qs = String(q?.sourceSection ?? "").toLowerCase();
      if (!qs) bad.push("sourceSection");
      else if (sectionIds.size > 0 && !sectionIds.has(qs)) bad.push(`sourceSection '${qs}' not in map`);
      if (!KINDS.has(q?.kind)) bad.push("kind");
      if (bad.length) errors.push(`V6 eval[${i}]: ${bad.join(", ")}`);
    });
  }

  // V7 no draft marker
  if (/COMPILED SKILL \(draft\)|^DRAFT\b/m.test(read("SKILL.md"))) {
    errors.push("V7 SKILL.md still carries the draft marker - finish steps 2-8");
  }

  return { ok: errors.length === 0, errors };
}

const NL = "\n";

function selfTest() {
  const base = mkdtempSync(join(tmpdir(), "skillval-"));
  const dir = join(base, "demo");
  for (const d of ["chapters", "provenance", "evals"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (rel, c) => writeFileSync(join(dir, rel), c);

  const goodTech = (n, sec) =>
    [
      `## ${n}`,
      `- claim: rule ${n}`,
      `- source-section: ${sec}`,
      `- quote-anchor: "short verbatim anchor"`,
      `- evidence-class: author_evidenced`,
      `- confidence: high`,
      "",
      "",
    ].join(NL);
  const threeGood = "# Techniques" + NL + NL + goodTech("one", "ch1") + goodTech("two", "ch1") + goodTech("three", "ch2");
  const fiveEvals = JSON.stringify(
    Array.from({ length: 5 }, (_, i) => ({
      q: `q${i}`,
      expected: `a${i}`,
      sourceSection: "ch1",
      kind: i % 2 ? "recall" : "application",
    })),
  );

  w("SKILL.md", ["---", "name: demo", "description: demo compiled skill for validator self-test.", "---", "# demo", "Use the thing.", ""].join(NL));
  w(join("chapters", "map.md"), ["# Section map", "- ch1 · The Core Idea · pp. 1-20", "- ch2 · Applications · pp. 21-50", ""].join(NL));
  w(join("provenance", "source.json"), JSON.stringify({ sha256: "a".repeat(64), extractedAt: "2026-07-28T00:00:00Z", license: "unknown" }));
  w("glossary.md", ["# Glossary", "- leverage · the core term · ch1", ""].join(NL));
  w(
    "anti-patterns.md",
    [
      "# Anti-patterns",
      "",
      "## Doing it backwards",
      "- claim: never start with tactics",
      "- source-section: ch2",
      `- quote-anchor: "tactics without position fail"`,
      "- evidence-class: author_asserted",
      "- confidence: medium",
      "",
    ].join(NL),
  );
  w("techniques.md", threeGood);
  w(join("evals", "questions.json"), fiveEvals);

  const pass = validateSkillDir(dir);
  if (!pass.ok) {
    console.error("SELF-TEST FAIL (expected pass):", pass.errors);
    process.exit(1);
  }

  const ghostTech = ["# T", "", "## ghost", "- claim: unanchored wisdom", "- evidence-class: author_asserted", "- confidence: high", ""].join(NL);
  const unknownSection = "# T" + NL + NL + goodTech("one", "ch1") + goodTech("two", "ch1") + goodTech("three", "ch9");
  const longAnchor =
    "# T" + NL + NL + goodTech("one", "ch1") + goodTech("two", "ch1") +
    [
      "## three",
      "- claim: x",
      "- source-section: ch1",
      `- quote-anchor: "${"word ".repeat(16).trim()}"`,
      "- evidence-class: author_asserted",
      "- confidence: low",
      "",
    ].join(NL);

  const cases = [
    ["uncited technique", () => w("techniques.md", ghostTech)],
    ["section not in map", () => w("techniques.md", unknownSection)],
    ["long anchor", () => w("techniques.md", longAnchor)],
    ["too few evals", () => { w("techniques.md", threeGood); w(join("evals", "questions.json"), "[]"); }],
    ["bad checksum", () => { w(join("evals", "questions.json"), fiveEvals); w(join("provenance", "source.json"), JSON.stringify({ sha256: "nope", extractedAt: "x", license: "unknown" })); }],
  ];
  for (const [label, breakIt] of cases) {
    breakIt();
    const r = validateSkillDir(dir);
    if (r.ok) {
      console.error(`SELF-TEST FAIL: "${label}" was NOT caught`);
      process.exit(1);
    }
  }
  rmSync(base, { recursive: true, force: true });
  console.log("self-test: 1 valid package passes · 5 defect classes caught · OK");
}

const arg = process.argv[2];
if (arg === "--self-test") {
  selfTest();
} else if (arg) {
  const r = validateSkillDir(arg);
  if (r.ok) {
    console.log(`VALID: ${arg}`);
  } else {
    console.error(`INVALID: ${arg}`);
    for (const e of r.errors) console.error(`  · ${e}`);
    process.exit(1);
  }
} else {
  console.error("usage: node scripts/skill-compiler/validate.mjs <skill-dir> | --self-test");
  process.exit(2);
}
