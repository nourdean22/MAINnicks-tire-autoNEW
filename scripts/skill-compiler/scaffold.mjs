#!/usr/bin/env node
/**
 * source-to-skill scaffolder (NL-1, 2026-07-28).
 *
 * Deterministic half of the compiler: creates the package layout and
 * records provenance (source label, SHA-256, size, extraction date)
 * BEFORE any model-judgment work happens. The checksum is the anchor
 * that makes a re-compile from a changed source detectable forever.
 *
 * 2026-10-15: the package lands at .claude/skills/<slug>/, the only place Claude Code loads a
 * skill from (a package nested under generated/ passed the validator and could never be invoked),
 * and its template is written as SKILL.draft.md, never SKILL.md, so an unfinished package is not
 * a loadable skill (validate.mjs V8 fails while the draft exists). Flat slugs share a namespace
 * with every real skill, so a directory that exists and is not a compiler package (no
 * provenance/source.json) is REFUSED, and so is a slug still sitting under the old generated/
 * layout. Provenance is committed to a public repo: it carries a label, never a file path, and a
 * re-run on the same source leaves it alone (an explicit --source-label changes sourceLabel only).
 *
 * Usage: node scripts/skill-compiler/scaffold.mjs <source-file> <skill-slug> [--source-label <text>]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { parseArgs } from "node:util";

const USAGE = "usage: node scripts/skill-compiler/scaffold.mjs <source-file> <skill-slug> [--source-label <text>]";
let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { "source-label": { type: "string" } } });
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(2);
}
// A third positional is an unquoted multi-word label: refuse it rather than silently cut the label short.
const [sourceArg, slugArg, ...extra] = parsed.positionals;
if (!sourceArg || !slugArg || extra.length) {
  console.error(USAGE);
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slugArg)) {
  console.error(`slug "${slugArg}" must be kebab-case [a-z0-9-], 3-61 chars`);
  process.exit(2);
}

const sourcePath = resolve(sourceArg);
if (!existsSync(sourcePath)) {
  console.error(`source not found: ${sourcePath}`);
  process.exit(2);
}
const raw = readFileSync(sourcePath);
const sha256 = createHash("sha256").update(raw).digest("hex");

// A label may name the source but never say where it sat on disk (this repo is public), so any
// path-shaped token is refused wherever it sits: a drive path, ~/ or ~\, a backslash root (UNC
// included) or a / root. Tokens are cut at whitespace, quotes, brackets and , ; = so that
// "(/etc/passwd)" and "path=/x" are caught. A slash INSIDE a token (owner/repo) and a lone "/"
// stay legal.
const PATH_TOKEN = /^(?:[A-Za-z]:[\\/]|~[\\/]|\\.|\/.)/;
const hasPath = (text) => text.split(/[\s"'`()\[\]{}<>,;=]+/).some((token) => PATH_TOKEN.test(token));
const labelGiven = parsed.values["source-label"] !== undefined;
const sourceLabel = (parsed.values["source-label"] ?? basename(sourcePath)).trim();
if (!sourceLabel || hasPath(sourceLabel)) {
  console.error("--source-label must be a short label: not blank, and no file path in it (C:\\..., \\\\server, ~/..., /rooted)");
  process.exit(2);
}

const legacyPackage = join(resolve(".claude/skills/generated", slugArg), "provenance", "source.json");
if (existsSync(legacyPackage)) {
  console.error(
    `REFUSED: .claude/skills/generated/${slugArg} is a package from the old layout, which Claude Code never loads.\n` +
      `Migrate it to .claude/skills/${slugArg}/ or pick another slug.`,
  );
  process.exit(1);
}

const outDir = resolve(".claude/skills", slugArg);
const provPath = join(outDir, "provenance", "source.json");
const isPackage = existsSync(provPath);
if (existsSync(outDir) && !isPackage) {
  console.error(
    `REFUSED: .claude/skills/${slugArg} already exists and is not a compiler package (no provenance/source.json).\n` +
      `Scaffolding there would write into a skill that was not compiled from a source - use another slug.`,
  );
  process.exit(1);
}
if (isPackage) {
  const prior = JSON.parse(readFileSync(provPath, "utf8"));
  if (prior.sha256 !== sha256) {
    console.error(
      `REFUSED: ${slugArg} was compiled from a DIFFERENT source version (checksum mismatch).\n` +
        `  prior:   ${prior.sha256}\n  current: ${sha256}\n` +
        `Skills are immutable per source-version — use a new slug (e.g. ${slugArg}-v2).`,
    );
    process.exit(1);
  }
  // Same source: provenance is the record of the first compile and stays as it is. Only an explicit
  // --source-label may change anything, and then only sourceLabel (key order and every other byte kept).
  if (labelGiven && prior.sourceLabel !== sourceLabel) {
    writeFileSync(provPath, JSON.stringify({ ...prior, sourceLabel }, null, 2) + "\n");
    console.log("re-scaffold over same source version: updated sourceLabel only");
  } else {
    console.log("re-scaffold over same source version: kept existing provenance");
  }
}

for (const d of ["", "chapters", "provenance", "evals"]) {
  mkdirSync(join(outDir, d), { recursive: true });
}

const writeIfAbsent = (rel, content) => {
  const p = join(outDir, rel);
  if (existsSync(p)) return false;
  writeFileSync(p, content);
  return true;
};

if (!isPackage) {
  writeFileSync(
    provPath,
    JSON.stringify(
      {
        sourceFile: basename(sourcePath),
        sourceLabel,
        sha256,
        bytes: raw.length,
        extractedAt: new Date().toISOString(),
        license: "unknown",
        compiler: "source-to-skill v2",
      },
      null,
      2,
    ) + "\n",
  );
}

// SKILL.draft.md, not SKILL.md: Claude Code loads every .claude/skills/<name>/SKILL.md, so an unfinished
// package must not own that name (validate.mjs V8 fails until the draft is deleted). A package that
// already has its SKILL.md is finished and never gets the draft back.
if (!existsSync(join(outDir, "SKILL.md"))) {
  writeIfAbsent(
    "SKILL.draft.md",
    `---\nname: ${slugArg}\ndescription: COMPILED SKILL (draft) — replace with the one-line purpose + source name/date. Not usable until validate.mjs passes.\n---\n\n# ${slugArg}\n\nDRAFT — not a loadable skill (this file is SKILL.draft.md). Follow .claude/skills/source-to-skill/SKILL.md steps 2-8: write SKILL.md, then delete this file.\n`,
  );
}
writeIfAbsent("techniques.md", `# Techniques\n\n<!-- every entry: claim / source-section / quote-anchor / evidence-class / confidence -->\n`);
writeIfAbsent("anti-patterns.md", `# Anti-patterns\n\n<!-- what the source says NOT to do, same citation shape -->\n`);
writeIfAbsent("glossary.md", `# Glossary\n\n<!-- term · source definition · section id -->\n`);
writeIfAbsent("chapters/map.md", `# Section map\n\n<!-- id · title · location -->\n`);
writeIfAbsent("evals/questions.json", `[]\n`);

console.log(`scaffolded .claude/skills/${slugArg} (source sha256 ${sha256.slice(0, 12)}…)`);
console.log(`next: section map → claims → validate (see .claude/skills/source-to-skill/SKILL.md)`);
