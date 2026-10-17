# Deep scout v2 (2026-10-17): mechanisms from serious teams' source, ranked against our code

**Answer.** Ten mechanisms are worth building. The first is time-sensitive: the brain arbiter
keep/kill read on 2026-10-23 compares two raw means with no uncertainty, so it can decide on noise.
Each item names the source file it comes from, the file of ours it changes, and the proof that
would show it works. Nour picks; the manager dispatches build lanes. Nothing here is built.

**Why this pass exists.** Nour (2026-10-17): the first scout (#3082/#3084/#3085/#3086) found
popular tools; he wants what the best engineers ship. So the unit here is a mechanism read from
source, never a product to install. Popularity was ignored; star counts are not recorded.

## Method and evidence labels

1. One Perplexity research query per area (Enterprise Pro account, research mode, driven in
   Chrome; six threads, slugs in the appendix). Each answer cites exact source files.
2. For each area this session then read OUR code at file:line, and read the 1-2 most promising
   upstream source files with `gh api` (licence, archive flag, last push, and the function).
3. Labels: **FACT** = read in source or measured this session. **INFERRED** = follows from facts.
   **CLAIM** = stated by Perplexity or a paper and not re-read here.
4. Perplexity's file locations are CLAIM until re-read. One was wrong in a small way (ChainForge
   kappa lives in `executor.ts`, imported from `utils.ts`), which is why the re-read matters.
5. Scope note: an earlier attempt fanned six research subagents out; they were stopped on Nour's
   instruction (token cost) before writing anything. Every finding below came from the Perplexity
   threads plus this session's own reads.

## Top 10, ranked

Rank = (expected gain x confidence) / cost, with time-sensitivity breaking ties.

| # | Area | Mechanism (one line) | Source file | Our file | Size |
|---|---|---|---|---|---|
| 1 | Evals | Clustered standard error + paired difference with a CI before any keep/kill read | `UKGovernmentBEIS/inspect_ai` `src/inspect_ai/scorer/_metrics/std.py` | `apps/statenour/scripts/arbiter-judge-split.ts` | S |
| 2 | Reels | Word-timed captions on the default Google voice via SSML `<mark>` timepoints | Google TTS `v1beta1` (`enableTimePointing`); pattern from `rany2/edge-tts` `communicate.py` | `apps/nickstire/server/services/reelVoice.ts:85` | S |
| 3 | Agents | Loop watchdog hook: block the Nth identical action+result, nudge first | `OpenHands/software-agent-sdk` `.../conversation/stuck_detector.py` | `.claude/settings.json` hooks + new `scripts/agent-os/stuck-watch.mjs` | S |
| 4 | Brain | FSRS scheduler for spaced review and tutor grades | `open-spaced-repetition/ts-fsrs` `packages/fsrs/src/algorithm.ts` | `components/actions/mode-learn.tsx:258`; PR #3095 `tutor-pack.ts` | M |
| 5 | Reels | Clip verify on a 3-frame contact sheet with a forced choice against confusable beats | `Vchitect/VBench` `temporal_flickering.py`; `Lightning-AI/torchmetrics` `clip_score.py` | `apps/nickstire/server/services/clipVerify.ts:257` | S |
| 6 | Alerting | One Alertmanager-style Telegram dispatcher: group, inhibit, repeat, resolve | `prometheus/alertmanager` `dispatch/dispatch.go`, `inhibit/inhibit.go` | `apps/nickstire/server/services/alertClaim.ts` (4 call sites) | M |
| 7 | Evals | Judge calibration by Cohen's kappa + false-pass / false-fail, not raw agreement | `ianarawjo/ChainForge` `.../evalgen/executor.ts` `computeAlignmentStats` | `apps/statenour/lib/services/judge-calibration.ts` | S |
| 8 | Voice | On-policy simulated caller graded on end state, reported as pass^k | `sierra-research/tau2-bench` `src/tau2/user/user_simulator.py`, `metrics/agent_metrics.py` | `apps/nickstire/server/services/ghostReplay.ts` | M-L |
| 9 | Brain | Tutor records an unaided free-recall attempt before any multiple-choice hint | Tutor CoPilot RCT (`rosewang2008/tutor-copilot`) + FSRS rating policy | PR #3095 `tutor-pack.ts` `pickRecall` | S |
| 10 | Reels | Two-pass linear loudnorm (measure, then apply measured gain) | `FFmpeg/FFmpeg` `libavfilter/af_loudnorm.c` | `apps/nickstire/server/services/reelAssembly.ts:632` | S |

## The proposals

### 1. Error bars and a paired difference on the arbiter judge-split (evals, S, time-sensitive)

- **Source (FACT, read 2026-10-17).** `inspect_ai` (MIT, pushed 2026-10-17), `std.py`:
  `_cluster_partition` (line 57) validates a cluster id on every sample, `_clustered_stderr`
  (line 86) computes the standard error over clusters, plus `bootstrap_stderr` (line 18).
  Anthropic's "Adding Error Bars to Evals" (arXiv 2411.00640) says clustered errors can exceed naive
  ones by more than 3x (CLAIM) and that paired differences beat two separate CIs.
- **Ours (FACT).** `scripts/arbiter-judge-split.ts` prints `n`, mean and p50 per `assigned` arm
  (lines 48, 132-136): no interval, no clustering. The 2026-10-23 decision rule, per the
  brain-upgrade session's handoff memory (CLAIM), is "keep it on only if the assigned=true mean
  composite is not below assigned=false".
- **Delta.** Add, in that script only: cluster = conversation id (fallback: ET day); per-arm mean
  with clustered SE and a t-interval; the difference of means with its own CI. Print a verdict
  word: `better`, `worse`, or `cannot tell (n too small)`. Pure TypeScript, no dependency.
- **Gain (INFERRED).** At a week of one operator's turns the two arms will differ by noise.
  Without the interval the 2026-10-23 read is a coin flip that looks like a decision.
- **Proof.** A unit test with a fixture where the means differ but the CI crosses zero must print
  `cannot tell`; a positive control with a planted large gap must print `better`.
- **Risk.** None to production; the script is read-only (runs under `railway run`).

### 2. Word-timed captions on the default Google voice (reels, S)

- **Source (FACT).** Google TTS discovery doc, version `v1beta1`: `SynthesizeSpeechRequest`
  has `enableTimePointing: ["SSML_MARK"]`; the response carries `timepoints[{markName,
  timeSeconds}]`. The `v1` doc has no such field (checked 2026-10-17). Same idea as
  `rany2/edge-tts` `communicate.py` asking for `boundary="WordBoundary"` (CLAIM, LGPL; not adopted).
- **Ours (FACT).** `reelVoice.ts:85` calls `https://texttospeech.googleapis.com/v1/text:synthesize`;
  default voice `en-US-Neural2-J` (line 79). Word-timed ASS captions exist but run only when the
  voice carries alignment, which today is ElevenLabs only (`reelVoice.ts:232`,
  `reelAssembly.ts:1136`). So the default reel gets beat captions, never word captions.
- **Delta.** In `buildReelSsml` put `<mark name="w{i}"/>` before each word; call `v1beta1` with
  `enableTimePointing`; convert timepoints to the existing `VoiceAlignment` shape (word start =
  its mark, end = next mark) so `generateAssSubtitles` is reused unchanged.
- **Gain (INFERRED).** Every Google-voiced reel gets karaoke-timed captions at zero added cost
  and no new vendor; captions are a known retention lever (operator to measure, not claimed).
- **Proof.** Unit test on a recorded `v1beta1` response; then one rendered reel where caption
  onsets sit within 100 ms of the spoken word (spot-check 10 words by ear or with `ffprobe`).
- **Risk.** Chirp 3 HD voices may not honour `<mark>` (CLAIM): keep the current path as the
  fallback when `timepoints` comes back empty.

### 3. A loop watchdog for our coding agents (agents, S)

- **Source (FACT, read 2026-10-17).** `OpenHands/software-agent-sdk` (MIT, pushed 2026-10-17),
  `stuck_detector.py`: scans the last 20 events (`MAX_EVENTS_TO_SCAN_FOR_STUCK_DETECTION`),
  separate thresholds for repeated action+observation, repeated action+error, monologue and A/B
  alternation. Perplexity adds (CLAIM) that it nudges once before stopping, and that its
  context-window check is a TODO returning False.
- **Ours (FACT).** `.claude/settings.json` registers SessionStart, PreToolUse, Stop and
  PreCompact hooks; there is no PostToolUse hook and nothing in `scripts/agent-os` detects a
  repeating tool loop. Lanes cost 450k-570k tokens each (`subagent-brief.md`).
- **Delta.** PostToolUse appends `{tool, normalized args hash, result/error hash, git tree hash}`
  to a per-session ring buffer of 20 under the session's temp dir. PreToolUse: on the 3rd identical
  signature against an unchanged tree, return a warning in context ("same call, same state, change
  approach"); on the 5th, deny with exit 2. Keyed on state, so re-running a test after an edit is
  never blocked.
- **Gain (INFERRED).** Caps the worst token burn (a lane re-running the same failing command).
- **Proof.** guard-red-team: a canary that replays 5 identical calls must be denied; a control
  with an edit between runs must pass. Ship both (AGENTS.md "Ship the canary").
- **Risk.** A false deny mid-task; mitigated by the tree hash and the nudge-before-deny step.

### 4. FSRS for spaced review (brain, M)

- **Source (FACT, read 2026-10-17).** `ts-fsrs` (MIT, pushed 2026-10-16, npm 5.4.2, no runtime
  dependencies). `algorithm.ts`: `next_interval` (222), `next_difficulty` (246), `mean_reversion`
  (263), `next_recall_stability` (277), `next_forget_stability` (308), `next_short_term_stability`
  (329). Interval is solved for a target retention, not multiplied by an ease factor. Benchmark
  (CLAIM, srs-benchmark README): FSRS-6 log loss 0.3460 over 9,999 collections.
- **Ours (FACT).** `components/actions/mode-learn.tsx:258` pre-creates four rows at fixed
  `[1, 3, 7, 30]` days with no grading. Open PR #3095 (Daily Tutor) schedules by
  `spacedReviewStep(streak, correct)`, a streak ladder.
- **Delta.** Store FSRS state `{stability, difficulty, reps, lapses, lastReview}` in the
  `spaced_review` row content; map correct -> Good, wrong -> Again; replace `spacedReviewStep`.
  Keep an append-only review log (the outcome ledger rows #3095 already writes) so parameters can
  be refitted later. Port the ~150 lines or add `ts-fsrs` (zero deps); prefer the dependency.
- **Gain (INFERRED).** Fewer asks per retained item; intervals stretch for what Nour knows.
- **Proof.** After 60 days, compare predicted recall vs actual on tutor answers (log loss) against
  the ladder's implied recall. Short-term: unit tests reproducing ts-fsrs reference outputs.
- **Risk.** Sequencing: land after #3095 merges, as a follow-up that touches one function.

### 5. Clip verify on a contact sheet, contrastive (reels, S)

- **Source.** VBench `temporal_flickering.py` scores 1 - mean(adjacent-frame MAE)/255 (CLAIM,
  Apache-2.0); torchmetrics `clip_score.py` cosine x 100 (CLAIM). The transferable idea from
  Perplexity's read: score against the right beat AND confusable alternatives, and use the margin.
- **Ours (FACT).** `clipVerify.ts:257-261` extracts ONE midpoint frame and asks one vision call
  for `{score, reason}`. Rendered QA was failing 0/4 on ENVIRONMENT_DRIFT and SUBJECT_CONTINUITY
  (its own header) - drift happens across time, which one frame cannot see.
- **Delta.** Same single vision call, better input: tile first/mid/last frames into one image;
  ask the judge to pick which of 3 beat descriptions (the right one + 2 sibling beats from the
  same brief) the sheet shows, and whether the subject stays the same across the 3 tiles. A pick
  of the wrong beat, or "subject changes", refuses with the existing `ClipMismatchRefusal`.
  Optional free prefilter: ffmpeg `freezedetect` for frozen clips.
- **Gain (INFERRED).** Catches within-clip morphs and leniency (a judge that says 0.7 to anything)
  for the same cost per clip.
- **Proof.** Replay the stored clips of the 4 failed cron reels: the new gate should refuse the
  beats rendered QA flagged; and pass a known-good reel's clips.
- **Risk.** Flag is default OFF already (`REEL_CLIP_VERIFY_ENABLED`); no new spend until armed.

### 6. One Alertmanager-style Telegram dispatcher (alerting, M)

- **Source (FACT, read 2026-10-17).** `prometheus/alertmanager` (Apache-2.0, pushed 2026-10-16)
  `dispatch/dispatch.go`: an aggregation group fires after `GroupWait` (line 691), then every
  `GroupInterval` (line 800); repeat and dedupe are decided against a notification log, so "same
  alert", "same group" and "already told" are three identities. `inhibit/inhibit.go`: an active
  source alert silences matching target alerts (CLAIM, not re-read).
- **Ours (FACT, origin/main).** `alertClaim.ts` (from #3089) claims once per state per shop day
  with `INSERT IGNORE`; 4 call sites use it (3 in `cron/scheduler.ts`, 1 in `sms.ts`), while
  288 `sendTelegram` references sit in 64 non-test files of `apps/nickstire/server`. #3089 removed duplicate senders by hand.
- **Delta.** One `notifyOperator({alertname, labels, severity, text})` that: fingerprints stable
  labels, holds a 30 s group window then sends one grouped message, records the notification log
  in the existing `cron_alerts_fired` table, re-sends only after a repeat interval, sends one
  "resolved" when the state clears, and applies a small static inhibit list (SMS gateway down
  silences per-message SMS failures). Migrate call sites in batches; no new table.
- **Gain (INFERRED).** Fewer buzzes per incident and a "resolved" Nour can trust; the next
  duplicate sender is impossible by construction, not by review.
- **Proof.** Count Telegram sends per incident for 7 days before and after (cron_log + bot API
  counts); test that 5 alerts in 10 s send 1 message and a cleared state sends 1 resolve.
- **Risk.** A bad inhibit rule hides a real alert: keep inhibit rules few, tested, and logged.

### 7. Judge calibration by kappa (evals, S)

- **Source (FACT, read 2026-10-17).** `ChainForge` (MIT, pushed 2026-10-15)
  `evalgen/executor.ts` `computeAlignmentStats` (line 649) counts true/false pass/fail per criterion
  and reports `cohens_kappa` (line 737) and MCC (line 731). EvalGen paper (Shankar et al.) for the
  workflow (CLAIM).
- **Ours (FACT).** `judge-calibration.ts` reports raw agreement % with bands at 70 and 50 (lines
  44-46). With thumbs-up as the common case, raw agreement rewards a judge that always says "v2".
- **Delta.** Add kappa, false-pass rate and false-fail rate to the same report; label
  `well-calibrated` on kappa >= 0.6 rather than agreement >= 70 %.
- **Proof.** A fixture where the judge always picks v2 and 80 % of reactions are thumbs-up must
  read kappa ~0 and not "well-calibrated".
- **Risk.** None; read-side report.

### 8. On-policy caller simulation and pass^k for the receptionist (voice, M-L)

- **Source.** `tau2-bench` (MIT, pushed 2026-10-16): a goal-driven user simulator
  (`user_simulator.py`, plus `user_simulator_voice.py`), grading on environment end state, and
  `pass_hat_k = C(s,k)/C(n,k)` per task (CLAIM for file contents; repo metadata FACT).
- **Ours (FACT).** `ghostReplay.ts` replays real caller turns fixed in advance (off-policy:
  when the candidate answers differently, the next real caller line no longer follows), grading
  replies by regex + judge. `promptEvolutionGate.ts` already repeats each seed and uses a
  sign-flip permutation test with a regressed-seed veto, which is strong.
- **Delta.** Keep ghost replay. Add a second lane: per vaulted call, extract the caller's goal
  ("book Saturday brake check for a 2014 Civic"), simulate the caller from that goal on the
  Ollama lane, run k=4, grade end state (correct booking intent, no banned promise), report pass^4.
- **Gain (INFERRED).** Measures reliability (all 4 runs right), which a mean pass rate hides.
- **Risk / cost.** Ollama only (standing rule: no OpenAI replay spend). Simulators drift toward
  polite stereotypes (UPSTREAMS "synthetic users" row): use only as a second opinion.

### 9. Unaided recall first in the tutor (brain, S)

- **Source.** Tutor CoPilot RCT: +4 pp mastery, +9 pp for lower-rated tutors, human-mediated
  (CLAIM, Apache-2.0 demo repo, 2024). FSRS rates recall, which multiple choice does not measure.
- **Ours (FACT, PR #3095).** The tutor asks a 3-option retrieval question (recognition).
- **Delta.** Ask the open question first; show the 3 options only as a hint; grade Again if the
  hint was needed. Store `unaided` separately so #4 schedules on real recall.
- **Proof.** Share of answers given unaided over 30 days; FSRS log loss with vs without it.

### 10. Two-pass loudnorm (reels, S)

- **Source.** FFmpeg `af_loudnorm.c` (CLAIM): with measured input values from a first pass it
  applies linear gain; single-pass runs the dynamic mode with a limiter.
- **Ours (FACT).** `reelAssembly.ts:632` runs single-pass `loudnorm=I=-14:TP=-1.5:LRA=11` after a
  sidechain duck (lines 627-631, already the right mixing shape). `audioQa.ts:192` measures after.
- **Delta.** Measure the mixed track first, then pass `measured_I/TP/LRA/thresh` and
  `linear=true` in the second pass.
- **Proof.** `audioQa` LRA and true peak on 5 reels before and after; no audible pumping.

## Already native or already decided (no proposal)

- **Vapi endpointing** (LiveKit `turn.py` separation of endpointing from barge-in): native.
  `vapi.ts:1134-1172` tunes `transcriptionEndpointingPlan` from 416 measured transcripts and
  deliberately keeps `stopSpeakingPlan` after refuting the barge-in hypothesis.
- **Codex execpolicy positive/negative examples**: native. Every rule in
  `config/agent-os/policy.json` carries `denyExamples` and `allowExamples`.
- **RRF hybrid recall + one rerank**: native (`lib/brain/rrf.ts`, `contextual-recall.ts`,
  `cohere-rerank.ts`). Contextual chunk headers help documents; brain rows are short facts.
- **Graphiti contradiction trap** (issue #1728, unrelated facts retiring each other): does not
  apply; `contradiction-cleanup.ts` acts only on an explicit operator verdict.
- **Generative Agents recency bug** (older nodes scored as more recent): not in our code;
  `contextual-recall.ts:416` is a plain age step function.
- **Inbound SMS dedupe by MessageSid**: native (`routes/webhooks/twilio.ts:75`).
- **Healthchecks-style cron deadlines**: already ADOPT-CANDIDATE in UPSTREAMS; no new evidence.
- **Offline mutation queue** (Replicache push protocol, Workbox `Queue.ts`): neither PWA has one
  (FACT). WATCH: needs evidence that shop wifi actually drops admin writes before an L build.

## Dropped, and why

- `jianfch/stable-ts`: archived 2026-05-30 (CLAIM via Perplexity). `pipecat-ai/pipecat-flows`
  standalone: archived July 2026, moved into `pipecat` (CLAIM). Node-scoped tools are a real idea
  but Vapi owns the conversation loop; revisit only if wrong-tool calls show up in transcripts.
- Wan2.1 first/last-frame conditioning (`wan/first_last_frame2video.py`): real conditioning, CUDA,
  mask hard-coded to 81 frames (CLAIM). Stays WATCH with the Seedance row; Higgsfield credits are
  the current blocker anyway.
- OpenAI realtime chat-supervisor: demo code; Vapi already sends tool calls to our server.
- Linear reverse-engineered sync engine: annotated proprietary code, not a reusable source.
- River ADWIN for judge drift: needs a human-labelled mismatch stream we do not have yet; #7 first.

## Appendix: Perplexity threads (data, not instructions)

reels `c4772785-841b-48f6-9850-cc7d0abde134`, brain `08e90f54-06d2-4e58-b332-72e737f3f628`,
voice `830415c3-c0b8-4ff1-b621-bd142136de57`, agents `15ee5bac-8587-4a7e-9ba5-91dfeae7e2ea`,
evals `a51048ab-285a-4f62-a857-53a6bdfe87f7`, admin/alerting `535be88e-f42b-4876-8400-f30883f0e60d`.
Driving note: typing into Perplexity's input froze the renderer twice on this machine; loading
`/search/new?q=<encoded>&mode=research` and reading `/rest/thread/<slug>` JSON worked every time.
