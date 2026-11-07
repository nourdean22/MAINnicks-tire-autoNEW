# Shop OS 36: execution split (who builds what, where)

Answer first: the doc 32 build is four phases, each one PR series, each split into at most three sessions (server
lane, client lane, docs lane) with the server contract landing first. Pure-code lanes run as cloud sessions from a
pushed branch; anything that needs Chrome, a portal login, the ALG tab or a production read runs in a local worktree
on NATTYNOUR under the manager; the three PCs (NATTYNOUR, MECHANICS, NicksMax) take only the four allowlisted
read-only harness actions plus the on-counter verification of each phase; bdnick is the dispatch and status channel
(Nick as node `harness:nick`), not a build machine. Nothing in this doc starts until Nour says go (his words,
2026-11-07: the plan first, then "splitting up the work using the harness ... between the 3 comps cloud bdnick").

Sources: doc 32 (phases, screens, rules), doc 26 (objects), doc 30 (captures), docs 33 to 35 (terms, research and
supplier gates), `config/agent-os/harness-actions.json` (allowlist, read 2026-11-07), `docs/agent-os/MACHINE-SYNC.md`,
`.claude/skills/monorepo-manager/SKILL.md` (lanes, writers at once, RAM gate), root `AGENTS.md` (protected operations).

Ruling after this doc was written (Nour, 2026-11-07 13:30Z): the ledger is built, not bought (doc 37). Section 1
(where work can run) and section 3 (rules) stand; the lanes-per-phase table in section 2 is reshaped by doc 37's
phases and is kept here as the first cut, not the plan.

## 1. Where work can run

| Place | Runs | Cannot | Why (source) |
|---|---|---|---|
| Cloud session (fresh clone of a pushed branch) | server and client code with tests, docs, fixture-driven adapter work | portal or ALG captures, Chrome, production reads, anything needing a secret | agents get no prod credentials (AGENTS.md); a cloud checkout takes a lease first (`session-authority`) |
| NATTYNOUR local worktree (`scripts/worktree-setup.ps1`) | the manager, merges, portal and ALG captures in Chrome, `railway run` read-only probes, Perplexity research | a package install inside a junctioned worktree; two writers on one file set | AGENTS.md branching; `prod-db-guard`; memory `prod-readonly-probe-facts` |
| MECHANICS (shop counter PC) | on-counter verification of each phase behind its flag; the office camera lane it already runs | builds, installs, anything outside the four allowlisted actions when driven remotely | doc 32 s.3 "verified on the counter PC before the next starts"; `harness-actions.json` |
| NicksMax (lot PC) | the lot-vision lane only | any CRM build or verification | memory `nicksmax-job-2026-10-30`; no CRM role |
| bdnick (Nick as node) | dispatch an allowlisted action to a PC and read its result; status cards | run code, hold a worktree, extend its own allowlist | PR 3563: `POST /api/devices/harness/actions`, poller `harness-poll.mjs`; the allowlist is a repo file, changed only by PR with Nour's go |

Allowlisted PC actions today (all `needsGo: false`, all read-only): `pc-status`, `harness-snapshot-now`,
`bootstrap-check`, `health-line`. A phase that wants a PC to do more (open the counter build, run a smoke check on
the counter PC) adds one named action with fixed argv to `harness-actions.json` in its first PR; Nour approves that
PR before it is used. No action ever takes a shell or free argv (the file's own `$comment`).

## 2. Lanes per phase

Lane roster and paths are the manager skill's. Every lane gets one brief file (template
`.agents/core/templates/subagent-brief.md`), model and effort set, the SKILLS TO INVOKE FIRST lines from
`skill-recall.mjs --file`, and the three lines LOOP RULE, STANDARD, SIBLINGS. Two writers at once, never on the same
files; heavy builds one at a time through `heavy.mjs`; RAM gate before every start.

| Phase | Lane | Place | What it lands | Order |
|---|---|---|---|---|
| 0 prep | nickstire server | cloud | flip the two approved-by-default paths, the 10% gate against the originally authorized estimate, the Sheet push off for `/system`, the adapter UNKNOWN return (`gatewayClient.ts:251`); tests red-first | first |
| 0 prep | docs (lane-research, read-only) | cloud | the writer inventory (doc 34 row 8): every path that writes money or sends outside, with file:line; the refund-writeback log read is NATTYNOUR work (needs `railway run`) | with server |
| 1 read | nickstire server | cloud | mirror read endpoints for counter search and the board; work-order state on the built tables; `arrivedAt` + blocker owner (doc 34 row 2) | first |
| 1 read | nickstire client | cloud, after the server contract is on the branch | `/system` counter search, `/system/board`, `/system/tv` (read-only render of Today), money bar; `SHOP_OS_PHASE_1` flag | second |
| 1 read | verification | MECHANICS, by Nour or the crew, flag on | the week-2 read in doc 32 s.4; counter searches per shop day, TV open during hours | last |
| 2 quote | nickstire server | cloud | `Quote` (with `deposit`, `partsEta`), `SellPriceRule`, `DeclineReason`, 3-day reminder; the `used_tire.warranty` seed gains the written-exception qualifier (doc 33 s.4); rule 9 no phone-only merge | first |
| 2 quote | nickstire client | cloud | `/system/quote` card reading `new_tire.warranty` and `used_tire.warranty` from the fact store; `SHOP_OS_PHASE_2` | second |
| 2 quote | Nour | his phone | decision 5: the quote text template; the text goes live only on his go (rule 5) | gate |
| 3 source | nickstire server | NATTYNOUR for captures, cloud for the adapters against doc 30 fixtures | supplier adapters on the doc 26 offer contract; the 3568 vs 3571 bake-off on fixtures; the doc 35 P0 items (truthful arrival from `readCutoff`, cost leak, retail-as-cost) | first |
| 3 source | nickstire client | cloud | sourcing drawer `/system/ro/:id`, `SupplierOrderDraft` as a PO a person clicks; `SHOP_OS_PHASE_3` | second |
| 4 yes | nickstire server | cloud | approval token on `/approve/:token` extending `/inspection/:token`, frozen lines, collapsed Terms from the `web` constant, decline reasons with the recommendation id into follow-up, pickup text template | first |
| 4 yes | nickstire client | cloud | `/system/tech` phone view, the approval page; `SHOP_OS_PHASE_4` | second |
| 4 yes | Nour | his phone | decision 5 templates (approval, pickup); counsel read of the intake and approval text (spend) before the flag goes on | gate |
| 4 yes | verification | MECHANICS plus one shop day with Nour off the counter | doc 32 s.4 phase-4 read and the owner-away day (doc 34 row 16) | last |

Nothing here needs a schema change that is not already in doc 26; any that appears routes through
`nickstire-tidb-ddl` and is hand-applied, never by a cloud session.

## 3. Rules that do not change with the split

1. One integration branch and one PR per phase step; lane commits cherry-picked onto current origin/main; gates run on
   the combined tree (manager step 13). One validated push per PR.
2. The server contract (types, endpoints, env names) lands before its client consumer; the consumer brief names the
   version it builds against (manager step 4).
3. A cloud session starts from the pushed integration branch, takes its lease, and pushes its own commits; the manager
   reads the real diff and `check-lane-paths.mjs` before anything is relayed to Nour (steps 7 and 8).
4. Customer sends, production writes, Railway config and the harness allowlist stay protected operations: per-action
   go from Nour, performed by the manager, never by a lane or a PC poller.
5. Each phase's kill read (doc 32 s.4) is written in its first PR; a red kill read turns the flag off and the next
   phase waits.

## 4. Before the split can start

- Nour's go on the build itself, and on the order (phase 0 first).
- Doc 32 s.7 decisions 1, 1b, 2b and 5; the defaults in doc 32 apply when he says nothing.
- A current `heavy.mjs status` read on NATTYNOUR (RAM gate) and a `harness-run.mjs --pc mechanics --action pc-status`
  round trip, so the counter PC is known reachable before phase 1 verification is planned on it.
- The GitHub repo is public (memory `security-public-repo-credential-leak`): no cloud brief carries a secret, an
  account number or a customer identifier.

Not in this doc: lane briefs themselves (written per phase on the go), estimates beyond doc 32's build times, and any
claim that a PC or cloud session has been tried for this work (none has). live: not checked this turn.
