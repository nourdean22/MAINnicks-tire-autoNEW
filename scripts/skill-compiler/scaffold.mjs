#!/usr/bin/env node
/**
 * source-to-skill scaffolder (NL-1, 2026-07-28).
 *
 * Deterministic half of the compiler: creates the package layout and
 * records provenance (source path, SHA-256, size, extraction date)
 * BEFORE any model-judgment work happens. The checksum is the anchor
 * that makes a re-compile from a changed source detectable forever.
 *
 * Usage: node scripts/skill-compiler/scaffold.mjs <source-file> <skill-slug>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const [, , sourceArg, slugArg] = process.argv;
if (!sourceArg || !slugArg) {
  console.error("usage: node scripts/skill-compiler/scaffold.mjs <source-file> <skill-slug>");
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

const outDir = resolve(".claude/skills/generated", slugArg);
if (existsSync(join(outDir, "provenance", "source.json"))) {
  const prior = JSON.parse(readFileSync(join(outDir, "provenance", "source.json"), "utf8"));
  if (prior.sha256 !== sha256) {
    console.error(
      `REFUSED: ${slugArg} was compiled from a DIFFERENT source version (checksum mismatch).\n` +
        `  prior:   ${prior.sha256}\n  current: ${sha256}\n` +
        `Skills are immutable per source-version — use a new slug (e.g. ${slugArg}-v2).`,
    );
    process.exit(1);
  }
  console.log(`re-scaffold over same source version — existing files preserved`);
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

writeFileSync(
  join(outDir, "provenance", "source.json"),
  JSON.stringify(
    {
      sourceFile: basename(sourcePath),
      sourcePathAtCompile: sourcePath,
      sha256,
      bytes: raw.length,
      extractedAt: new Date().toISOString(),
      license: "unknown",
      compiler: "source-to-skill v1",
    },
    null,
    2,
  ) + "\n",
);

writeIfAbsent(
  "SKILL.md",
  `---\nname: ${slugArg}\ndescription: COMPILED SKILL (draft) — replace with the one-line purpose + source name/date. Not usable until validate.mjs passes.\n---\n\n# ${slugArg}\n\nDRAFT — follow .claude/skills/source-to-skill/SKILL.md steps 2-8.\n`,
);
writeIfAbsent("techniques.md", `# Techniques\n\n<!-- every entry: claim / source-section / quote-anchor / evidence-class / confidence -->\n`);
writeIfAbsent("anti-patterns.md", `# Anti-patterns\n\n<!-- what the source says NOT to do, same citation shape -->\n`);
writeIfAbsent("glossary.md", `# Glossary\n\n<!-- term · source definition · section id -->\n`);
writeIfAbsent("chapters/map.md", `# Section map\n\n<!-- id · title · location -->\n`);
writeIfAbsent("evals/questions.json", `[]\n`);

console.log(`scaffolded .claude/skills/generated/${slugArg} (source sha256 ${sha256.slice(0, 12)}…)`);
console.log(`next: section map → claims → validate (see .claude/skills/source-to-skill/SKILL.md)`);
