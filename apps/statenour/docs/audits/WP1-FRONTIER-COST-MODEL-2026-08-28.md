# WP1 · Frontier routing — cost model and the decision it needs

> ## DECIDED 2026-08-28: **(c) STAY ON OLLAMA.** WP1 is CLOSED, not deferred.
>
> The operator's instruction, verbatim: *"no dont switch from ollama."*
>
> Sequence, recorded honestly because it reversed mid-flight: the operator first chose **(a)
> all-frontier**, then reversed before any code was written. Implementation had reached the design
> boundary only — the lane resolver was specified but never authored — so **there was nothing to
> revert.** No key provisioned, no Railway variable added, no metered lane opened, no line of
> routing code merged.
>
> **What stays true:** `routeCapability()` remains SHADOW with 0 live call sites.
> `allowMetered` stays `false` for chat turns (`app/api/ai/chat/route.ts:352`) — the cost firewall
> is intact and deliberate. The chat lane is Ollama Cloud (`minimax-m3` in production).
>
> **Interpretation, stated so it can be corrected:** this was read as cancelling the lane switch
> *entirely*, not merely keeping Ollama primary with frontier escalation for hard turns. A spend
> commitment is the one place to take the cautious reading — register item #6 ("spending the
> operator's money on your own judgment") exists for exactly this. If escalation-for-hard-turns was
> the intent, that is a different build and needs its own go.
>
> **What survives and is worth keeping:** the measurement below is still the honest cost of the
> option, and the finding that the chat lane sits behind FIVE silent gates is unchanged and still
> a defect in its own right. The numbers do not expire just because the answer was "no" — if the
> question is reopened, re-verify volume and pricing rather than trusting this snapshot.

**Original status when written: DECISION REQUIRED. No code shipped, no key provisioned, no paid
lane flipped.**

The capability router (`lib/ai/vnext/effort-policy.ts`) is built, tested, and dark. Wiring it is
a ~half-day change. The reason it is not wired is not engineering — it is that nobody has decided
to spend money. This document exists to put that decision in front of the operator with real
numbers, and then stop.

---

## 1 · Verified state (Phase 0, 2026-08-28)

| Fact | Probe | Observed |
|---|---|---|
| No Anthropic key anywhere | grep 3 env files · `railway variables --service statenour-web` | 0 hits local, 0 in Railway |
| Router is unwired | `git grep "routeCapability(" -- '*.ts' '*.tsx'` minus tests | **0 live call sites** |
| Canary env unset | Railway grep | `NICK_CANARY_DEEP_ANTHROPIC` absent |
| Live default lane | `railway variables` | Ollama Cloud, **`OLLAMA_MODEL=minimax-m3`** |

Note the last row: the build order said `gpt-oss:120b`. That is the stale local `.env`; the root
`.env` says `glm-5.1`; **production says `minimax-m3`**. Three files, three answers — only the
Railway value is real. Status-quo cost below is priced against production.

**WP1 does not collapse to a config change.** The `routeCapability` function has zero live callers.
Two *other* exports of the same module (`claude5EffortForAttempt`, `canaryDeepForce`) are imported
by the chat route, which is why a naive "is the module imported" grep misleads.

---

## 2 · Measured volume and shape

All from production, 30-day window ending 2026-08-28.

| Metric | Value | Query |
|---|---|---|
| Assistant chat turns | **626 / 30d = 20.9/day** | `chat_messages` where `role='assistant'` |
| Avg input tokens | **24,225** | `ai_generations.prompt_tokens` |
| p50 / p90 input | 16,804 / 22,674 | same |
| Avg output tokens | **676** | `ai_generations.output_tokens` |
| Recorded marginal spend | **$1.05 / 30d** | `sum(cost_cents)` |

**Base rate, stated:** the token figures come from **114 of 1,041** `ai_generations` rows that
carry a non-null `prompt_tokens` — **11.0% coverage**. The instrumented subset is lane-biased
(providers that report usage are over-represented). Treat the token averages as the best available
estimate, not a census. The turn count (626) is a full count and carries no such caveat.

---

## 3 · Pricing source

Fetched **2026-08-28** from
`https://platform.claude.com/docs/en/about-claude/pricing` (per-MTok, USD):

| Model | Input | Output | Cache read |
|---|---|---|---|
| Claude Fable 5 | $10 | $50 | $1.00 |
| Claude Opus 5 | $5 | $25 | $0.50 |
| Claude Sonnet 5 | $2 | $10 | $0.20 |
| Claude Haiku 4.5 | $1 | $5 | $0.10 |

Cache reads are **0.1×** base input. This matters more than any other line in this document — see §5.

---

## 4 · The three scenarios

Computed on 626 turns × 24,225 in / 676 out = 15.165 MTok in, 0.423 MTok out per month.

| Scenario | No caching | With 70% cache hits |
|---|---|---|
| **(a) Every turn frontier — Fable 5** | $172.81/mo | **$77.27/mo** |
| **(a′) Every turn Opus 5** | $86.40/mo | **$38.63/mo** |
| **(b) Tiered — 70% Sonnet 5 / 20% Opus 5 / 10% Fable 5** | $58.75/mo | **$26.27/mo** |
| **(c) Status quo — Ollama Cloud flat subscription** | — | **~$1.05/mo marginal** |

At the realistic caching assumption, an all-frontier chat lane costs about **$0.12 per turn**.

The tiered split (70/20/10) is an assumption, not a measurement — no band classifier exists yet to
measure against. It is the shape the router was designed for and is offered as an illustration of
the ratio, not a forecast.

---

## 5 · The two things that most change these numbers

1. **Prompt caching is the dominant lever, and the existing code already protects it.** Input
   dwarfs output here (15.165 MTok vs 0.423 MTok — a 36:1 ratio), so the cache-hit rate almost
   entirely determines the bill. The router pins effort per conversation *specifically* to keep the
   Anthropic cache prefix stable. **That pinning is not a bug and must not be "fixed"** — changing
   effort mid-conversation invalidates the prefix and roughly doubles the cost of the rest of that
   conversation.
2. **The prompt got cheaper this week and that is already priced in.** The built prompt measured
   49,344 chars before the agenda cap and **41,448 after** (~-1,974 tok/turn). At Fable 5 rates,
   that single bounded query is worth roughly **$12/mo** of the numbers above. Further prompt
   levers (intake compression, persona dedupe) are documented in
   `PROMPT-COST-MEASUREMENT-2026-08-25.md` and would compound.

---

## 6 · The tension, named rather than resolved

The operator has stated **both**:

- a **$0 doctrine** — no LLM call on high-frequency internal save paths, a cost firewall built
  deliberately; and
- **"maximum intelligence at all times."**

These conflict. The honest framing, which this document will not resolve on the operator's behalf:

> Frontier tokens spent on trivial internal transforms are 10–50× waste. Frontier tokens spent on
> judgment are the entire point. **Tiered escalation honours both constraints; "always max" honours
> only the slogan** — and costs 3× the tiered option to do it.

Scenario (b) at **$26/mo** buys frontier capability on the turns that need it while leaving the
firewall standing on the ones that don't. Scenario (a) at **$77/mo** buys the slogan.

---

## 7 · What happens on a "go" — and what will NOT happen without one

**Not done, and not doable by an agent:** provisioning a key, adding a Railway variable, or
enabling a paid lane. Those are operator actions, every time.

On an explicit go, the implementation is (in order):

1. Wire `routeCapability()` as the band selector, keeping `TASK_ROUTING_PREFERENCES` as fallback
   (additive migration — the incumbent stays until the replacement wins on evidence).
2. Add a **deterministic** band classifier (`deterministic | trivial | normal | strategic | hard |
   frontier`). No LLM call to decide which LLM to call — that would re-import the cost this
   document is trying to bound.
3. Preserve the four existing invariants verbatim: `untrustedInput` outranks band; effort pinned
   per conversation; a conversation-level `max` pin stays **refused**; `justify: true` stays
   per-run.
4. **Degrade audibly.** Every gate in the current chain fails silently — that is how a `turbo`
   toggle came to arm `providerOverride: "anthropic"` against a key that does not exist. A resolved
   lane that is not the intended lane must reach the UI as a fact, using the existing response-header
   precedent.
5. A non-interactive provenance chip on the assistant turn showing the answering lane. This is the
   antidote to five silent gates, and it is the item most likely to be cut for being cosmetic. It
   is not cosmetic; it is the only thing that makes a silent downgrade visible.

**Acceptance before it counts as done:** a strategic-band turn demonstrably reaches the intended
model at the intended effort, with a trace; a keyless lane produces a visible degradation notice
rather than a quiet fallback; `eval_run` shows no regression.

---

## 8 · The decision — ANSWERED: (c)

**Chosen: (c) stay on Ollama.** See the banner at the top of this file. The options as they were
put:

- **(a) Always frontier** — ~$77/mo at current volume, ~$0.12/turn. Simplest; contradicts the $0 doctrine.
- **(b) Tiered escalation** — ~$26/mo. Recommended. Honours both constraints. Needs a band classifier.
- **(c) Stay** — $0 marginal. The router stays dark; "can't handle complex tasks" stays partly a
  procurement fact, not a bug. Note WP2 (shipped) already fixes the *work-loss* half of that
  complaint independently of this decision.

Volume is the sensitivity to watch: every number above scales linearly with 20.9 turns/day. At 3×
the usage, (b) is ~$79/mo and (a) is ~$232/mo.
