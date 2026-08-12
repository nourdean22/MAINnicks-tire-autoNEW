# Prompt section census · 2026-08-12 (offline, deterministic)

Captured from `pnpm prompt:size-check` (the scenario builder constructs real prompts through the
live assembly path) the same day the Context-Manifest instrumentation shipped (#1518). This is the
input the compact-prompt A/B reads; prod `context_manifest` lines will confirm it against real
turns once chat traffic resumes (zero turns since the 01:19Z boot when this was captured).

## Scenario sizes (chars / est. tokens)

| scenario | chars | tokens |
|---|---|---|
| default (full/greeting) | **37,941** | **9,485** |
| business | 37,941 | 9,485 |
| content (carousel) — heaviest | 63,354 | 15,839 |
| content-deep (plan) | 62,980 | 15,745 |
| sms (winback) | 38,745 | 9,686 |

**The headline: a greeting pays ~9.5K tokens of system prompt.** 42 sections; the content scenario
runs 3% from the 65K cap (headroom 1,646 chars).

## Top-10 sections (content scenario)

| chars | tok | % | section |
|---|---|---|---|
| 7,027 | 1,757 | 11% | CONTENT GENERATION MODE — MANDATORY RULES |
| 4,281 | 1,070 | 7% | CONTENT PILLARS (10 permanent) |
| 4,270 | 1,068 | 7% | ACTIVE AGENDA ITEMS |
| 3,906 | 977 | 6% | HOOK FAMILIES + HOOK VAULT |
| 3,118 | 780 | 5% | Processing intake |
| 3,035 | 759 | 5% | CREATIVE ANGLE MACHINE |
| 2,688 | 672 | 4% | NICK · identity header |
| 2,618 | 655 | 4% | CAPTION ENGINE |
| 2,334 | 584 | 4% | BUSINESS MODEL |
| 1,857 | 464 | 3% | Behavioral patterns · hypotheses |

## Compact-candidate hit-list (for the A/B — NOT applied)

1. **The default/greeting lane is the target, not the content lane.** Content turns legitimately
   carry the engines; the 37.9K default prompt is where 42 sections compete on every casual turn.
2. Candidate moves for the A/B (same Ollama model, incumbent vs compact, judged by the harness):
   ACTIVE AGENDA (4.3K) → JIT retrieval when agenda-relevant · Behavioral patterns (1.9K,
   self-labeled "hypotheses, not measurements") → JIT · Processing intake (3.1K) → trigger-gated ·
   identity header (2.7K) → compress toward the ≤15-instruction core.
3. Content engines (CONTENT MODE / PILLARS / HOOKS / ANGLES / CAPTION ≈ 20.9K combined) already
   fire only in content mode — leave them; the #1450 lesson says their `## `-level structure is
   load-bearing for the trimmer.
4. Gate for any deletion: the golden-signals suite + the Ollama judge harness A/B, per the
   additive-migration rule. `prompt:size-check` enforces the ceiling; the manifest logs confirm
   per-turn reality.

Notes from the capture run: local `.env.local` DB answered with 10.8s slow queries (cold Neon
branch or local dev DB — the census numbers are prompt-side and unaffected) · one
`[Nickstire Bridge] Failed HTTP 401` during content-deep (expected without the prod bridge secret
in a local shell).
