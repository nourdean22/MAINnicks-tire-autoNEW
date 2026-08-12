# Ollama Cloud bake-off · 2026-08-12-finalists

Deterministic probes on the existing flat subscription (no judge, no new spend).
Reps per probe: 5 · weights: tool .4 / reasoning .25 / instruction .2 / json .15

| model | score | tool | reasoning | instruction | json | median ms |
|---|---|---|---|---|---|---|
| deepseek-v4-pro | 0.8 | 1 | 1 | 0 | 1 | 1150 |
| minimax-m3 | 0.84 | 1 | 1 | 0.2 | 1 | 1557 |

**Chat/reason lane pick:** minimax-m3 (score 0.84)
**Fast lane pick:** minimax-m3 (instr 0.2 · json 1 · 1557ms)

Pins are Railway env (`OLLAMA_MODEL` / `OLLAMA_FAST_MODEL`) — operator applies; this script never mutates config.