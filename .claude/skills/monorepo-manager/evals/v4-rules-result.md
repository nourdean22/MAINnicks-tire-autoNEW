# v4 rule evals: recorded shapes (2026-10-30)

Runner: `node .claude/skills/monorepo-manager/evals/v4-rules.mjs [--ref <git ref>]`. Each case derives the manager's answer to a
scenario from the skill text (SKILL.md plus every linked reference) with a fixed parser; C0 is a v3 rule and the positive control.
Not a model run: a model following the text is proven only by the next real manager job.

## Red first: v3 (`--ref origin/main`, base 33d02c1a24, before this branch touched SKILL.md)

`origin/main: 1 of 15 pass`, exit 1. C0 PASS (got `act`). Every v4 case FAIL, with the v3 shape:

| Case | v3 answer |
|---|---|
| R1 RAM gate | no thresholds in the text |
| R2 session cap | no session cap in the text |
| R3 brief lines | accept,accept,accept (a brief without LOOP RULE passes) |
| R4 sweep cadence | no sweep cadence in the text |
| R5 sweep readings | no sweep line |
| R6 ruling broadcast | not stated |
| R7 finished-doc digest | nothing stated |
| R8 close-out order | no close-out line |
| R9 archive guard | unknown |
| R10 send-back limit | first:false second:false |
| R11 parked register | park:false again:false |
| R12 queue | not stated |
| R13 lane agents missing | not stated |
| R14 job start | no Job start section |

The baseline and the 15-case runner were committed (2f1930de00) before the first commit that changed SKILL.md (72df6cdf64);
R3's third brief was added after the mutation pass below, and v3 still answers it wrong.

## Green: v4 (working tree)

`working tree: 15 of 15 pass`, exit 0.

## Mutation pass (one rule broken in a temp copy, the case must go red)

Killed 11 of 13. R1, R2, R3, R4, R8, R9, R11, R12, R13 each killed by a single edit to SKILL.md or the reference. R6 and R10
survive a SKILL.md-only edit because `references/session-pipeline.md` states the same rule (equivalent mutants: the skill text
still gives the right answer); editing both copies kills them (R6b, R10b). R3 survived its first run (dropping only LOOP RULE
from the rule still rejected a brief missing all three lines); the case now also lints a brief missing only LOOP RULE.
