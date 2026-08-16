# Persona A/B · insight stance

model=minimax-m3 · reps=3 · cases=4 · A=2687 ch · B=2433 ch

## Pre-registration (frozen 2026-08-16T03:11:47.593Z)

- **Metric:** mean deterministic insight points per case (scoreInsight v2), plus challenge-marker rate and sycophantic-opener rate. No LLM judge.
- **Decision rule:** Arm B graduates only if it leads mean insight points by >= 0.75 across all cases AND does not increase the sycophantic-opener rate. A persona change that merely sounds better does not ship.
- **Futility stop:** If after 2 full runs (2 x 4 cases x REPS) neither arm leads by >= 0.75 mean points, the persona is NOT the cause — abandon this lever and stop attributing the quality complaint to it.
- **Minimum cases:** 4
- **Arms:** A=incumbent identityBlock() vs B=thinking-partner stance (authority + security verbatim)


| case | rep | A pts | B pts | A challenge | B challenge | A sycophantic | B sycophantic |
|---|---|---|---|---|---|---|---|
| retention | 1 | 3 | 0 | true | false | false | false |
| retention | 2 | 4 | 4 | false | false | false | false |
| retention | 3 | 3 | 1 | false | true | false | false |
| pricing | 1 | 3 | 4 | false | false | false | false |
| pricing | 2 | 3 | 3 | true | true | false | false |
| pricing | 3 | 4 | 5 | false | false | false | false |
| time | 1 | 5 | 3 | true | false | false | false |
| time | 2 | 3 | 3 | true | true | false | false |
| time | 3 | 3 | 3 | false | false | false | false |
| growth | 1 | 4 | 3 | false | false | false | false |
| growth | 2 | 3 | 5 | false | false | false | false |
| growth | 3 | 4 | 3 | false | true | false | false |

**Mean insight points (void cells excluded):** A=3.50 (n=12) · B=3.08 (n=12) · lead(B−A)=-0.42
**Void cells (empty after retry):** 0 of 12 — these are provider failures, not persona results
**Challenge-marker rate:** A=0.33 · B=0.33
**Sycophantic-opener rate:** A=0.00 · B=0.00

**Verdict against the frozen rule:** arm B does NOT graduate — persona stance is not the lever, or the effect is below the pre-registered threshold

Persona text is code (lib/ai/prompt/static.ts identityBlock) — the operator applies any change; this script never mutates the prompt.