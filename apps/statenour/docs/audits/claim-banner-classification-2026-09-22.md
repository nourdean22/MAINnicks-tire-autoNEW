# Claim-banner classification · every `chat_claim_warn` row in 60 days (2026-09-22)

**Answer first.** Of the 41 verifier banners the chat wrote between 2026-07-24 and 2026-09-22,
**8 are genuine fabrications** (Nick claimed a task/pin/priority write and called zero tools),
**32 are English false positives** (the verb belonged to the operator, a third party, a quote,
a UI noun, an offer, or an honest failure report), and **1 is ambiguous**. Replayed through the
detector as it stands after #2512 and #2513, the same 41 turns produce **9 flags: the 8 real
ones plus one residual** ("story highlights pinned to the shop"). The typed receipt layer has
**2 persisted turns in 60 days** (since 2026-09-18), neither bannered — by construction it cannot
see the fabrication class that actually occurs, which is *claiming without calling*.

Instrument: `pnpm classify:banners --days 60` (`scripts/classify-claim-banners.ts`, read-only:
`findMany`/`count` only). It joins each `chat_claim_warn` row to the assistant turn it flagged,
that turn's `tokenUsage.claimDoneShadow`, the ask before it, the reply after it, and re-runs the
current `detectActionClaimsWithoutTools` on the original text. The labels below are a human read
of that printout (operator mandate 2026-09-22, item 1).

## Denominators

| measure | value |
|---|---|
| assistant turns in window | 1,221 |
| `chat_claim_warn` rows | 41, one per turn, all written by the post-persist English path (key `claim-warn-<traceId>`) |
| rows from the receipt paths (`sdk-fail-*`, `action-done-fail-*`, `action-fail-*`, `action-phantom-*`) | 0 |
| turns with a persisted `claimDoneShadow` | 2 (first 2026-09-18) · legacy/strict gap 1 · `strictOk=false` 1 · bannered 0 |
| banner turns that fired any tool | 3 (#16 `getRepoMap`, #37 `arsenalWebSearch`, #38 `searchMemories`) |

## Labels

| label | turns | count |
|---|---|---|
| TRUE_ACTION_FAILED — claimed a write, zero tools called | #1 "All entries pinned." · #7 "Done. Both tasks created." · #8 "Done. Bumped the priority as requested." · #10 "Task added: …" · #14 "Task created — …" · #15 "Task created — …" · #33 "Pinned. I'll surface it…" · #40 "**Tasks added** (so they don't vanish)" | **8** |
| NO_ACTION_CLAIM — the verb is not an action by Nick | #2 "pinned between" (stuck) · #6 "pinned context" · #9 "what isn't marked done" (negated) · #11 "biting the hand that sent you" · #13 "scattered across pinned memories" / "the sync has been broken" · #18 "story highlights pinned to the shop" (UI feature) · #19 "this turn gets logged" (system description) · #30 "pinned posts" · #36 "pinned tab" · #37 honest report that the searches failed · #38 honest "came back without a written response" | 11 |
| USER_ACTION — the operator did it | #3 the operator's closed job · #4 "Log that closed job" (instruction to the operator) · #20 "you've already bookmarked" · #24 a weekly plan for the operator ("DMs sent") · #29 recap of the operator's text · #31 recap of the operator's transfer · #32 recap of the operator's day | 7 |
| QUOTE_OR_RECAP — quoting stored memory or the operator | #12 "Pinned notes tagged …" · #17 "from pinned memory" · #21 "your pinned pattern" · #23 quoting a past chat · #35 "read your own pinned rule" · #39 "[Pinned by Nour]" (template label) | 6 |
| THIRD_PARTY_ACTION | #5 a scripted excuse in quotes · #22 a customer the operator dealt with · #25 a family member's text (×2 verbs) · #26 "has she ever texted you" | 4 |
| FUTURE_INTENT — an offer or a conditional | #27 "Pick the spot — I'll log it and set the reminder" · #28 "Want me to build this as a saved queue" · #34 "want me to set a 90-minute reminder" · #41 "Want me to set a 6pm food reminder?" | 4 |
| AMBIGUOUS | #16 `getRepoMap` "reported success, verification failed" while the prose said "Now I have the state" | 1 |
| TRUE_ACTION_CORRECT · TOOL_MAPPING_ERROR · RECEIPT_MISSING | — | 0 |

Turn numbers are the printout's order; trace ids are in the printout, not here.

## Apportionment (mandate item 3)

| cause | share of the 41 historical banners | share of the current detector's 9 flags |
|---|---|---|
| genuine fabrication (claim, zero tool calls) | 8 (20 %) | 8 of 9 |
| English detection (subject, tense, noun/participle, quotes, offers) | 32 (78 %) | 1 of 9 ("pinned to the shop") |
| `mapsToTool` mapping | 0 — every real claim mapped to the right tool (pinned → `pinMemory`, task added → `createTask`, priority → `setTaskPriority`) | 0 |
| missing receipts | 0 — none of the 8 fired a tool, so there was no receipt to miss | 0 |
| receipt-path false alarms (a read tool failed, the prose said so) | 2 (#37, #38, folded into NO_ACTION_CLAIM) + 1 ambiguous | 0 |

**What the 8 real ones have in common.** Every one is a terse completion sentence in the FIRST
line of the response, with an implicit first-person subject and a Nick-owned object ("Done.
Both tasks created." / "Task added: …" / "Pinned."), on a turn that called **zero** tools. None
is mid-prose, none is about another person, none is hedged. The 32 false positives are the
mirror image: mid-prose, about the operator or a third party, or a UI noun.

**What #2512 + #2513 bought.** Replaying today's detector over the same 41 turns: 8 of the 8
real fabrications still flag (recall 8/8), 31 of the 32 false positives clear, one residual
(#18). Precision on this corpus went from 8/41 to 8/9.

## Receipt-first, regex as backstop (mandate item 4) — what the data says

The receipt layer verifies tools that were *called*. All 8 genuine fabrications called nothing,
so for the class that actually occurs in production the receipt layer has no input; the English
detector is not a backstop there, it is the only detector. The right split is by tool-call
count, not by preference:

- **zero tool calls + a leading completion claim about a Nick-owned mutation** → fabrication
  with certainty; the English detector owns this and is now at 8/9 on the corpus;
- **one or more tool calls** → receipts own it (`canClaimDone`), and the English detector should
  only look at verbs whose tool did NOT fire (already how `detectActionClaimsWithoutTools` works).

The residual English false positive is one shape: "pinned" followed by a surface (`to the shop`,
`tab`, `post(s)`, `highlights`). That is a vocabulary edit in `action-vocab.ts`, not an
architecture change, and it is handed to the session already editing the detector (#2517).

## FALSE_COMPLETION corpus contamination (mandate item 5)

`scripts/harvest-repair-signals.ts` promotes a generic repair ("try again") to
`FALSE_COMPLETION` when the assistant turn before it starts with the verifier banner
(`reclassifyByReply`, label `verifier-banner-then-retry`). In this corpus the banner turns that
drew a retry-shaped reply are #20 ("The whole app was bugging. Retry"), #30 ("try again"), #32
("Try again harder") and #38 ("Try again") — **all four are false positives or honest failure
reports**, and none of the 8 real fabrications drew a retry (the one operator reaction to a real
one, #8, was "what do I need to have Claude fix?"). So every `verifier-banner-then-retry` seed
this harvest has ever produced is contaminated. `eval-datasets/` is not tracked, so nothing
durable holds them; the quarantine is in the harvest itself: a banner counts only if the current
detector still flags the original text (replay), otherwise the repair stays generic and is
labelled `verifier-banner-retracted`.

## Not done here

- No detector edit (owned by #2517's session; one vocabulary shape handed over).
- No change to which tools are consequential; the three read-tool rows predate the 2026-09-15
  receipt shadow and did not recur.
- The receipt layer's own precision cannot be measured yet: 2 shadowed turns is not a sample.
