# Product Mission — Nick's Tire & Auto (`apps/nickstire`)

A real shop in Euclid, Ohio, serving the Cleveland east side. Everything here has a customer on the
other end of it, which is why customer-facing side effects are operator-gated in
[`AGENTS.md`](../../../AGENTS.md) → Protected operations.

## Problem

An independent full-service shop competes for local demand against chains with marketing
departments, and loses work in the gaps rather than at the counter: a call that rings out after
hours, a quote that never gets followed up, a customer who would have left a review but was never
asked, a search result that never surfaced. The shop cannot see which of these it is losing, so it
cannot fix the biggest one first. The owner's time is the scarcest input, and most of these gaps
are only closable by spending it.

## Target users

Two distinct users, and conflating them produces bad features:

1. **Customers** — Cleveland-area drivers who need work done and are choosing where to take the
   car. They arrive by search, by phone, by referral or by driving past. They want a straight
   answer on price and timing, and they judge the shop on trust signals long before service.
2. **The operator** — one person running the shop. Uses the `/admin` console on a phone, mid-task,
   usually while something else is demanding attention. Needs the honest number and the next
   action, not a dashboard to interpret.

## Solution

Close the gaps with systems that run whether or not the operator is at a desk — an AI receptionist
that answers and improves from its own failed calls, durable SMS with human takeover, deferred
social publishing behind a quality judge, and local-search work that compounds.

What makes it work is not the automation but the **discipline around it**:

- **Full-service positioning, never a hero category.** The shop is not "the tire place." Narrowing
  the public framing to one service suppresses the rest of the work it actually does and can do.
- **Verified beats inferred, and the difference is always shown.** Tool engagement, a persisted
  lead, an arrival and a paid invoice are four different facts. Metrics that blend them produce
  confident, wrong decisions — the failure the revenue-ops roadmap's first wave exists to end.
- **Customer-facing actions are never taken on agent initiative.** Sends, publishes, replies and
  charges wait for an explicit instruction, every time. An automation that embarrasses the shop
  costs more than the work it saved.
- **Unavailable data is empty, never mocked.** A fabricated number in an owner-facing brief is
  worse than a blank one, because it gets acted on.

## Roadmap

Dependency-ordered and business-outcome-first:
[`apps/nickstire/docs/REVENUE-OPS-ROADMAP.md`](../../../apps/nickstire/docs/REVENUE-OPS-ROADMAP.md).
See [`roadmap.md`](roadmap.md) for why it is not restated here.
