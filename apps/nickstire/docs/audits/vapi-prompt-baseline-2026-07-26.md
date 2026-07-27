# VAPI system-prompt baseline — 2026-07-26

Measured before any compression, because the directive is explicit: *"Do not
declare a smaller prompt better unless representative calls improve or remain
noninferior."* Without a baseline there is nothing to compare against, and
"smaller" would be self-certifying.

## Current size

| | |
|---|---|
| `ASSISTANT_SYSTEM_PROMPT` | **19,553 chars ≈ 4,888 tokens**, 144 lines |

Every voice turn pays this. Current Vapi guidance treats prompt tokens as
directly additive to turn latency.

## Where the bulk lives

| Section | chars | lines |
|---|---|---|
| `# CRITICAL RULES (NEVER BREAK)` | **4,508** | 18 |
| `# HOW YOU TALK` | 2,925 | 18 |
| `# YOUR TOOLS` | 1,881 | 11 |
| `## FLOW 1 — TIRE` | 1,424 | 6 |
| `## BROKEN-DOWN / TOWED` | 973 | 2 |
| `## FLOW 2 — REPAIR` | 887 | 6 |
| `# URGENCY LIBRARY` | 794 | 9 |
| `# TRUST PHRASES` | 680 | 9 |

## The headline finding

**46 lines are negative/prohibition text: 12,531 chars ≈ 3,133 tokens = 64.1%
of the entire prompt.**

Nearly two-thirds of the per-turn prompt cost is spent telling the model what
NOT to say. That is doubly bad:

1. It is pure latency on every turn.
2. Current Vapi guidance treats long negative ban lists as an ANTI-PATTERN —
   a banned phrase quoted inside the prompt stays live in the model's context
   and can become MORE likely to surface. (This session already committed and
   then reverted that exact mistake: retired dollar figures were briefly
   written into the prompt as "never say X" before being moved to code
   comments.)

## Architectural constraint — verified, and it changes the plan

The directive specifies "kernel + dynamic intent playbooks". Checked against
the code before designing around it:

- `assistantOverrides.variableValues` **exists and is proven** — but every
  current caller is OUTBOUND (`cron/jobs/followupCadence.ts:198`,
  `routers/vapi.ts:1068`), where the callee is known in advance.
- On an **inbound** call the system prompt is set at pickup, when the caller
  has not spoken. **There is no intent yet to select a playbook with.**

| Layer | Achievable at call start? |
|---|---|
| Small static kernel | YES — just a smaller prompt |
| Per-call CUSTOMER capsule | YES — caller phone is known at pickup |
| Per-INTENT playbook | **NO** — intent does not exist yet |

Intent-specific content on inbound is only reachable via (a) a tool the model
calls once the caller states their need, or (b) per-intent assistants with
routing. Both are materially different from injecting a prompt block, and (a)
is the cheaper one.

## Recommended sequence

1. **Compress the kernel.** Replace the 64% prohibition surface with compact
   positive contracts. The deterministic validators that must actually enforce
   these rules ALREADY EXIST (`planViolations`, `photoReplyViolations`,
   approved-amount checks) — prompt prose was never what enforced them.
2. **Inject the customer capsule** on inbound via `variableValues`. Proven
   machinery, currently unused for inbound.
3. **`getPlaybook(intent)` as a TOOL**, not a prompt block — the only way
   intent-specific content can reach an inbound call.

## Acceptance gate for the compression

Not "chars went down". Required:

- token count before/after (baseline above)
- time-to-first-audible-response before/after
- representative-call evaluation showing behaviour preserved or improved
- the prohibition surface enforced by validators, with tests, NOT by prose

Nothing in this file is a change to the prompt. It is the measurement that
makes the change verifiable.

---

# Addendum 2026-07-27 — the latency + behaviour halves, measured

The gate above named four numbers and supplied one. Three are now measured, from
the 100 most recent inbound calls (VAPI `GET /call`, read-only).

## Latency

| | p50 | p90 | p95 |
|---|---|---|---|
| Time to first assistant audio (n=100) | 0.40s | 0.45s | 0.65s |
| User turn → assistant reply (n=248) | 0.90s | 2.29s | 3.58s |

**Time-to-first-audio is NOT a useful gate metric.** `FIRST_MESSAGE` is a static
greeting VAPI speaks without a model call, so 0.40s measures TTS start and says
nothing about prompt cost. It will not move when the prompt shrinks. The
mid-call reply gap is the number that matters, and it is 2–7× the 500ms target
in `VOICE_LATENCY_TARGET_MS`.

## Where the reply gap actually comes from

| Turn type | n | p50 | p90 |
|---|---|---|---|
| No tool call — pure generation | 195 (79%) | 0.87s | 2.29s |
| Tool call in between | 53 (21%) | 1.50s | 3.37s |

**79% of turns invoke no tool at all** — no DB, no API, no round-trip — and still
cost 0.87s median. Tool traffic adds only ~0.6s on top. The latency is in
generation with a 4,888-token prompt resident, not in I/O.

This is the first evidence the compression thesis has had. It was previously an
inference from token count alone.

**Honest limit:** 0.87s is prompt prefill + output generation + TTS start
combined, and this cannot separate them. Output length is plausibly the larger
share — the prompt prescribes multi-clause scripted lines ("mounting, computer
spin balancing, new valve stems, an alignment check, and a safety check"). A
compression that shortens the PROMPT but not what the assistant SAYS may move
this number very little. Shortening scripted output is a candidate lever with a
better prior, and it is testable independently.

## Behaviour baseline (the non-inferiority half)

Scored with `voiceClaimGuard` (#1107) over 526 assistant turns:

| | |
|---|---|
| Speaker attribution coverage | 100/100 calls, 0 unparsed |
| Prohibited-claim violations | **1 turn in 526 (0.19%)** |
| False positives (adjudicated) | 0 |
| False negatives (loose-net probe) | 0 |

**The prohibition surface is currently WORKING on claims.** A 0.19% violation
rate is the bar compression must not regress — and it is a demanding one. This
reframes the compression from "remove text that enforces nothing" to "remove
text while preserving a measured 99.8% compliance rate".

The one violation: *"we'll get it done while you wait — about 15 minutes"* —
banned by Rule 1 ("never state how long an oil change takes") and by the wait
rule.

## What the same corpus found that prose was NOT preventing

22 of 100 calls opened the transfer with stacked filler. The model was innocent;
the second wait came from `transferCall`'s hardcoded destination message. Fixed
in #1108. See that PR — it is the sharpest available illustration that a prompt
rule cannot govern a behaviour the model does not produce.

## Method

Read-only. `VAPI_API_KEY` only; no DB connection, no writes. Assistant turns
extracted with #1107's parser. Probe scripts were throwaway — the durable
instrument is `voiceClaimGuard`, which now runs per-call in the webhook.
