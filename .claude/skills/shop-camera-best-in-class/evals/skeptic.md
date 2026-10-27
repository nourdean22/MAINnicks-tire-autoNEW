# Skeptic pass: shop-camera-best-in-class

reviewer: lane-research (sonnet / medium, read-only), 2026-10-26, about 36 tool calls; dispatched with the manager's slot

## Findings

- "Raw audio is never kept" was false: the office lane keeps raw clips locally for 6 h by default (officewake.py retention flag) and the real rule is "never uploaded"; the ASR row's disk spool also conflicted. Step 4 now says audio never leaves the shop PC and local clips are pruned at the retention limit; the spool row stays inside it: fixed
- "WinSW XML in the repo" was false: the repo has one NSSM install script and no WinSW config. The Supervisor row now says so: fixed
- The office probe was described as every 30 s; the code defaults are a 5 s probe every 15 s (prod env not checked). Rows and upgrade 7 corrected: fixed
- The skill said the counter had no written entry rule; README section 8 documents the visitd dwell machine and the edge already counts portal crossings with a documented crossing line. The rows and upgrade 4 now point at that prior art and ask which rule feeds production first: fixed
- The description excluded "a library adoption verdict" while a should-trigger query asks whether to move to Frigate. The description now names that question and excludes only a verdict on one library alone: fixed
- Several lines labelled VERIFIED were not in the cited doc (rw_timeout and stimeout, entered_zones order, low-res plate detail, CPU-only GenAI, pyannote on CPU, the Task Scheduler page). They are now labelled RESEARCH, vad_simple cites stream.cpp, the WinSW link points at its XML doc, and the Task Scheduler link is the restartcount page (the restartonfailure URL returned 404): fixed
- Step 3 assumed UPSTREAMS verdicts for Silero, faster-whisper, go2rtc and WinSW that do not exist; it now says offline benches are fine and an install needs a verdict row first: fixed
- Step 5 needed a production SELECT without routing to prod-db-guard, and the skill never said where the lane code lives. Added a "Where the lanes live" section and the prod-db-guard route: fixed
- Overlap with reverse-engineer-anything on "reverse engineer one": that phrase is gone from the description and a shipped binary or capture is a named Not-for; the general learn-from-the-best stance is named as the parent: fixed
- forge.mjs check accepts a one-character "rejected:" reason, ignores "*" bullets, accepts a hand-typed invocation.json and reads only the first line of a multi-line description: rejected: real defects in skill-forge's tooling, not in this skill; reported to the manager as a platform follow-up and out of this PR's scope
- No `triggers:` line for skill-recall: fixed
- PR numbers in the upgrade list will go stale: the file now says to read the PR's state first: fixed
