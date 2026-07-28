---
name: source-to-skill
description: Compile a source (book text, transcript, doc, repo file) into a provenance-carrying skill package on CGD rails — claims cite sections, confidence is explicit, eval questions ship with the skill. Use when the operator says "turn this into a skill" / "compile this book/video/doc".
---

# Source-to-Skill Compiler

Turn a source document into a skill package the recall layer can trust.
The difference between this and "summarize the book into instructions" is
**provenance**: every technique the skill asserts must point at the exact
section that supports it, carry an evidence class, and ship with eval
questions — otherwise the output is a polished hallucination factory
(the failure mode the clarity-gate skill exists to prevent).

## Pipeline (follow in order)

1. **Scaffold** — run the deterministic scaffolder first; never hand-create
   the layout:

   ```bash
   node scripts/skill-compiler/scaffold.mjs <source-file> <skill-slug>
   ```

   It creates `.claude/skills/generated/<skill-slug>/` with the template,
   computes the source SHA-256, and records extraction date + source path
   in `provenance/source.json`. The checksum is the anti-drift anchor: a
   re-compile from a CHANGED source must produce a new checksum, never a
   silent overwrite.

2. **Section map** — read the source and write `chapters/map.md`: one line
   per section (`id · title · first/last line or page`). Every later
   citation uses these ids. A source too unstructured to map gets ONE
   section id (`whole`) — say so, don't invent structure.

3. **Extract claims** into `techniques.md`. Each entry MUST carry:

   ```markdown
   ## <technique name>
   - claim: <one sentence, the operator-usable rule>
   - source-section: <id from chapters/map.md>
   - quote-anchor: "<≤15 words verbatim from the source>"
   - evidence-class: author_asserted | author_evidenced | derived_inference
   - confidence: high | medium | low
   ```

   Rules:
   - `author_evidenced` ONLY when the source itself shows data/cases.
   - `derived_inference` = YOUR synthesis — mark it, never launder it
     into the author's voice.
   - No claim without a section id. If you can't find where it came
     from, it doesn't go in.

4. **Anti-patterns** (`anti-patterns.md`) — what the source says NOT to
   do, same citation shape. Skills without failure modes overfit.

5. **Glossary** (`glossary.md`) — terms the skill uses that the model
   might collide with existing vocabulary; each with the source's
   definition and section id.

6. **Write SKILL.md** — the operational distillation (when to use,
   the method, red flags), in the house skill voice. It may only assert
   what `techniques.md` supports; the frontmatter `description` states
   the source and its date.

7. **Eval questions** (`evals/questions.json`) — minimum 5:

   ```json
   [{ "q": "...", "expected": "...", "sourceSection": "...", "kind": "recall|application" }]
   ```

   These feed the statenour recall-eval corpus (lib/brain/recall-eval.ts)
   — the skill becomes measurable, not just installed.

8. **Validate** — the gate, not optional:

   ```bash
   node scripts/skill-compiler/validate.mjs .claude/skills/generated/<skill-slug>
   ```

   Zero errors required. The validator checks structure, provenance
   completeness (every technique has section + evidence-class +
   confidence), checksum integrity, and eval-question minimums. Fix and
   re-run; never hand-wave a red validator.

9. **License/rights** — record in `provenance/source.json` what the
   source's usage terms are (`license` field; `"unknown"` is allowed and
   honest). Compiled skills from copyrighted books stay PRIVATE to this
   repo and quote ≤15 words per anchor — anchors are locators, not
   reproductions.

## Red flags — stop and re-check

- A technique you "remember" from the source but can't find a section
  for → it's a `derived_inference` or it's out.
- Confidence "high" on `author_asserted` claims with no evidence shown
  → medium at best.
- The skill reads smoother than the source → you're writing fiction;
  re-anchor.
- Compiling a second source into the same slug → new slug; skills are
  immutable per source-version (checksum enforces this).
