# Compact-prompt A/B · 2026-08-12b

main=minimax-m3 · judge=gpt-oss:120b · A=incumbent (40,842 ch) · B=compact (31,594 ch, −23%)
Dropped sections: ## Processing intake (3118 ch) · ## Behavioral patterns (1857 ch) · ## ACTIVE AGENDA ITEMS (4270 ch)
Verdicts count ONLY when both judge orders agree.

| case | verdict |
|---|---|
| strategy-1 | tie-unstable |
| strategy-2 | tie-unstable |
| agenda-dependent | tie-unstable |
| casual | A |
| decision | tie-unstable |
| content-lite | tie-unstable |
| strategy-3 | B |
| strategy-4 | tie-unstable |
| agenda-2 | tie-unstable |
| agenda-3 | tie-unstable |
| factual-1 | tie-unstable |
| memory-1 | A |
| comms-1 | A |
| decision-2 | A |

**Wins:** incumbent=4 · compact=1 · unstable=9 · errors=0

Graduation rule (plan #21 / additive migration): compact may replace incumbent only if it wins-or-ties overall AND does not lose the agenda-dependent case — losing that case means the JIT-retrieval half must ship BEFORE the sections leave the prompt.