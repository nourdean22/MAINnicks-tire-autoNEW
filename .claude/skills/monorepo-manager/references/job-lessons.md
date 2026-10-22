# Job lessons (steps 2, 6, 11, 13 and 17)

Each rule below came from a real job. The step in SKILL.md names it; the incident is here.

## Step 6: record the dispatch time, and brief guards by identifying fields

- After dispatching, note the dispatch time (UTC) in your job notes (the session scratchpad); at step 17 it goes into the ledger
  row, which is written once as its post-merge truth ([ledger-and-metrics.md](ledger-and-metrics.md)), and the cycle time is computed from it. Three
  jobs on 2026-10-15 had cycle time UNKNOWN because nothing recorded the first dispatch, and the metrics rule forbids a guess.
- A brief for an approval or deny guard says the approved target matches IDENTIFYING fields only (ids), never any value in the
  call, and asks for a canary with the id inside a free-text field (PR 3193: an approved branch id in `name` let `update_branch`
  reach the production branch). The brief template carries this as GUARD RULE.

## Step 2: a vendor-portal job settles egress and device trust first

Before the spec, read the portal's egress and device-trust rules from where the code will run: one `curl -sI` from a datacenter
host and the login bundle's fingerprint calls. A VPN or datacenter block, or fingerprint trust, is a kill criterion. Kafene
(2026-10-18): two briefs and about 40 minutes went into a server-side client that its Cloudflare edge and browser-fingerprint
trust ruled out.

## Step 11: a vendor doc site

Try `<site>/llms.txt` and `<site>/docs/<slug>.md` before saving HTML; the primary quote comes from the `.md` file. Koalafi
(2026-10-19): 34 of 38 slugs came back as clean Markdown in two curl loops after the HTML path lost 11 pages. Send nothing to a
vendor's live API without a sandbox credential: the probe proves nothing and may create vendor-side records (the hosted apply page
creates an order on load). When a keyed client cannot be exercised, capture the contract and the build plan; do not ship a
dormant client, because it is tested only against your own reading of the docs.

## Step 13: where to push a lane branch from

A pre-push hook in another checkout proves nothing about the pushed ref: lefthook's `build:affected` ignores the ref on stdin and
builds the HEAD of the working tree it runs in. Pushing a lane branch from the primary therefore builds the primary's HEAD and can
pass while the lane's changes were never built. A harness lane worktree failed the hook with "'turbo' is not recognized" and
"node_modules missing" (2026-10-18). Push from one of two places, never `--no-verify`:

- a checkout whose HEAD is the lane tip and that has dependencies (a worktree with junctioned `node_modules`), so the hook builds
  what is pushed; or
- the hook-free clone (`AGENTS.md`: "If pre-push is blocked ... push from a hook-free clone"), and let CI carry the real gate.

## Step 17: copy the ledger headers, do not invent them

Copy the two table headers verbatim from an existing `docs/agent-os/ledger/*.md` (the metrics header is 8 cells). The file holds
exactly the ledger row and the metrics row, nothing else. Run `node --test scripts/agent-os/ledgerSplit.test.mjs` before
committing. On 2026-10-18 an invented header and prose rows failed the lane's pre-commit `agent-os verify` twice (about 9 minutes).

## Kept from the 2026-10-15 SKILL.md (moved here on 2026-10-22 so the router stays short)

Each line was a sentence of the old procedure; the step number is the new one.

- Step 6: lane worktrees branch from the default branch, not your HEAD: put any unmerged prerequisite in the brief or wait for it.
- Step 7: `check-lane-paths` also flags an AUTHORIZED exception as out of lane; compare each flagged file with the brief's PATH
  EXCEPTIONS before rejecting. A lane result whose lease expired or whose base moved is re-checked before use.
- Step 7: review fixes go back to the SAME lane with SendMessage; it resumes with its context. The same failure twice: name the
  doubtful assumption to Nour (and see benchmark B18: never re-dispatch unchanged).
- Step 7: a lane that builds a database tool needs a real-engine sandbox receipt before any operator-facing step ([verify.md](verify.md)).
- Step 13: prefer one push; run the DoD compiler and the app preflight on the INTEGRATION tip, never only on a lane branch (a lane
  branch cannot see requirements derived from client code).
- Step 17: a `session-observer` proposal goes in `docs/skill-proposals.md`; proposals only, Nour approves skill and policy edits.
