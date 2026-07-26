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
