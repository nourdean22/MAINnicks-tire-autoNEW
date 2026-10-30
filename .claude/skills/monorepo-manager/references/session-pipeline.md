# Session pipeline (v4, 2026-10-30)

The detail behind SKILL.md "Session pipeline". Every rule here answers a failure in `evals/baseline.md` (T1-T7) and an order
Nour gave on 2026-10-30; the memory file that holds his words is named per section. Each rule says what enforces it.
`evals/v4-rules.mjs` decides one scenario per rule from this text and SKILL.md; run it after any edit here.

## 1. The three brief lines (paste into every brief, under SELF-AUDIT)

The v3 template (`.agents/core/templates/subagent-brief.md`) does not carry these yet; until it does, the manager adds them.

```
LOOP RULE: invoke the `loop` skill with no interval after your first read so the work self-paces; stop it when the RETURN
  block is sent. Commit a checkpoint after each finished section, table or test file; no push until the PR.
STANDARD: benchmark first and leave a `Benchmarked against:` line (steal-like-an-artist; primary pages, quoted with URL and
  date); every claim labelled FACT / STRONG INFERENCE / CLAIM / UNKNOWN with its source; no placeholder, "TBD" or "could not
  find" without the search that came back empty (query and tool); skills invoked by exact name; new tests red on the unfixed
  code first; a second reader on code PRs (pr-review-toolkit silent-failure-hunter and pr-test-analyzer); hostile self-audit
  before RETURN; cross-lane needs listed, never skipped. Ponytail limits the SIZE of the change, never the depth of the search
  or the proof.
SIBLINGS: <the files other sessions of this job wrote or are writing, by path>. Reference them; do not redo them. Ask the
  manager before contradicting one.
```

Why: LOOP RULE, Nour 10:21 EDT "everything needs to be on a loop too any and all sessions ur working on so they dont get
fucked up" (memory `feedback-every-session-on-a-loop.md`; two lanes once lost 40 to 76 minutes of uncommitted edits to a
restart). STANDARD, Nour 10:16 EDT "no lazy or sloppy work" (memory `feedback-manager-max-effort-no-sloppy.md`) and the
10-point bar of 2026-10-30 (memory `feedback-learn-from-the-best.md`). SIBLINGS, Nour 10:51 EDT "keep all sessions up to date
with each other" (memory `feedback-sessions-share-findings.md`).

Enforced: rule `session-dispatch-brief` refuses a `start_session` with no brief file or no model and effort; nothing checks
for these three lines yet (cross-lane need 1 below). A session started before a new rule gets one message with the rule.

## 2. RAM gate and concurrency

Machine facts (FACT unless labelled): NattyNour is a 16 GB laptop. Four concurrent suite runs gave an OOM and 20 s timeouts
(v3 Workers section). On 2026-10-30 free RAM read 615 MB at 14:03Z with about 11 sessions of another manager running, then
160 MB with 15 sessions, and the laptop crashed before 15:25Z (memory `shop-os-planning-manager-2026-10-30.md`). On 2026-10-29
seven sessions carried 1.1 to 1.4 GB of MCP child processes each and the PC crashed at 02:28Z (ledger
`2026-10-29-manager-sweep.md`). `node scripts/agent-os/heavy.mjs status` prints `free RAM: N MB`.

The gate, read before every `start_session`:

| Free RAM | May start | Also do |
|---|---|---|
| under 500 MB | nothing | stop (`stop_session`) the least important idle session: a paused research or docs session first, a writer last; never one mid-commit |
| 500 to 1,499 MB | docs-only or read-only sessions (no suites, no builds) | queue writers (section 3) |
| 1,500 MB and up | a writer session too, within the 2-writer limit | suites still go one at a time through `heavy.mjs run --` |

The 2-writer and 1-heavy-run limits count research agents, reviewers, workflow fan-outs and background suites too (v3 Workers
section, kept). Raise any limit only with a measured reason.

Machine-wide cap: 10 running sessions, counting every session on the machine (`list_sessions` without `linked`), other
managers' included. STRONG INFERENCE: set between the two measured points (about 11 ran at 615 MB; 15 crashed it). Recalibrate
from a new measurement only, and write the reading next to the new number. Stopped sessions keep their worktree and resume from a
RESUME message (`git status`, `git log`, continue from the last commit).

Enforced: `heavy.mjs` waits for 1,500 MB before a heavy run (FACT, `MIN_FREE_MB = 1500`). The start gate and the cap are
advisory (cross-lane need 2).

Benchmarked against: Kubernetes node-pressure eviction, https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/
(read 2026-10-30): the default hard threshold is `memory.available<100Mi` on Linux nodes and `memory.available<500Mi` on Windows
nodes; a node past it gets the `MemoryPressure` condition, and pods "where the usage exceeds requests" are "evicted based on their
Priority" first. Adopted: a fixed floor (500 MB, this is a Windows laptop) below which nothing new is admitted, and eviction by
priority (idle research and docs before writers). Not adopted: automatic eviction; the manager stops a session by hand.

## 3. Queue (pipeline, never batch)

When the gate or the writer limit blocks a session, write its brief now and add a line to the takeover file:

```
QUEUED <yyyy-mm-dd hh:mmZ> <title> - brief <path> - <model>/<effort> - start when: <the trigger, e.g. "doc 12 is archived" or "free RAM >= 500 MB">
```

On every sweep, start it the moment a slot frees, oldest first unless a ruling says otherwise. Memory
`feedback-pipeline-dont-batch.md`: the slow resource never idles. Advisory.

## 4. Start (`start_session`, names checked 2026-10-30 with ToolSearch)

- `initiation: "user_asked"` only when Nour asked in words for sessions; else `own_initiative` (a card he starts).
- `context: "fresh"` with `background` of at least 80 characters; `prompt` names the brief file and pastes its LOOP RULE.
- `model` and `effort`: from the brief's MODEL / EFFORT line. The tool caps both at the CALLER's level ("Same family or cheaper
  than yours; anything higher is ignored"), so a manager on Sonnet cannot start an Opus session: run the manager at the highest
  tier the job needs. A `fork` runs on your model.
- `permission_mode`: set it explicitly (Nour runs bypass; memory `feedback-stop-asking-one-little-step.md` item 4) so a session
  never stops on a prompt he has to tap.
- `name`: short and stable (it is how sweeps and digests address the session); `use_worktree: true` for anything that writes.
- The tier table is the template's (`subagent-brief.md`, "Picking model and effort": tier C = opus for judgement). The memory file
  `feedback-session-model-by-tier.md` uses the letters the other way round (tier A = Opus); the template wins, say the model by name.

## 5. Sweep (every 600 to 900 s while sessions run; memory `feedback-active-session-checking.md`)

One tick, in this order; the whole sweep is reads:

1. `node scripts/agent-os/heavy.mjs status` (free RAM) and `list_sessions` (count against the cap; who is idle, working, waiting).
2. Per running session: `git -C <worktree> log -1 --format="%h %cr"` (minutes since its last commit), `git -C <worktree> status --short`
   (dirty count), `list_events` with a small limit (is it waiting on a prompt, blocked, looping).
3. Per open PR of the job: `gh pr checks <n>` (the state column), unresolved review threads, Codex rounds.
4. Owed live reads (`/api/health` `.deploy.commit`, the statenour heartbeat) when a merge is waiting to deploy.
5. Act on what the sweep found in the same tick: start QUEUED work, digest, send back, close out.

45 minutes without a commit: one three-line check-in. A third silent sweep: replace the session or re-plan (benchmark B9). A
session showing "needs the user" is named to Nour with its link. Never 1,500 s while sessions run.

## 6. Digest and ruling broadcast (memory `feedback-sessions-share-findings.md`)

A ruling from Nour goes, in the same tick, to every running session of the job:

```
NO REPLY NEEDED: Nour ruled <yyyy-mm-dd hh:mm tz>, verbatim: "<his words>". For you this means: <one line>.
```

A finished doc (merged, or read and accepted) becomes a digest for the still-running sessions:

```
NO REPLY NEEDED: <doc file> is done. Verdict: <one line>. Reuse: <numbers or facts, labelled>. Cite it as <path>; do not redo <what>.
```

The takeover file records which digest went to which session and when. A large finding goes in the shared notes folder, with the
path in the message (`sessions-and-plans.md`, messaging rule 4). Advisory.

## 7. Send-back (memory `feedback-manager-max-effort-no-sloppy.md`)

Read the real diff on every return. A thin doc, an unlabelled number, a skipped research step, a placeholder, or a "could not find"
with no search receipt: send it back once with the exact gap:

```
REPLY NEEDED: <file>:<line> <the gap>. Fix: <what done looks like>. One push.
```

A second miss on the same gap gets a higher tier (`set_session_model`) or a replacement session with the gap in its brief; never the
same model unchanged (B18). In the report, name what each session did well and what went back. Enforced for lane agents by
`scripts/agent-os/subagent-receipt-check.mjs` (SubagentStop); for sessions this is advisory (cross-lane need 3).

## 8. Close out (memory `feedback-finish-archive-report-simply.md`)

After the PR merged (steps 12-17) or the result is folded in, in this order:

1. Takeover memory file: PR number, merge SHA, what shipped, what is still owed (reads, Nour's steps), digests sent.
2. Archive the session: `archive_session`. The tool asks that the user agreed to archive that session; Nour's standing order
   (2026-10-30 10:46 EDT, "every session needs finished n then archivesd") is that agreement for sessions of a job he ordered.
   Never while its PR is open or its worktree holds uncommitted work, and never a session he started himself. The 10x option:
   offer once to turn on the app setting `auto_archive_on_pr_close` (ccd_settings `set_setting`; he approves it), so merged
   sessions archive themselves.
3. Tell Nour one line per finished piece: what it is, where it lives, what he can do with it now. No process talk.

## Parked for Nour

Nour wants questions only for the four protected classes (spend, customer-facing sends, production writes, credentials;
`.agents/core/USER.md`). Every other choice is decided, done and reported with a `Ruling:` line. When he defers a decision
("leave these for later", "remind me"), it goes in the takeover memory file under this heading:

```
## Parked for Nour
- <yyyy-mm-dd> <the decision, one line> - his words: "<verbatim>" - needed by: <the step or date that needs it> - default if silent: <what happens>
```

Then show them again at the next decision gate (the step that needs one, a planned call such as the Shop OS day 13-14 call)
and in every final report, until he answers; then move the line to the job's rulings with his answer. Never re-ask a decision
USER.md lists as settled. Witness: 2026-10-30 10:30 EDT, six Shop OS decisions, "leave these for laster remind me". Advisory.

## Enforcement summary

| Rule | Enforced by | Scope |
|---|---|---|
| Brief file, model and effort on `start_session` | rule `session-dispatch-brief` (`config/agent-os/policy.json`, `pretool.mjs`) | Claude Code |
| SHOP DATA block in a shop-data brief | rule `brief-shop-data` | Claude Code |
| LOOP RULE, STANDARD, SIBLINGS lines | advisory | - |
| RAM gate at start, 10-session cap | advisory | - |
| Heavy runs at 1,500 MB, one at a time | `heavy.mjs` | every caller that uses it |
| Sweep cadence, digest, broadcast | advisory | - |
| Send-back on a receipt-less return | `subagent-receipt-check.mjs` | lane agents only |
| Close-out order, archive, parked register | advisory | - |

## Cross-lane needs (proposals for a platform PR; not built here)

1. `session-dispatch-brief`: also deny a `start_session` whose brief file lacks a `LOOP RULE:` line (canary: a brief with and without).
2. A PreToolUse check on `start_session` that reads free RAM and denies under 500 MB, with `HEAVY_FREE_MB` as the canary input.
3. A Stop-hook rule for the manager: a session's PR reported as done with no `gh pr checks` read in the turn (extends `skills-check.mjs`).
4. Template v4: add the three lines of section 1 to `.agents/core/templates/subagent-brief.md`.

## Benchmarked against

- Kubernetes node-pressure eviction (section 2): admission floor plus eviction by priority. Read 2026-10-30.
- Anthropic, "How we built our multi-agent research system", https://www.anthropic.com/engineering/multi-agent-research-system
  (read 2026-10-30): agents "summarize completed work phases and store essential information in external memory before proceeding
  to new tasks". Adopted as close-out item 1 (the takeover file before archive) and the digest of section 6.
- Microsoft Magentic-One progress ledger with a stall count (benchmark B9, `benchmark-2026-10-22.md`): kept as the sweep's
  45-minute check-in and third-sweep replacement.
