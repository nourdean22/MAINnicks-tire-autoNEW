# Ollama Cloud bake-off · 2026-08-11

Deterministic probes on the existing flat subscription (no judge, no new spend).
Reps per probe: 2 · weights: tool .4 / reasoning .25 / instruction .2 / json .15

| model | score | tool | reasoning | instruction | json | median ms |
|---|---|---|---|---|---|---|
| deepseek-v4-pro | 0.8 | 1 | 1 | 0 | 1 | 1365 |
| glm-5.2 | 0.525 | 1 | 0.5 | 0 | 0 | 1141 |
| glm-5.1 | 0.65 | 1 | 1 | 0 | 0 | 2272 |
| qwen3.5:397b | 0.4 | 1 | 0 | 0 | 0 | 2287 |
| kimi-k3 | DEAD | 0 | 0 | 0 | 0 | -1 |
| mistral-large-3:675b | 0.75 | 1 | 0 | 1 | 1 | 865 |
| nemotron-3-ultra | 0.9 | 1 | 1 | 0.5 | 1 | 28351 |
| minimax-m3 | 0.9 | 1 | 1 | 0.5 | 1 | 1392 |
| gpt-oss:120b | 0.8 | 1 | 1 | 0 | 1 | 1227 |
| deepseek-v4-flash:0731 | 0.8 | 1 | 1 | 0 | 1 | 849 |
| nemotron-3-nano:30b | 0.8 | 1 | 1 | 0 | 1 | 2300 |
| gpt-oss:20b | 0.8 | 1 | 1 | 0 | 1 | 1340 |

**Chat/reason lane pick:** nemotron-3-ultra (score 0.9)
**Fast lane pick:** mistral-large-3:675b (instr 1 · json 1 · 865ms)

Pins are Railway env (`OLLAMA_MODEL` / `OLLAMA_FAST_MODEL`) — operator applies; this script never mutates config.

## Operator read (2026-08-11 — corrects the script's latency-blind sort)

- **The script's "chat pick" is wrong in practice:** nemotron-3-ultra ties minimax-m3 at 0.9
  but runs **23–52s per call** — unusable for chat. **minimax-m3 (0.9 @ 1,392ms)** is the real
  chat-lane winner: equals the incumbent `deepseek-v4-pro` (0.8 @ 1,365ms) everywhere and beats
  it on instruction discipline.
- **The incumbent FAST pin lost outright:** `glm-5.2` scored 0.525 (reasoning ½, instruction 0,
  json 0) while **`deepseek-v4-flash:0731` scored 0.8 @ 849ms** — better on every axis AND ~25%
  faster. This is the highest-confidence flip.
- `mistral-large-3:675b` is the only model that passed instruction 2/2 + json 2/2 (865ms) but
  failed the arithmetic both reps — a candidate for classify/extract if flash disappoints.
- `kimi-k3` is **outside the flat plan** (HTTP 402 "extra usage only") — the subscription
  boundary self-enforces; excluded.

**Recommended flips (operator applies on Railway):**
1. `OLLAMA_FAST_MODEL=deepseek-v4-flash:0731` — incumbent measurably lost; low risk (internal lanes).
2. `OLLAMA_MODEL=minimax-m3` — measured winner, but 4 probes × 2 reps is thin evidence against
   deepseek-v4-pro's months of live tool-call history; flip as a canary or after a wider rerun
   (`railway run --service statenour-web -- pnpm exec tsx scripts/vnext-ollama-bakeoff.ts`).