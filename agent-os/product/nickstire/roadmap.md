# Product Roadmap — Nick's Tire & Auto

**This file is a pointer, deliberately.** The canonical roadmap is
[`apps/nickstire/docs/REVENUE-OPS-ROADMAP.md`](../../../apps/nickstire/docs/REVENUE-OPS-ROADMAP.md)
— dependency-ordered, with revenue impact and risk stated per wave. It is maintained alongside the
app it describes. A copy here would be a second roadmap that silently drifts from the first, which
is the failure mode this repo has already paid for once (see
[`docs/agent-os/README.md`](../../../docs/agent-os/README.md) → Known gaps).

## Shape of the plan

| Wave | Outcome |
|---|---|
| 1 | Data truth — stop blending observed activity, inference and verified business results |
| 2 | Reliability and operational ownership — structured run receipts, actionable alerts only |
| 3 | Attribution foundation — verified attributed revenue reported apart from modeled value |
| 4 | Recovery workflow — missed opportunities in one durable, consent-aware queue |

Read the canonical file for the full wave list and the per-wave dependencies.

## Before adding anything to this plan

The dominant failure mode in this repo is **proposing work that already exists**. Multiple
plans have been gated on exactly that, several in a single day. Before writing a new roadmap item:

1. Check [`apps/nickstire/docs/CURRENT-TRUTH.md`](../../../apps/nickstire/docs/CURRENT-TRUTH.md)
   — it separates automated, operator-gated, experimental and retired systems.
2. Check [`apps/nickstire/docs/ISSUE-REGISTRY.md`](../../../apps/nickstire/docs/ISSUE-REGISTRY.md).
3. Confirm against production, not against docs — `AGENTS.md` ranks production evidence above
   every file in this repo, including this one.

## Known stale doc

[`docs/00-current-truth/active-roadmap.md`](../../../docs/00-current-truth/active-roadmap.md) sits
in the current-truth folder but was last meaningfully updated in June 2026: it lists the Instagram
pipeline as "In Progress" (it has shipped and is judge-gated) and names the Higgsfield clip
generator (retired in favour of Veo). Treat it as historical until it is reconciled — flagged
2026-08-10, not fixed here to keep this change scoped.
