# ADR-0007 · Skill semantic recall · top-50 floor + recall layer for 1,423 skills

**Status:** Accepted
**Date adopted:** v10.0.431-434 (recall layer) → v10.0.450 (CLAUDE.md
floor expanded from 9 → top-50 with named skills)
**Backfilled:** 2026-05-07 (v10.0.454)

## Context

The operator has 1,423 Claude skills installed across multiple
sources (`~\.claude\skills\` · `~\.claude\plugins\marketplaces\` ·
`~\.claude\plugins\cache\claude-plugins-official`). Each skill is a
markdown file describing a specialty (security audit, voice agents,
postgres optimization, fp-ts patterns, etc.) that can shape the
assistant's reasoning when the task matches.

Two failure modes existed before the recall layer:

1. **Skills the assistant didn't know about silently no-op.** If
   the operator hadn't manually invoked a skill in chat or via a
   slash command, the assistant defaulted to general-purpose
   reasoning even when a domain-specific skill applied. The
   operator's complaint: "I have 1,400 of these and I'm only
   getting value from the 9 I remember to invoke."
2. **Literal load is impossible.** Loading all 1,423 skills into
   the system prompt would exceed any sane context window (each
   skill is hundreds-thousands of tokens · totaling ~280K+ tokens).
   The 9-skill always-on bundle was the inverse failure: too few
   to cover the operator's actual workload diversity.

A middle path was needed: every skill *available* on every task,
without literal-loading the entire library.

## Decision

**Three-layer skill access model:**

1. **Always-on floor** (top 50 · in CLAUDE.md global instructions).
   Curated from the 1,423 skill registry by signal-keyword density,
   stack alignment, and validated leverage. Every session starts
   with these as a baseline operating stance. Organized in 9 layers
   (meta-stances · reasoning lenses · engineering discipline ·
   frontend craft · data + DB · AI + agents · infra + DevOps ·
   quality + audit · execution helpers + specialized).

2. **Semantic recall layer** (`lib/skills/skill-recall.ts` +
   `data/skills-registry.json`). All registry skills are indexed with
   English-translated summaries + 1024-dim embeddings (Cohere
   embed-v4.0; an earlier revision of this ADR said 1536 — wrong). On
   each task, the user query embeds and runs cosine against the
   registry; top-K relevant skills (typically K=3) auto-inject as
   short summaries into the system prompt prefix. Average overhead:
   ~200ms per turn (parallel with the brain recall fan-out).

   > **STATUS UPDATE (2026-07-09): Layer 2 auto-injection is DEAD in
   > code.** Its only call site was removed in the Prompt V2 cutover
   > (PR #432, commit 54635bcec, 2026-06-29) — `getRelevantSkillsBlock`
   > in `lib/skills/skill-context.ts` has zero importers and the
   > `skill.recall.injected` metric can never fire, so the quarterly
   > re-curation loop below has no data. Skill discovery currently
   > depends entirely on Layer 3 tool calls (which chat-mode keyword
   > pruning may remove from a turn's tool set). Re-wiring is planned
   > as ANTIGRAVITY_MASTER_PLAN AG-17.

3. **`searchSkills` tool** in chat. Operator can explicitly invoke
   a skill lookup ("what skills help with Stripe webhook
   debugging?") and get a ranked list back as a tool result. This
   handles the case where the recall layer's automatic top-3
   misses something the operator knows applies.

The CLAUDE.md SKILL DISCOVERY POLICY (added 2026-05-07) makes the
4-step protocol mandatory before every non-trivial task:

  1. Identify the task in 1 sentence.
  2. Consult the library (recall or reasoned match).
  3. State out loud which skills apply + why.
  4. Invoke less-common skills explicitly when they'd change the
     approach.

## Consequences

**Positive:**

- Every task gets domain-aware reasoning. The v10.0.442 SortDropdown
  UX upgrade was driven by ux-audit (Nielsen heuristics) +
  mobile-design (44px) skills surfaced via this recall layer — both
  were "deeper than top-50" picks the recall fetched on demand.
- Floor + recall is composable. Adding a skill to the registry is
  one file edit; promotion to the floor (if it earns it) is a
  curation update to CLAUDE.md.
- Token cost stays bounded. The auto-inject summary per recalled
  skill is ~150 tokens. Top-3 = ~450 tokens of skill context per
  turn, well within the budget that the prompt audit (v10.0.444)
  established.
- Anti-slop guardrail. The "never reach for general-purpose
  thinking when a domain-specific skill applies" rule in CLAUDE.md
  is the explicit anti-pattern the recall layer prevents.

**Negative:**

- Recall quality depends on the embedded summaries. Some skills
  have weak descriptions (one-line stub summaries that don't
  surface their actual capability). Mitigated by the v10.0.x
  translate-skills.ts pipeline that generates English summaries
  for non-English skills; not yet generalized to "rewrite weak
  summaries" for skills whose author description was thin.
- Silent miss risk. If the embedding doesn't match the user's
  intent vocabulary (e.g., user says "make this faster" but the
  relevant skill description says "reduce latency"), the skill
  doesn't surface. Mitigated by the explicit invocation path
  (searchSkills tool) but not eliminated.
- The top-50 floor is curated by judgment, not by usage data. We
  don't yet log which skills are most-cited in successful turns.
  A data-driven re-curation could improve the floor over time.

## Alternatives considered

- **Literal load all 1,423 into the system prompt.** Rejected on
  context budget (~280K tokens of skills alone would leave nothing
  for actual context).
- **Lazy load on slash-command only** (operator invokes skills via
  `/skill-name`). Rejected on ergonomics — the operator can't
  remember 1,423 names. The whole point is auto-discovery.
- **Single fixed bundle of 9 skills only** (the pre-v10.0.450
  state). Rejected on coverage — diverse workload diversity beats
  a frozen set.
- **External tool that LLMs call to "search skills"** (no auto-
  inject, only manual). Rejected on cognitive load — the assistant
  has to remember to call the tool. The auto-inject pattern is
  always-on without operator burden.

## References

- `data/skills-registry.json` (520KB · 1,423 skills indexed with
  summaries + embeddings)
- `lib/skills/skill-recall.ts` — semantic search + cosine retrieval
- `lib/skills/skill-context.ts` — auto-injection into system prompt
- `~\.claude\CLAUDE.md` — SKILL DISCOVERY POLICY + top-50 floor
  (lines added 2026-05-07)
- `scripts/translate-skills.ts` — English-summary generation for
  non-English skill descriptions
- `scripts/find-skills-for-sort-filter.ts` — example of explicit
  recall invocation (drove v10.0.442 ux-audit + mobile-design picks)
- v10.0.431-434 commits · recall layer introduction
- v10.0.442 commit · first skill-driven UX work
- v10.0.450 commit · top-50 floor expansion in CLAUDE.md
- ADR-0006 · pgvector (the embedding infrastructure that makes
  this practical at zero added vendor cost)

## Open items

- Log which skills are recalled most often + which surface in
  successful judge-eval'd turns. Use that data for a quarterly
  top-50 re-curation pass.
- Generalize the translate-skills pipeline to "auto-rewrite weak
  summaries" not just "translate non-English." Improves recall
  quality on the long tail.
- Consider letting the operator pin specific skills to the top-50
  floor based on usage ("this skill helped on the last 3 tasks ·
  promote it to always-on?"). Adaptive floor.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
