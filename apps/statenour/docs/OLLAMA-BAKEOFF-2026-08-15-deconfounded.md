# Ollama Cloud bake-off · 2026-08-15 (de-confounded instrument)

Deterministic probes on the existing flat subscription (no judge, no new spend).
Reps per probe: 2 · weights: tool .3 / insight .25 / reasoning .2 / instruction .15 / json .1

Insight is scored by deterministic PROXIES (novel vocabulary, named trade-offs,
concreteness, and a penalty for returning answers the prompt explicitly excluded).
A low score is strong evidence; a high score is weak evidence. See scoreInsight().

| model | score | tool | insight | reasoning | instruction | json | median ms |
|---|---|---|---|---|---|---|
| deepseek-v4-pro | DEAD | 0 | 0 | 0 | 0 | 0 | -1 |
| glm-5.2 | 1 | 1 | 1 | 1 | 1 | 1 | 1308 |
| glm-5.1 | 1 | 1 | 1 | 1 | 1 | 1 | 2437 |
| qwen3.5:397b | 0.775 | 1 | 0.5 | 0.5 | 1 | 1 | 3955 |
| kimi-k3 | DEAD | 0 | 0 | 0 | 0 | 0 | -1 |
| mistral-large-3:675b | 0.55 | 1 | 0 | 0 | 1 | 1 | 806 |
| nemotron-3-ultra | 1 | 1 | 1 | 1 | 1 | 1 | 2808 |
| minimax-m3 | 1 | 1 | 1 | 1 | 1 | 1 | 1274 |
| gpt-oss:120b | 0.875 | 1 | 0.5 | 1 | 1 | 1 | 1092 |
| deepseek-v4-flash:0731 | 0.75 | 1 | 0 | 1 | 1 | 1 | 798 |
| nemotron-3-nano:30b | 0.875 | 1 | 0.5 | 1 | 1 | 1 | 1570 |
| gpt-oss:20b | 1 | 1 | 1 | 1 | 1 | 1 | 1493 |

**Chat/reason lane pick:** glm-5.2 (score 1)
**Fast lane pick:** deepseek-v4-flash:0731 (instr 1 · json 1 · 798ms)

Pins are Railway env (`OLLAMA_MODEL` / `OLLAMA_FAST_MODEL`) — operator applies; this script never mutates config.