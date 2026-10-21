# Job lessons (steps 2, 5, 9, 11 and 15)

Each rule below came from a real job. The step in SKILL.md names it; the incident is here.

## Step 5: record the dispatch time, and brief guards by identifying fields

- After dispatching, write the dispatch time (UTC) into the ledger row's Next cell; step 15 computes cycle time from it. Three
  jobs on 2026-10-15 had cycle time UNKNOWN because nothing recorded the first dispatch, and the metrics rule forbids a guess.
- A brief for an approval or deny guard says the approved target matches IDENTIFYING fields only (ids), never any value in the
  call, and asks for a canary with the id inside a free-text field (PR 3193: an approved branch id in `name` let `update_branch`
  reach the production branch). The brief template carries this as GUARD RULE.

## Step 2: a vendor-portal job settles egress and device trust first

Before the spec, read the portal's egress and device-trust rules from where the code will run: one `curl -sI` from a datacenter
host and the login bundle's fingerprint calls. A VPN or datacenter block, or fingerprint trust, is a kill criterion. Kafene
(2026-10-18): two briefs and about 40 minutes went into a server-side client that its Cloudflare edge and browser-fingerprint
trust ruled out.

## Step 9: a vendor doc site

Try `<site>/llms.txt` and `<site>/docs/<slug>.md` before saving HTML; the primary quote comes from the `.md` file. Koalafi
(2026-10-19): 34 of 38 slugs came back as clean Markdown in two curl loops after the HTML path lost 11 pages. Send nothing to a
vendor's live API without a sandbox credential: the probe proves nothing and may create vendor-side records (the hosted apply page
creates an order on load). When a keyed client cannot be exercised, capture the contract and the build plan; do not ship a
dormant client, because it is tested only against your own reading of the docs.

## Step 11: push a lane branch from the primary checkout

`git push -u origin <branch>` from the primary pushes the local ref, and the pre-push hook runs where `node_modules` exists. From a
harness lane worktree it failed with "'turbo' is not recognized" and "node_modules missing" (2026-10-18), while the same branch
pushed from the primary in 1.5 s. Never `--no-verify` from the worktree.

## Step 15: copy the ledger headers, do not invent them

Copy the two table headers verbatim from an existing `docs/agent-os/ledger/*.md` (the metrics header is 8 cells). The file holds
exactly the ledger row and the metrics row, nothing else. Run `node --test scripts/agent-os/ledgerSplit.test.mjs` before
committing. On 2026-10-18 an invented header and prose rows failed the lane's pre-commit `agent-os verify` twice (about 9 minutes).
