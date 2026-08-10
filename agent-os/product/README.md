# Agent OS — Product layer

`agent-os/standards/` answers *how we build here*. This folder answers *what we are building and
why*. `/shape-spec` reads both before planning significant work.

**NOURCITY holds two unrelated products plus shared infrastructure**, so this layer is split per
app rather than flattened into one mission. A single mission statement covering a tire shop and a
private personal OS would be true of neither.

| Path | Product | Deploys to |
|---|---|---|
| [`nickstire/`](nickstire/) | Nick's Tire & Auto — a real business with customers and revenue | nickstire.org |
| [`statenour/`](statenour/) | NOUR OS — a private, single-operator system | bdnick.info |
| [`tech-stack.md`](tech-stack.md) | Shared stack + per-app deltas | — |

`apps/worker` has no product mission of its own: it is dispatch infrastructure for statenour and
owns no user-facing outcome. See [`apps/worker/AGENTS.md`](../../apps/worker/AGENTS.md).

## The one rule for this folder

**Roadmaps here POINT at the canonical roadmap; they do not restate it.** Nick's Tire already has
a dependency-ordered roadmap at
[`apps/nickstire/docs/REVENUE-OPS-ROADMAP.md`](../../apps/nickstire/docs/REVENUE-OPS-ROADMAP.md).
Copying it here would create a second roadmap that drifts from the first — the same failure that
put the Antigravity adapter at 885 contradictory lines (see
[`docs/agent-os/README.md`](../../docs/agent-os/README.md) → Known gaps). Mission files carry new
content because nothing else in the repo states the mission. Roadmap files are pointers.

Ranked below these in a conflict: everything here sits at tier 5 of the source-of-truth hierarchy
in [`AGENTS.md`](../../AGENTS.md). Production evidence still wins.
