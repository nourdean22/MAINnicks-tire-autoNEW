# Persona A/B · insight stance

model=minimax-m3 · reps=2 · cases=4 · A=2687 ch · B=2433 ch

## Pre-registration (frozen 2026-08-16T02:39:06.584Z)

- **Metric:** mean deterministic insight points per case (scoreInsight v2), plus challenge-marker rate and sycophantic-opener rate. No LLM judge.
- **Decision rule:** Arm B graduates only if it leads mean insight points by >= 0.75 across all cases AND does not increase the sycophantic-opener rate. A persona change that merely sounds better does not ship.
- **Futility stop:** If after 2 full runs (2 x 4 cases x REPS) neither arm leads by >= 0.75 mean points, the persona is NOT the cause — abandon this lever and stop attributing the quality complaint to it.
- **Minimum cases:** 4
- **Arms:** A=incumbent identityBlock() vs B=thinking-partner stance (authority + security verbatim)


| case | rep | A pts | B pts | A challenge | B challenge | A sycophantic | B sycophantic |
|---|---|---|---|---|---|---|---|
| retention | 1 | 4 | 1 | true | true | false | false |
| retention | 2 | -2 | 4 | false | true | false | false |
| pricing | 1 | 4 | -2 | false | false | false | false |
| pricing | 2 | 4 | 4 | true | true | false | false |
| time | 1 | 3 | 3 | false | false | false | false |
| time | 2 | 4 | -2 | false | false | false | false |
| growth | 1 | -2 | 3 | false | true | false | false |
| growth | 2 | 3 | 3 | false | false | false | false |

**Mean insight points:** A=2.25 · B=1.75 · lead(B−A)=-0.50
**Challenge-marker rate:** A=0.25 · B=0.50
**Sycophantic-opener rate:** A=0.00 · B=0.00

**Verdict against the frozen rule:** arm B does NOT graduate — persona stance is not the lever, or the effect is below the pre-registered threshold

Persona text is code (lib/ai/prompt/static.ts identityBlock) — the operator applies any change; this script never mutates the prompt.