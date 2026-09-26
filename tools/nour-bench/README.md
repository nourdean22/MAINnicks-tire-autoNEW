# NOUR-Bench

Repository-specific coding evaluation harness. The unit of success is a solved
NOURCITY task, not a public leaderboard score.

## Primary metrics

- cost per solved task
- human minutes per solved task
- verifier outcome
- retries and regressions
- wall-clock time

`cases.jsonl` starts with real historical tasks from this repository. Each case
pins the pre-change commit so agents can be compared from the same source state.

The initial cases are a seed, not a complete benchmark. Expand toward 20-50
cases across Nick's Tire, StateNour, worker, and shared tooling before using the
suite to select a default model.
