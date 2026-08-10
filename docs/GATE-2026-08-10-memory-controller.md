# GATE — "MEMORY CONTROLLER: Single-Pass Mandate" (2026-08-10)

**Requested filename was `MEMORY-AUDIT.md`; filed here instead to match the gate
convention set by `apps/statenour/docs/GATE-2026-08-10-nour-os-audit.md` (#1481).
This is the 14th external mega-plan gated. Content is unchanged from what the
mandate asked for, including the mandatory `## Falsified` and
`## Could not verify` sections.**

---

## PHASE 0 VERDICT — one sentence

**The memory controller already exists and is wired: a repo-native SessionStart
hook plus Claude Code Auto Memory both fired in this session before my first
tool call, so the mandate's central premise — "you bought disk and an index and
never installed the memory controller" — is false, and Phase 2 as written would
build a parallel implementation of a live system.**

Per the mandate's own decision table, this is the "read a state file first →
**bridge is live**, skip Phase 2's install step" branch.

---

## The falsification test, run honestly

The mandate asked me to log my first three information-gathering moves verbatim
and not to infer the answer. They were:

1. `Skill(plan-gate)` — the repo's own gate for pasted mega-plans.
2. `Read` of `~/.claude/projects/C--Users-nourd-NOURCITY/memory/nour-os-audit-gate-2026-08-10.md`
   — **a state file**, selected from the auto-memory index that had already
   loaded at session start.
3. `PowerShell` — `graphify --version` / `graphify hook status`.

I did not grep and read a dozen files. Move #2 returned, on my third tool call,
a receipt that falsified one of this mandate's own delete-list items before I
had opened a single source file.

**Scoreboard against the mandate's five questions**, answered from loaded
context alone, with no reminder from the operator:

| Question | Answerable? | Source |
|---|---|---|
| Last material decision | **Yes** | plans 11/12/13 gated 2026-08-10; #1483 shipped (queued ≠ sent) |
| Known failed approach | **Yes** | DRY_RUN default-ON declined 2026-08-09; `/decisions/[id]` deleted then reverted |
| Active blocker | **Yes** | bridge idempotency defect at `nour-os-query.ts:195`; camera→reel operator-blocked |
| Current objective | **No** | nothing holds it |
| Next action | **No** | nothing holds it |

**3 of 5.** That is the real finding: not amnesia, a **two-field gap**. See
"Genuinely new" below.

---

## What is actually installed

| Component | State | Receipt |
|---|---|---|
| `graphify claude install` | **NEVER RAN** | zero `graphify` matches in `CLAUDE.md`; `PreToolUse` is `scripts/agent-os/pretool.mjs`, not a graph nudge |
| `graphify cursor install` | **NEVER RAN** | `.cursor/rules/graphify.mdc` ABSENT; the three present are repo-native (`repo-core` · `nickstire` · `statenour`) |
| `graphify hook install` | **NEVER RAN** | `graphify hook status` → `post-commit: not installed`, `post-checkout: not installed` |
| **Repo-native graph bridge** | **LIVE — fired this session** | `.claude/settings.json` SessionStart → `scripts/graphify-session-context.ps1` (8,565 bytes, since 2026-08-03). Emitted node/edge counts, query instructions, **and a freshness warning** into context ahead of move #1 |
| **Claude Code Auto Memory** | **LIVE — loaded this session** | `~/.claude/projects/C--Users-nourd-NOURCITY/memory/` = **143 `.md` files** + a ~130-line `MEMORY.md` index |
| **Daily graph rebuild** | **LIVE** | `graphify-out/` holds 26 dated dirs `2026-07-14`→`2026-08-10`; `graph.json` (52.9 MB) mtime **2026-08-10 07:33:41**; `obsidian-sync.log` mtime 07:34:09 |
| `graphify save-result` / `reflect` | **NEVER RUN** | `graphify-out/reflections/` **ABSENT** → `LESSONS.md` does not exist |

**The mandate's "smoking gun" is technically true and practically irrelevant.**
The three vendor install commands never ran — but a repo-native equivalent does
the same job and demonstrably fired. `EXISTS + WIRED`, built differently than
the plan assumed.

---

## Falsified

Mandatory section. Every assumption the evidence killed, and which instrument lied.

1. **★★★ `app/(mastery)/decisions/[id]/page.tsx` is NOT 0 lines and does NOT
   break `next build`. It is 634 lines** (+ a 47-line API sibling). This is the
   **fourth** consecutive mandate to assert it (8, 11, 12, now 14).
   Only `git ls-files | grep -F | xargs wc -l` returned the truth: **634**.

   **CORRECTED after review — my first diagnosis here was wrong.** I wrote that
   "git globs `[id]` the way PowerShell does". It does not:
   `git show 'HEAD:apps/statenour/app/(mastery)/decisions/[id]/page.tsx'` returns
   all 634 lines and `git cat-file -s` returns 25277, brackets intact. **The real
   trap is a path-base mismatch:** `git ls-files` run from a *subdirectory* emits
   **CWD-relative** paths, while `REV:path` resolves **repository-root-relative**
   — so feeding the first into the second addresses a path that does not exist.
   **`git show` then prints nothing and exits 0**, which is the genuinely
   dangerous part: piping it to `wc -l` records a confident zero with no error on
   any stream. `git cat-file -s` was the honest instrument all along — its
   `fatal: path ... does not exist in 'HEAD'` printed the brackets intact, and I
   misread that as bracket-mangling. Brackets remain a real hazard in PowerShell;
   they are not one in git.
2. **`lib/eval` is 0 files** — already deleted in #1465 after being proven *not*
   a duplicate. The "one of `lib/eval` / `lib/evals` — Duplicates" row targets a
   phantom. `lib/evals` = 4 files / 574 LOC is the live one.
3. **`lib/obsidian` IS imported — the delete condition is not met.** Live
   importers: `app/api/obsidian/status/route.ts:10-11` (a Next.js API route) and
   `components/obsidian/obsidian-engine-card.tsx:6` (a live component), plus 7+
   scripts. The mandate gated this on "only if Phase 1 proved zero imports". It
   proved the opposite. **Do not delete.**
4. **The brain-bus thesis is stale.** "Nine producers, zero consumers since
   2026-05-28, 393 pending events" — `brain-bus-drain` is registered at
   `config/crons.ts:481`, with line 475 commenting on exactly those nine
   producers. Revived by `a193c0543`. This premise was already falsified when
   plan 12 used it as *its* stated thesis.
5. **`--bare` appears nowhere** in `.github/`, `scripts/`, or `package.json`.
   The "instant complete explanation" escape hatch is ruled out.
6. **The npm `graphify` package is a different project entirely** — description
   `RGG (Random Graph Generator)`, homepage `github.com/emeraldarrow/Graphify`,
   sole version `1.0.0`. The installed tool is a standalone binary at
   `C:\Users\nourd\.local\bin\graphify.exe` self-reporting **0.9.8**. Therefore
   the mandate's version narrative (v0.9.33–0.9.38 as "four correctness releases
   in four days, Aug 5–9") **cannot be sourced from npm** and I will not repeat
   it. See "Could not verify".
7. **`lib/ai/moneyprinter` is not dead weight** (carried from #1481, re-checked):
   149 tracked files. `wc -l` reports 1,141,971 "lines" because it is ~97%
   binary assets — *the LOC instrument is meaningless on this directory.*
   Traced into the standalone build at `next.config.ts:43`; `Dockerfile:90`
   installs `python3 ffmpeg imagemagick py3-pip` for it.

**Where the mandate measured correctly** — its LOC figures are exact, and it
deserves credit for that: `lib/brain` **51,146** (157 files) · `lib/obsidian`
**650** (6 files) · `components/chat` **6,201** (26 files). Same pattern as plan
11: **the measurements are sound, the dispositions are wrong.**

---

## Could not verify

Mandatory section.

- **Does `next build` pass?** Not run. This worktree is a harness worktree with
  **no `node_modules` junctions**, and sibling sessions are active — a build here
  is both broken and antisocial. Indirect evidence says yes: the page is 634
  lines of implemented `DecisionSpread`, and per #1481 it has survived 1,848
  commits with `ignoreBuildErrors` removed since 2026-07-25.
- **The installed graphify's real release history and changelog.** The binary is
  not the npm package; I did not locate its upstream. Every claim about its
  release cadence, its README's query-logging contradiction, and whether 0.9.8
  contains work-memory is **unverified**.
- **The dead-consumer sweep (Phase 1 item 2), the mandate's own highest-value
  task.** Requires reading live queue depths. Per `prod-db-guard` and
  `AGENTS.md`, prod DB probes are operator-authorized only; I did not run one.
  The one producer/consumer pair I *could* check statically (brain-bus) came
  back **alive**, which is itself a caution against trusting the "nine dead
  producers" framing without a probe.
- **Whether `lib/brain` (51,146 LOC) is reachable from a live path.** Not traced
  this pass. Untouched regardless — the mandate says freeze, not delete.
- **The ETH Zurich −3% study's benchmark composition**, and whether it
  generalizes to this monorepo. Cited but not inspected.

---

## Freshness — the one measurement that held up

The mandate is right that freshness matters; it is wrong about the mechanism.

- Graph built from commit **`754393621` (Fri Aug 7 07:51)**; this worktree's HEAD
  is **Mon Aug 10 09:26** — the SessionStart hook reported **60 commits ahead**.
- But `graph.json` was **rewritten today at 07:33**. A daily rebuild *is*
  running (scheduled task `NOURCITY-Graphify-Sync`).

**Corrected after the first pass — there are TWO defects, and the dominant one is
not the checkout.** `scripts/graphify-session-context.ps1` chooses between the
worktree's copy of `GRAPH_REPORT.md` and the primary's by **newest mtime**. That
tiebreak inverts in a fresh worktree: `git checkout` stamps the committed artifact
with the checkout time, so this worktree's copy (**09:41**, built from `75439362`,
Aug 7, 47,208 nodes) beat the primary's live copy (**07:33**, `ea9e05aa`, Aug 9,
47,796 nodes). Every harness-worktree session was served a two-day-old graph
labelled authoritative, with no staleness signal. Fixed; measured A/B in one
directory: `STALE - built from 75439362, HEAD is 60 ahead` -> `ok - built from
ea9e05aa, HEAD is 25 ahead [via primary checkout]`.

**How it is fixed, after a review correction.** The first attempt preferred the
primary whenever the local copy was *unmodified vs HEAD*. Review caught that this
fails in the mirror-image case: if the scheduled sync has been failing, or the
primary sits on an older branch, a freshly **committed** report is newer than the
primary's working copy and that rule would serve the older one. Both mtime and
clean/dirty are proxies. The shipped version reads each report's own
`Built from commit:` header and compares those **commits' dates** — the only
direct signal — falling back to mtime only when a commit will not resolve
(rebased away, squashed, shallow clone). Verified both directions: with the
primary genuinely newer it selects `[via primary checkout]`; with the local
report's header rewritten to a newer commit it correctly keeps the local copy
and reports `CURRENT`.

**My own proposed fix was falsified before it was written.** "Add `git fetch` +
fast-forward ahead of the daily rebuild" is unsafe here: the primary checkout is on
branch **`session-end`**, **26 commits behind `origin/main`**, with a **dirty working
tree** that may hold a sibling session's work. A scheduled auto-merge into that is
the class of action that caused the 870-row incident. **A fetch alone would not help
either** — the rebuild indexes the working tree, which a fetch does not move. So the
checkout lag is left as an operator action, made loud rather than silently patched.
- Root cause: the primary checkout's HEAD is **`ea9e05aaa` (Sun Aug 9 07:37)**.
  **The rebuild is indexing a stale checkout** — it faithfully re-indexes
  yesterday's tree every morning.

**So the fix is not `graphify hook install`.** A commit hook on a checkout nobody
commits into changes nothing. **Nor is it an automatic fast-forward** — see the
correction immediately below, which supersedes an earlier draft of this paragraph
that prescribed exactly that. The checkout lag is an **operator action**; the fix
that shipped is the report-selection defect described next.

---

## Disposition

| Mandate phase | Verdict |
|---|---|
| Phase 0 — falsification | **DONE.** Returns the invalidating verdict the mandate said to stop on. |
| Phase 1 — audit | **PARTIAL.** Items 1/3/5/6 answered above; item 2 (dead-consumer sweep) needs an operator-authorized prod probe; item 4 not traced. |
| Phase 2 — install the controller | **NATIVE — do not build.** Would duplicate a live SessionStart bridge + Auto Memory. |
| Phase 3 — delete | **BLOCKED.** 3 of 6 targets refuted above (`lib/eval` phantom, `lib/obsidian` imported, `/decisions/[id]` 634 lines). `lib/brain` is freeze-only by the mandate's own rule. `components/chat` is refuted in prior memory (`chat-v2` imports it). `lib/ai/moneyprinter` refuted in #1481. **Nothing deleted.** |

## Genuinely new — the entire remaining surface

Two of five questions have no home: **current objective** and **next action**.
`MEMORY.md` is an *index of 143 topic files*, excellent at "what happened" and
structurally unable to answer "what now".

The honest scope is **two fields and a freshness line** — not a memory
architecture:

1. ~~Build an agent-maintained `CURRENT_STATE.md`.~~ **Rule Zero killed this too:
   the ledger already exists.** `apps/statenour/.remember/now.md` is exactly the
   five-field object, and **five documents route agents into it** —
   `AGENTS.md:51` (source-of-truth rank 8), `AGENTS.md:206`,
   `AGENT-OPERATING-PROFILE.md:369,380`, `apps/statenour/docs/AGENT-CONTEXT.md:214`
   (`cat .remember/now.md`), and `.agents/frameworks/ciitty/SKILL.md:281`
   (*"check it BEFORE touching that app"*). **It was last updated 2026-04-18 —
   114 days — and nothing checked.** EXISTS + BROKEN, so: repaired in place, not
   rebuilt.
   **It had rotted into two false beliefs, both load-bearing.** (a) *"Active
   branch: `main`"* + *"Single push to `main` is the deploy"* — inverts the repo's
   hardest safety rule, on the documented read-path, for four months. (b) *"Dead
   pages removed: … /decisions …"* — while `app/(mastery)/decisions/[id]/page.tsx`
   is **634 lines and live**, plus three sibling routes. **This is the only artifact
   in the repo asserting /decisions is dead, and four consecutive external audits
   have now claimed exactly that.** Not proof they read it — it is on the documented
   read-path and nothing else says it. `core-memories.md` in the same directory
   contradicted *now.md* on the deploy branch (`codex/ollama-local`) and banned
   PowerShell, which is the repo's CLI shell. All four corrected.
2. ~~`git fetch` + fast-forward ahead of the daily rebuild.~~ **Falsified — unsafe,
   and it would not have worked.** See the Freshness section. Replaced by the
   mtime-tiebreak fix, which was the dominant defect.
3. Optional: record one `graphify save-result` outcome so `reflections/` stops
   being empty — pending the version question above.

Both hooks are already wired. This is **wiring, not building** — which is what
the mandate said success looks like.

---

## The fresh-session test, re-run — the only real measure

Same question, same repo, after the change. What a session now receives at startup,
before any tool call:

```
graph freshness: STALE - built from ea9e05aa, HEAD is 26 commit(s) ahead [via primary checkout]
- 47796 nodes · 84888 edges · 2553 communities
session ledger apps/statenour/.remember/now.md: 0 day(s) old - read it for
objective / last decision / blocker / next action.
```

| | before | after |
|---|---|---|
| Graph served | `75439362`, Aug 7, 47,208 nodes, **wrongly authoritative** | `ea9e05aa`, Aug 9, 47,796 nodes, **honestly flagged stale vs HEAD** |
| Current objective | nothing held it | ledger, **signposted** |
| Next action | nothing held it | ledger, **signposted** |
| Last decision / failed approach / blocker | memory index (3/5) | ledger + memory index |
| Files to open | unknown — grep and hope | **one, named in the briefing** |

**3 of 5 → 5 of 5, via a single signposted file read.** The staleness label on the
graph did not change, but its meaning did: it was previously "STALE" about the
wrong artifact by 60 commits, and is now "STALE" about the right one by 26 — an
honest 26 that the operator can act on.

**Honest limitation.** The ledger is per-app and only statenour has one, so a
nickstire-only session still gets 3 of 5. The hook globs `apps/*/.remember/now.md`,
so creating that file is the whole fix if it is ever wanted — no code change. Not
done here: unasked, and an empty ledger is worse than none.

**What would falsify this.** If the next fresh session still greps a dozen files
before its first edit, the signpost is not being followed and the briefing line is
the thing to change — not the ledger.
