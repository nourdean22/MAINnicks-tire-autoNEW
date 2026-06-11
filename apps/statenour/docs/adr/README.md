# Architecture Decision Records · NOUR OS

This directory captures the **why** behind major architectural choices in
`statenour-os` (bdnick.info). After 449 versions, the *what* is in code,
the *what changed* is in commits — but the *why* (alternatives weighed,
trade-offs accepted, constraints that forced the decision) was scattered
across ephemeral chats, memory files, and inline comments.

Backfilled starting v10.0.450 (2026-05-07). Each ADR captures a decision
that future-Nour and future-Claude sessions need to understand before
proposing changes.

## Format

Each ADR follows the template:

- **Status** · Accepted / Superseded / Deprecated
- **Context** · what problem prompted the decision
- **Decision** · what we did
- **Consequences** · positive + negative outcomes
- **Alternatives considered** · what was rejected and why
- **References** · file paths · version numbers · related ADRs

## Index

| # | Title | Status | Versions |
|---|---|---|---|
| 0001 | [AI provider chain · Venice → Ollama → OpenAI → Anthropic](./0001-ai-provider-chain.md) | Accepted | v8.x onward |
| 0002 | [CoALA + 3-lane recall · semantic / episodic / procedural](./0002-coala-three-lane-recall.md) | Accepted | v10.0.367 |
| 0003 | [v1 / v2 prompt builder split · shadow-mode parity](./0003-v1-v2-prompt-builder-split.md) | Accepted | v9.2 → v10.0.404 |
| 0004 | [withGuardian wrapper · 9 failure categories](./0004-withguardian-failure-categories.md) | Accepted | v10.0.357 |
| 0005 | [Anthropic ephemeral prompt cache · breakpoint placement](./0005-anthropic-ephemeral-cache.md) | Accepted | v10.0.362 → v10.0.446 |
| 0006 | [pgvector on Neon · Postgres-native vectors over managed DB](./0006-pgvector-on-neon.md) | Accepted | v8.x baseline |
| 0007 | [Skill semantic recall · top-50 floor + recall for 1,423 skills](./0007-skill-semantic-recall.md) | Accepted | v10.0.431-434 → v10.0.450 |
| 0008 | [8-category glitch taxonomy + 4-phase prevention](./0008-glitch-taxonomy-prevention.md) | Accepted | v10.0.333 |
| 0009 | [Multi-agent parallel sub-agents · pre-task fan-out + deep-research](./0009-multi-agent-parallel-subagents.md) | Accepted | v10.0.372-374 |
| 0010 | [Editorial-minimalist aesthetic + StandardPage primitive](./0010-editorial-minimalism-standardpage.md) | Accepted | v10.0.352 |
| 0011 | [Axis-specific regen gate · chat-vagueness 3-tier fix](./0011-axis-specific-regen-gate-chat-vagueness.md) | Accepted (Tier 1 shipped · Tier 2-3 sequenced) | v10.0.490 onward |
| 0012 | [Error-message sanitization layer · 500-response leak vectors](./0012-error-message-sanitization.md) | Accepted | v10.0.529.4 → .8 |
| 0013 | [Per-tool daily quota via BrainMemory · cost-DoS defense](./0013-per-tool-daily-quota.md) | Accepted | v10.0.529.4 → .8 |
| 0014 | [Tool-result data fencing · prompt-injection defense Phase 1](./0014-tool-result-data-fencing.md) | Accepted | v10.0.529.5 |
| 0015 | [Decision-replay coach pipeline · 30-day retrospective loop](./0015-decision-replay-coach.md) | Accepted | v10.0.528 → .529.7 |
| 0016 | [Merge Brain + Life + Ops into the Actions IA](./0016-merge-brain-life-ops-ia.md) | Accepted | v10.0.529.72 · Wave 18 |
| 0017 | [Task subtasks semantics · parentTaskId self-FK](./0017-task-subtasks-semantics.md) | Amended | 2026-05-23 |
| 0018 | [Multi-advisor board pattern](./0018-multi-advisor-board-pattern.md) | Accepted | 2026-05-23 |
| 0019 | [Explicit operator-state model](./0019-explicit-operator-state-model.md) | Accepted | 2026-05-23 |
| 0020 | [Closed-loop calibrated brain](./0020-closed-loop-calibrated-brain.md) | Accepted | 2026-05-23 |
| 0021 | [P-wave + Chrome extension](./0021-p-wave-and-extension.md) | Accepted | 2026-05-23 |
| 0022 | [Mastery Stage A + NickSidePane v2 chat](./0022-mastery-stage-a-and-side-pane-chat.md) | Accepted | 2026-05-26 |
| 0023 | [Recall-freshness + dead-lane sweep](./0023-recall-freshness-and-dead-lane-sweep.md) | Accepted | 2026-05-29 |
| 0024 | [Hidden High-Risk Warning & Execution Mode](./0024-hidden-high-risk-warning.md) | Accepted | 2026-06-11 |

## Adding a new ADR

1. Pick the next number in sequence
2. Write to `NNNN-kebab-case-title.md`
3. Use the format above (or copy from an existing ADR)
4. Update this README's index table
5. Commit alongside the code change that motivates the ADR — the ADR
   captures *why* the change happened; the code captures *what*

## When to write an ADR

Write an ADR when the decision:

- Could plausibly have gone another way (real alternatives existed)
- Will outlast a single feature push (architectural, not tactical)
- Future sessions need the context to avoid re-debating it
- Reverses or significantly modifies a previous ADR

Don't write an ADR for:

- Pure tactical fixes (those live in commit messages)
- Style/formatting choices
- Decisions where there was no real alternative

## Skill provenance

This backfill applies the **architecture-decision-records** skill from
the top-50 always-on floor (added to CLAUDE.md on 2026-05-07). The
operator's standing directive emphasizes "verify, check history, ask
questions — now and forever" — ADRs are how we make that history
queryable instead of buried in chat logs.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
