# Active blockers / operator-owed

| Blocker | Blocks | Operator action |
|---|---|---|
| **OpenRouter account OUT OF CREDITS (P1)** | Tournament, brief generation, rendered-QA critic — in prod AND locally (same `sk-or-v1` key both places; 402 on every call; health "openaiHealthy" was misleading — zero recent requests) | Add credits at openrouter.ai/settings/credits. Everything creative-LLM resumes instantly; QA verdicts on assembled jobs can be re-run |
| Listening pass | Audio naturalness scores | Play the trajectory render when it lands; the deterministic gates stand regardless |
| Render trajectory in flight | traj-001 completion | None — job 660001 (A/B re-render of 30008's exact brief through the FIXED pipeline) is on prod's 15-min pulses; monitor armed |

## Resolved this run (2026-07-17)
- ~~0088 DDL~~ → APPLIED + verified (32/5 cols)
- ~~GCP redirect URI~~ → added via your Chrome, "OAuth client saved"
- ~~Drive consent~~ → granted (drive.file, nourdean22); vault live: root `17SCNTPnvjEgwz3ii9o2YNbWdT0SfaOJC`
- ~~19 git-hostage masters unarchived~~ → 19/19 registered + byte-verified in Drive, reconcile clean; git cleanup unblocked
