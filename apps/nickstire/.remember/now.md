# Session ledger - nickstire

**Updated: 2026-09-16** (Outbound-consent sweep, all three channels + the gates that were scanning
nothing + the gate that was never wired. #2361 `34d53af5c` + #2363 `e94ab8998` + #2371 `46e3194f4` MERGED
and DEPLOYED; **#2374 open** — `lint:pii` becomes a pre-commit gate and the consent contract finally lands
in CURRENT-TRUTH / truth_os / the capability ledger instead of living only in PR bodies.)

## 2026-09-16 · Outbound consent, and the gates that reported success over unread files

### Consent — two voice lanes were calling people who had opted out

`server/cron/jobs/voiceRecovery.ts` and `server/cron/jobs/followupCadence.ts` each derived their OWN
do-not-contact set: a local `customers.smsOptOut`-only query inside a fail-soft catch. That missed
`sms_preferences` (what `persistOptOutPreference` writes), the inbound STOP log and carrier blocks — and an
unreadable list produced an EMPTY set, i.e. "nobody opted out", so every candidate was contacted. followupCadence
announced it in its own log line: `opt-out query failed (proceeding without)`. Same failure `sms.ts` records with
verified harm on 2026-07-20.

Both now consume `loadSuppressionIndex()` (exported from `server/sms.ts`) and refuse BOTH `ok:false` and
`stale`. **`stale` was the subtle one** (Codex P1, correct): `sms.ts`'s `stale()` hands back `optOutCache`
without ever consulting `optOutCacheLoadedAt`, so a stale snapshot's age is UNBOUNDED — it is NOT the 5-minute
TTL, which is the fresh path. SMS deliberately keeps the opposite bar and a test pins that asymmetry: a text is
cheap and reversible, an unwanted call is neither.

★ **I shipped the first lane before sweeping, and that is how the second was missed.** The sweep is now mechanical:
`server/cron/jobs/voiceLanes.suppression.test.ts` enumerates every file under `server/cron/jobs` that CALLS
`placeVapiOutboundCall(` and fails any that does not CALL `loadSuppressionIndex(`, with one allowlisted
exception carrying its reason; it also bans reading `customers.smsOptOut` directly, requires the enumeration to
find >= 3 lanes, and requires every allowlist entry to still dial. A per-lane test proves the lane it names; only
an enumeration proves there is no lane nobody named.

⚠ **Two of my own sweep guards were satisfied by COMMENTS mentioning the banned symbol, and only the mutation
showed it.** A source-scanning guard must match a CALL EXPRESSION on COMMENT-STRIPPED source, never a bare
substring. `stripComments` shape: `server/nonCustomerFilter.test.ts`.

**SMS needs no sweep** — all ~30 callers go through `sendSms`, which consults the index centrally. One gate, which
is the architecture the voice lanes lacked.

### The gates: three staged-diff readers scanned ZERO files on every commit

`git commit` exports `GIT_DIR` (absolute) and no `GIT_WORK_TREE` to hooks; `lefthook.yml` runs each job with
`root: "apps/<app>"`; with `GIT_DIR` set and `GIT_WORK_TREE` unset git treats CWD as the work-tree root. So every
per-file pathspec and every `--show-toplevel` answered the wrong root — and each gate rendered the miss as a PASS.
A planted `AKIA…` key and a banned customer claim both committed cleanly. `scan-secrets` even printed
"scanned 1 files" about a file it never opened (the count was taken before the skip).

**Reproduce any staged-diff gate's blindness in one line**, from an app dir with something staged:
`GIT_DIR=$(git rev-parse --absolute-git-dir) pnpm run <gate>` versus the same without it.

Fixed in all three (`lint-brand-voice.ts`, `lint-pii.mjs`, `apps/statenour/scripts/scan-secrets.ts`) by deleting
`GIT_DIR`/`GIT_WORK_TREE` from the child env — **keeping `GIT_INDEX_FILE`**, which is what makes a PARTIAL commit
gate the bytes actually being committed. Plus a root-cause-independent invariant: a changed in-scope file whose own
per-file diff is EMPTY is UNREADABLE, not clean. Plus: CI ran brand-voice BARE on a checkout that stages nothing, so
it scanned 0 every run — now `--range origin/main` (three-dot). Plus: `scan-secrets --staged` read the WORKING
TREE, so `git add` a key then edit it out and the secret committed unscanned — it now reads `git show :<path>`.

★ **Any canary for a gate that shells out to git must run TWICE — clean, and under a VALID `GIT_DIR`.** The old
canary already used `GIT_DIR`, pointed at a NONEXISTENT path, so git failed loudly; a valid one is the dangerous
input, because git succeeds and answers the wrong question. That is why every pre-existing test passed throughout.

★ **Safe canary technique:** stage into a throwaway `GIT_INDEX_FILE` seeded from HEAD and write the probe in as a
blob (`hash-object -w` + `update-index --cacheinfo`). The real index is never opened and a crash cannot strand a
fake key or a banned claim in the tree.

⚠ **A `\u0000` escape authored through a Write/Edit payload reaches disk as a RAW NUL byte** (the payload is JSON,
so it is decoded first). One NUL makes the whole file read as BINARY and every text lint skips it silently;
`apps/statenour/tests/repo/source-files-are-text.test.ts` catches it. Describing the byte in a comment
reintroduced it once — name the code point, never spell it, and check bytes:
`node -e 'console.log(require("fs").readFileSync(F).indexOf(0))'` (-1 = clean). And run the app's whole
`tests/repo/` directory, not just your own file — those are whole-tree invariants any new file can trip.

**POST-MERGE RECEIPT, on `main` under the real hook env:** brand-voice caught a planted `cliche.trusted`
(exit 1) · scan-secrets caught a planted `AKIA…` key (exit 1) · the ALLOW control passed with `1 file(s)
scanned`, not 0.

### Operator decisions — ANSWERED 2026-09-16, and what they changed

The operator resolved two of the three, and the reasoning is worth keeping because it is what
settles the question rather than a legal argument:

> "weare first come first serve so it can confirm they are gonna come but no holding spots.
>  email lines we really arent emailing ppl right now but u can do it to. also i need the opt
>  outs to work too email, txt"

1. **`confirmationCalls.ts` — GATED.** FCFS was the whole answer: the shop holds no slot, so there
   is no reservation to confirm and nothing the customer forfeits. The transactional defence needed
   a held appointment and there isn't one. ⚠ If the shop ever starts holding real slots, revisit —
   the business fact makes the answer, not the cron's name.
2. **Both EMAIL lanes — GATED.** `emailCampaigns.ts` was reading 1 of the 4 sources (never
   fail-open: the condition sat in a WHERE clause); `dripProcessor.ts`'s email step checked nothing
   at all. Cross-channel suppression is OVER-suppression (TCPA STOP governs calls/texts, CAN-SPAM
   governs email) and the operator asked for it explicitly — and emailCampaigns had already made
   that choice implicitly by filtering on `smsOptOut`, so it is the same policy completely applied.
3. **`lint:pii` wiring — STILL OPEN.** It runs in `verify` and CI but sits in no git hook, so a
   commit is never gated on PII.

### A FOURTH lane existed, and my own sweep could not see it

`makeFollowUpCall` in `server/routers/vapi.ts` POSTs straight to `https://api.vapi.ai/call` with a
raw `fetch`. My guard keyed on the `placeVapiOutboundCall(` helper and scanned only
`server/cron/jobs`, so it was invisible — and I had written that "a fourth lane cannot be missed".
**That claim was false and is now corrected in the source.** Found by sweeping the PROVIDER rather
than the helper, which is the same move that found the second lane, applied one level up.

★ It is `adminProcedure`, so its contract DIFFERS on purpose: a cron skips a suppressed number
silently because nobody is listening; an operator pressed a button, so it **refuses and says why**.
A silent no-op reads as a broken button and gets pressed again. No override flag, deliberately.

★ **A behavioural test caught an ordering flaw in my own fix:** the guard was first placed after the
`/phone-number` lookup, i.e. after a VAPI round-trip. A consent refusal must not depend on a third
party being reachable. Moved ahead of all network work.

### The sweep, as it now stands

`server/cron/jobs/outboundLanes.suppression.test.ts` (renamed from `voiceLanes.*` — it spans
channels now) walks `server/**` and matches all three dial shapes: the helper, a raw
`api.vapi.ai/call` with no `/` or `?` after it (that lookahead is what separates the dial from the
FIVE read-only `/call/<id>` and `/call?limit=` sites), and `vapiFetch("/call")`. It says out loud
what it still cannot see — a new spelling — and answers that with an **inventory pin**: the set of
files touching the VAPI API at all is fixed, so a new one fails and a human must classify it as a
read or a dial. Same shape for email senders. **The allowlist is now EMPTY.**

### Corrections to things I asserted earlier this session

- "a fourth lane cannot be missed" — **false**, see above.
- "`emailCampaigns` has no feature flag, live whenever `RESEND_API_KEY` is set" — **false**. It is
  gated by `email_marketing_campaigns`, and a prior session's comment records that flag as ENABLED
  in production. The lane is armed, not dormant: worse than I said, not better.
- "`.remember` is gitignored and diverges per worktree" — **false**. The file IS tracked; the
  PRIMARY checkout was simply parked on a stale branch (`statenour/nextjs-critical-rce-advisory`).
  ⚠ A background task was spawned on that wrong premise and had already been started — it should be
  stopped rather than acted on.

### Still missing, named so nobody reads the sweep as complete

- An **email unsubscribe** is a `mailto:unsubscribe@nickstire.org` and is recorded NOWHERE
  machine-readable. Someone who unsubscribed by email and never texted STOP is in no index.
- `lint:brand-voice`'s `IN_SCOPE` does not cover the customer-facing email templates in
  `services/emailCampaigns.ts`, so that copy is claim-checked by no gate.

**Previous header — Updated: 2026-09-16** (Dream-to-Proof waves 2-3 + follow-ups SHIPPED:
#2330/#2334/#2335/#2336/#2340/#2342/#2343 — kernel calibrated + GrowthBook cross-checked, Night Shift identity
fail-closed, hidden holdout armed and posting, capability ledger current. Nothing of mine open.)

### #2374 — the PII gate was never wired, and the consent work was never written down

Two halves of one operator line: *"Did u do the docs n u can do the wiring too then wrap it up."*

**The docs half had to be answered NO first.** #2361/#2371 shipped real production behaviour and touched
none of the three sources this repo tells agents to trust. Now: `docs/CURRENT-TRUTH.md` gains an **Outbound
consent** operating contract beside the outbound-SMS one; `truth_os.md` gains a dated ship entry (its own
AGENTS.md header says "updated on every ship" and three prod PRs had skipped it); and the capability ledger
gains `outbound-consent-one-index`.

★ **The ledger checker refused my first claim and was right.** I wrote `exposure: production` — the lanes do
run in prod against real customers. It exited 1: *exposure production requires operationalState >=
live_verified*. In that ledger **`exposure` is a claim about VERIFIED REACH**, not about which environment the
code sits in, and `live_verified` needs `liveRuns`/`databaseAssertions` — which do not exist, because **no
real `ok:false` or `stale:true` has been observed firing in production**. Landed `deployed @ internal`
(precedent: `boundary-enforcement`), promotion condition written INTO the row. `REALITY-LEDGER.md` is
RENDERED — run `scripts/render-reality-ledger.mjs`, never hand-edit.

**The wiring half.** `lint:pii` was in `pnpm run verify` and CI but in NO lefthook job, so its pre-commit mode
never ran at commit time. Now `nickstire-lint-pii` (`root: apps/nickstire`, glob `**/*.{ts,tsx,mjs,js}`).
Measured BEFORE wiring: ~800ms pre-commit, ~770ms audit fallback over 919 files, 1.05-1.10s in the real hook;
**1 block in the last 120 commits** touching `server/`, and that one was a **TRUE positive**. `main` clean at
919 files / 0 violations.

★★ **The canary is the reusable asset** — `server/lintPiiHookWiring.test.ts`, 12 tests, every one driving the
real script end-to-end and asserting the RULE TEXT (a nonzero exit is not proof; a config error exits nonzero
too). Three properties, each of which one of my own drafts got wrong:
1. **It runs TWICE — clean env AND under a valid `GIT_DIR`.** M23 (restore the fail-open) → **6 red, 5 green,
   and the 5 include the clean-env control.** That is exactly why the #2363 blindness survived for months.
2. **Mode is ASSERTED.** The script silently falls back to non-blocking AUDIT mode when nothing in scope is
   staged, so a harness that staged nothing prints a green receipt over ~900 files and every "clean"
   assertion passes vacuously. Every test pins the literal `(pre-commit)` label.
3. **The glob is extension-only ON PURPOSE** — a directory glob would be a SECOND definition of scope, free to
   drift from the script's `IN_SCOPE`. The cost is an audit fallback on client-only commits, which a test now
   proves cannot block and labels itself `(audit)`. Do not "optimize" it into a directory glob.

⚠ **Traps for the next session.** (a) The `// pii-allow:` waiver is **line-level, on the offending line** —
"waive by SIGNATURE, never by filename" — and a second violation elsewhere in the same file still blocks.
(b) `pre-commit:` is the **FIRST line** of `lefthook.yml`, so slicing that block on a preceding newline
returns -1 and `slice(-1, …)` yields `""`; assert block bounds before reading out of them.
(c) **`docs/agent-audit/CONTROL-CANARY-COVERAGE.md` derives numbers FROM the repo and `coverage-doc.test.mjs`
enforces them** — adding a tenth pre-commit job staled two counts and turned CI red. Reconcile the row, the
Total, AND every stated percentage (it checks all of them, not just the table's).
(d) Probe phone numbers in that canary must NOT be 555 (exempt by NANP reservation, which would make every
deny assertion vacuous), so the file depends on `.test.ts` staying OUT of `lint:pii`'s scope.

**Fixed in passing:** `services/nonCustomerFilter.ts` claimed unformatted storage dodges the Cleveland-phone
pattern. False — the separators are optional, so `2168488888` matches as readily as the dashed form; the
`// pii-allow:` marker is what silences it. Verified against the regex directly.

**Still open, reported not fixed:** an email unsubscribe is a `mailto:` recorded nowhere machine-readable, so
the index cannot see an email-only revocation; and `lint:brand-voice` does not scope the customer-facing email
templates in `emailCampaigns.ts`. Both are P2 rows on the new ledger entry.

## 2026-09-15/16 · Proof lane: what is live, what still needs a human

**Live:** `.github/workflows/nickstire-proof.yml` runs post-deploy + daily against the LIVE site, waits for `/api/health`
`deploy.commit`, replays the five visible episodes (`tests/episodes/*.json`) and then the HIDDEN holdout (secret
`HOLDOUT_EPISODES_B64`, six `HO-xxx` episodes, plain copy at `~/.nourcity-holdout/holdout-episodes.json` — never in the
tree; unpacked to `$RUNNER_TEMP`, id-only titles, nothing uploaded), and posts `proof.run` + `proof.holdout` (ids +
counts only; `unmeasured` when the secret is absent). First real receipt 2026-09-15 23:41Z: `evidence: 200 — 2 event(s),
holdout success` on live commit `4cb7dbf4d`. The experiment kernel's H4 rests on a MEASURED rule (`pnpm calibrate:kernel`;
GrowthBook gbstats 0.8.0 agrees run-for-run). Night Shift: `scripts/night-shift/run.ps1` fails CLOSED until
`NIGHT_SHIFT_GH_TOKEN` names a separate read-collaborator identity (fork flow; Free plan has no rulesets).
**Blocker (operator):** create the machine GitHub account + classic `repo` token; create `EVIDENCE_LEDGER_KEY`
(the lane posts through the bridge key until then). **Next:** grow the holdout from `proof.episode_failed` events and
incidents, never from the visible set; a visible-green / holdout-red run is the overfitting signal. Traps: `pnpm exec
playwright` is silent from a harness worktree (call `node node_modules/@playwright/test/cli.js`); the shop strip's
open/closed line is split across two spans (match the leaf); most routes' prerendered HTML is the SPA shell — probe with a
real browser, not curl.

**Previous header — Updated: 2026-09-11** (CLOSED — GSC Page Indexing report fully triaged, all 8 buckets. Four PRs
merged and deployed: #2321 `d707602f9` (guides sitemap gap) · #2322 `e1383501f` (62 orphaned
neighborhoods registered) · #2323 `106f97862` (109 remaining thin neighborhoods enriched + all 121
indexed + dead blog URL redirected) · #2324 `5688da6c5` (docs, ROS-111 closed). Sitemap resubmitted
in GSC via real Chrome (confirmed "Sitemap submitted successfully"). Nothing of mine open.)

## 2026-09-11 · GSC Page Indexing triage, full arc — 150 indexed / 129 not, 8 buckets

**Root cause of the two biggest un-triaged buckets** (Crawled-not-indexed 46, Duplicate-canonical
4): 62 of 121 `shared/neighborhoods.ts` entries had NO `shared/routes.ts` registration — `App.tsx`
rendered them client-side via `NEIGHBORHOODS.map()` but a fresh server request 404'd, and
`AreasServed.tsx` linked all of them unfiltered (62/116 dead links, 53%). Operator decision (given
twice, explicitly: "register those 62... maximize traffic" then "knock those out too"): register
all 62 rather than trim the links, THEN go further and index every neighborhood, not just the
12 already-enriched "on-corridor" ones.

**Scope correction I owe a note to future-me:** after registering the 62 I first reported "~49
thin neighborhoods remain" — wrong, I'd only counted the ones I personally registered that
session minus the 12 already-enriched, forgetting 47 more that were already thin before I
started. Real number was **109**. Caught and corrected before shipping, not after.

**What shipped:** all 121 neighborhoods now registered + prerendered + sitemapped +
`indexed:true`, content genuinely expanded (~150-250 chars → ~625-820 chars per page, not just
flag-flipped), verified brand-voice-clean via the REAL `findVoiceViolations()` — **the automated
`lint:brand-voice` gate does not scan `shared/neighborhoods.ts` at all** (not in
`brandVoiceScope.ts`'s `IN_SCOPE` list; prints "0 file(s) scanned · ok" even when this exact file
is staged and full of violations). That scope gap is still open — flag it if anyone asks why the
gate went green on customer-facing content. `/blog/check-engine-light-guide` (dead article record,
still serving a 200 SPA shell because `/blog/:slug` matches `DYNAMIC_ROUTE_PREFIXES` regardless of
a real article backing it) now 301s to `/diagnostics`.

**A real bug I shipped-then-caught in the same session:** refactoring the consistency test's
canary to inject synthetic overrides (`neighborhoodIndexIssues(n, overrides)`) broke the existing
`NEIGHBORHOODS.flatMap(neighborhoodIndexIssues)` call — flatMap passes `(element, index, array)`,
so the array index silently arrived as `overrides`, the classic `.map(parseInt)` footgun. Only
surfaced once the regenerated snapshots made that code path execute for real (`"snapshot" in 1`
threw). Fixed with a wrapping arrow before merge; all 7 tests green after.

**All 8 GSC buckets, final state:** Excluded-by-noindex 47 = not a defect (0 in sitemap). Crawled-
not-indexed 46 + Duplicate-canonical 4 = fixed as above. Soft 404 17 = validating, expected to
clear (9 real content, 8 verified 301s). Blocked-by-robots.txt 4 = benign. Page-with-redirect 3,
Alternate-canonical 2 = benign by definition. Discovered-not-indexed 6 = Google's own crawl queue,
no action available.

**Mechanics for next time:** prerender regen via `gh workflow run prerender-refresh.yml --ref
<branch>`, poll with a real Bash `run_in_background` sleep-loop (NOT ScheduleWakeup — repeatedly
under-counted real elapsed time this session, confirmed against GitHub's own `Date:` header). The
regen commit carries `[skip ci]` in its own message natively — the retrigger commit after it must
NOT contain that literal string anywhere, even inside a sentence describing the problem.

## 2026-09-10 (final) - what shipped, in one place

`5946e7dfa` #2266 fail-open slices, careers job pages, GSC aggregation, 48h SLA alarm, forfeit writer
`a40390ce4` #2268 unpublish three cloaking JobPosting artifacts from main
`7d4e8e3c3` #2272 referral history renders the recorded REASON, not just actor+timestamp
`bce954277` #2274 native-dialog CI gate was blind to 39 client files + subject-coverage test
`8db199805` #2276 refusal reasons captured via chips, not a canned string
`9125ec7fa` #2277 those chips were half the documented 48px touch minimum
`c72b38ddc` #2278 client-file detector read 400 chars and missed 9 files
`37bcf49bd` #2279 unread badge / reminder stats: DB-down is not zero
`e79222e9d` #2281 fabricated-read RATCHET (pair-based, refuses to grow)
`54e7d5958` #2282 bookings + PUBLIC customer lookup: DB-down is not "no such booking"

**THE ONE DEFECT SHAPE**, in seven disguises, six of them in this session's own work: an instrument
measuring something other than its subject. A workflow whose --ref chose the code but not the
destination. Two tests re-implementing what they tested (one the clientIp SECURITY control, whose
copy omitted the IPv6 /64 normalisation). A knip entry keyed on the label the gate PRINTS rather
than the null it STORES, leaving the exemption inert. A gitleaks regex aimed at the source line when
regexTarget="match" applies it to captured text. A dialog gate blind to a 100%-client directory. A
client detector reading 400 characters. Three CI monitors piping to a jq that is not installed.
RULE: if a gate contains a RESTATEMENT of what it guards, ask what happens when the original
changes. If the answer is "nothing", it is a proxy - import the real symbol, then MUTATE IT.

**STILL OPEN, for the operator:**
- `disqualify` has no eligibleAt guard. DELIBERATE: fraud found on day 95 must stay actionable.
- 30 fabricated-read pairs, RATCHETED not forgotten. `node scripts/update-fabricated-read-baseline.mjs`
  after each fix; it refuses to raise the count.
- `apps/nickstire/.env.example` carries an UNSTAGED 29-line deletion of the REEL_FILM_GRAIN block,
  NOT mine, dirty since before this session. That flag is LIVE (reelAssembly.ts:573,
  FILM_GRAIN_STRENGTH = 8), so it is a doc regression for working code.

**ENVIRONMENT:** standalone `jq` was absent - installed 1.8.2, copied to C:/Users/nourd/bin/jq.exe
(winget upgrades will NOT propagate to that copy). tsconfig.json excludes `**/*.test.ts` but NOT
`.test.tsx`, so a broken .test.ts exits `pnpm run check` GREEN - now in apps/nickstire/AGENTS.md.
`git show <ref>:<dotfile-path>` MANGLES under MSYS; use PowerShell for those reads.

## 2026-09-10 · fail-open source slices, careers job pages, and a live cloaking incident I caused

**SHIPPED:** #2266 (squash `5946e7dfa`, 17 commits) · #2268 (`a40390ce4`) · #2272 (`7d4e8e3c3`).

**THE INCIDENT, because it will happen again to whoever forgets.** I dispatched
`prerender-refresh.yml` with `--ref nickstire/fail-open-source-slices`. The ref chose the CODE and had
no say over the DESTINATION - every git command in its commit step named the literal `main` - so it
rendered that branch's `/careers/<slug>` routes and pushed the artifacts to main, which had no such
routes and no `JobPage.tsx`. `server/prerender-middleware.ts:147,150` resolves prerendered HTML by
FILE EXISTENCE alone, with no routes-manifest check, so the pages WERE served. Measured live on one
URL: **Googlebot 200 / 53,813 bytes / full JobPosting, Chrome 404 / "Page Not Found"** - cloaking by
Google's own definition, on a job posting. #2268 removed the three artifacts (both UAs 404), #2266
then landed the routes AND artifacts together so the pages became real (both UAs 200, verified in a
browser). Root cause fixed in #2266: `TARGET_BRANCH: ${{ github.ref_name }}`.
**A green "Prerender refresh" reads identically whether it wrote where you asked or to main - read
the push refspec in the log, not the job conclusion.** `[skip ci]` skips workflows, NOT the Railway deploy.

**Defect shape that dominated the day: an instrument measuring something other than its subject.**
Two tests in `rateLimitBypass.test.ts` re-implemented what they tested (the tRPC batch guard, and
`clientIp` - a SECURITY control whose copy silently omitted the IPv6 /64 normalisation). A knip
baseline entry was keyed on `"(whole file)"`, the label the gate PRINTS, where it STORES `symbol:
null`. A gitleaks allowlist regex was written against the source line when `regexTarget = "match"`
applies it to the captured text. Three CI-watch Monitors piped to a `jq` that is not installed and
silently reported nothing. Each looked correct in review and could never fire.
Extract and import the real symbol, then MUTATE THE REAL ONE to prove the test fires.

**Also landed:** the 48-hour /careers SLA alarm (badge in the panel HEADER, deliberately not behind
the collapse - the collapse WAS the original defect); `forfeited` gained a writer, with an
`eligibleAt` guard so an EARNED $300 cannot be refused; the `$300` audit trail became readable
(4 writers, 0 readers - `getAuditTrail` had sat with zero callers, baselined as "not individually
reviewed") and now renders the recorded REASON, not just actor and timestamp.

**OPEN, for the operator:**
- `disqualify` has no `eligibleAt` guard. Deliberate: fraud found on day 95 must stay actionable.
- Both `disqualify` and `markForfeited` send a CANNED reason string, not operator-typed text.
  `ConfirmDialog` cannot capture free text; `window.prompt` is banned in `client/src` (iOS standalone
  suppresses it silently). Needs a dialog input - that is the next real improvement here.
- `apps/nickstire/.env.example` carries an UNSTAGED 29-line deletion of the `REEL_FILM_GRAIN` block,
  dirty since before 2026-09-10 and NOT mine. That flag is LIVE (`reelAssembly.ts:573`,
  `FILM_GRAIN_STRENGTH = 8`), so the deletion is a doc regression for working code, and the block
  held measured cost data (1.18x at strength 8, 6.40x at 12). Left untouched - sibling session's tree.

**Environment:** standalone `jq` was absent; installed 1.8.2 and copied to `C:/Users/nourd/bin/jq.exe`
(on the Bash tool's PATH). `winget upgrade jq` will NOT propagate to that copy. `tsconfig.json`
excludes `**/*.test.ts` (not `.test.tsx`), so a broken test file exits `pnpm run check` GREEN - now
documented in `apps/nickstire/AGENTS.md`.

## 2026-09-09 · admin Lot section + camera vision audit wave

**What is in #2238 for this app:** the `lot` admin section (registry `priority: 12` — a 15/15 collision
with `approvals` was caught before commit), the `POST /api/camera/visits` ingest, migration
`0119_vehicle_visits`, and the plate-safety rules (only a CONFIRMED read is durable; a CONFUSABLE_UNIQUE
or AMBIGUOUS match is never auto-bound to a customer).

**Two defects CI caught that a local run could not.** This branch was pushed from a hookless sparse
clone with no `node_modules`, so nickstire's vitest cannot run here at all. Pointing the PRIMARY
checkout's vitest at this tree via an ad-hoc config does NOT work either — vite fails to load any
module across the two roots, including files that demonstrably exist. Do not spend time retrying that;
push and let CI gate, which is what the root AGENTS.md already prescribes.
  1. `adminRegistryTruth.test.ts` keeps a HARDCODED `LEGACY_ROLE_SECTIONS` list (it pins that role
     access survived the 2026-08-03 registry unification). A new section must be added to it
     deliberately: CI failed with `expected [ 'approvals', ...(19) ] to deeply equal [ ...(18) ]`.
     Its comment also demands the second half — check `permissionForAdminProcedure` for every
     procedure the page calls. Done, not assumed: `lot` is `FULL_ACCESS` (owner + manager), `lot.*`
     resolves to `settings.manage`, and both roles hold it, so neither gets a door it cannot walk
     through (the trafficFunnel failure the comment cites). `commandPaletteRoleTruth.test.ts` derives
     from `ADMIN_REGISTRY.length` and needed nothing.
  2. The live `operator-walkthrough` completion evidence said the section is visible to "all admin
     roles". False, and false in the direction that matters — it OVERSTATED who can see plate text and
     who is physically on the property. Corrected to owner + manager with the permission named.

**⚠ CI SILENTLY NEVER FIRES on this branch.** Two consecutive pushes produced `total_count: 0`
check-runs and NO workflow run object at all (`gh run list` shows nothing for those SHAs). Second
occurrence this session. Cure: `gh workflow run "<name>" --ref nickstire/admin-lot-camera-truth`.
"Completion Authority" and "Secret Scanning" have no `workflow_dispatch` trigger (HTTP 422) — they only
run on PR events. **An empty check list is NOT "all green"**: any CI poller needs a minimum-count guard,
mine declared "ALL TERMINAL" on zero checks.

**⚠ Two RED checks on every PR are NOT ours.** `security` fails because `next@16.2.11` carries two
CRITICAL RCE advisories (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4; both `<16.3.3`) — statenour's dep,
and `apps/statenour/package.json:132` already declares `^16.2.11`, a caret that ALREADY permits the fix,
so only `pnpm-lock.yaml` pins it back. `knip orphan gate` says of itself "reports failure on an
unmodified tree - the gate is stuck red", with new orphans in `server/middleware/securityHeaders.ts`,
`server/cron/index.ts`, `server/services/reelPipeline.ts`, `client/src/lib/facelessReelStudio.ts` — same
shape as the 2026-09-08 unstick below, different orphans.

**Merge conflict resolved 2026-09-09:** main moved under this branch. `server/_core/index.ts` auto-merged;
`.completion/evidence.json` needed a 3-WAY UNION, not a pick — both sides had added
`-superseded-2026-09-09` keys. Resolution: start from main so no sibling entry is dropped, overlay only
the keys this branch changed vs the merge base (verified main had NOT touched the two live rolling keys).
143 base / 145 ours / 148 theirs -> 150 merged, zero main entries lost.

**DONE — migration `0119_vehicle_visits` APPLIED to prod TiDB 2026-09-09**, on the operator's explicit
instruction (it is a protected operation and was not taken on agent initiative). Receipts: table did not
exist before, created with **25 columns**, 0 rows, recorded in `__drizzle_migrations` with sha256
`8c5e16b9a94d9454...` and `created_at` = the journal's `when` (1789300000000), exactly as
`scripts/db-migrate.ts` would; `reconcile-migrations.mjs --strict` -> **no blocking drift**. Target was
confirmed by printing the HOST only: `gateway01.us-east-1.prod.aws.tidbcloud.com:4000`.

**How, because the obvious routes do not work here.** There is NO local `.env`/`DATABASE_URL` in the
primary checkout OR in a `git worktree add` worktree (only `worktree-setup.ps1` copies one), and
`vehicle_visits` is NOT among the statements inlined in `handleRunMigrations()`, so the admin-tRPC
"Chrome path" would have needed a code change plus a deploy first. What worked: a THROWAWAY scoped
runner executed as `railway run -s MAINnicks-tire-auto -- pnpm exec tsx <script>` — the short form the
auto-mode classifier allows, and it injects the real environment so no credential is ever pasted into a
command. The runner was dry-run BY DEFAULT with the guard gating `mysql.createConnection` itself (not
merely logging), refused to proceed if the file contained a destructive verb, and was deleted after the
apply per the runbook.

**Verified live in Chrome:** the Lot section flipped from the red "Lot counters unavailable — this is not
an empty lot" banner to **"Awaiting first event"**. That is the empty-vs-error distinction working in
production: the table now exists and is genuinely empty, which is a different fact from a failed read.

**What is still missing is a PRODUCER, not the schema.** The floor board's vehicle cards stay hidden
until a real visit arrives (deliberately — an empty shell is worse than an honest empty state), and the
cameras are unreachable from the laptop, so a producer has to run on the shop machine.

**Updated: 2026-09-08** (CLOSED OUT 07:00 UTC — five PRs merged and live: #2182 `081f517f7` · #2187 `829067f76` ·
#2190 `3ce3c68dd` · #2192 `0cbe534ed` · #2194 `1a64afd4d`; main CI green; snapshot refresh run 34217365307 from
`0cbe534ed` was still running. Next session starts from `docs/QUALITY-PROGRAM-2026-09-07.md` "Final state" + §13
owner items. Earlier the same day: release closure on `nickstire/release-closure-2026-09-08` after an outside review of the
merged program — see the first section; 2026-09-07 evening — public-site + admin quality program on branch
`claude/nicks-tire-quality-audit-544da2` · earlier the same day: admin Phase 1 shipped to PR #2163 ·
brand-voice debt pass · 0112 verified ALREADY applied · prerender found already current · reel
routine disabled. Prior arc 2026-09-03 below.)

## 2026-09-09 · reel pipeline — the wrong metric, three dead lanes, and one screen

**Separate session from the Lot/camera work above; no overlapping files.** Merged
`562681607`, `c8880ee0b`, `09abf1e23`, `77c4ab9d7`, all content-verified on main
and confirmed serving.

**READ THIS BEFORE OPTIMISING FOR SAVES.** Saves are NOT a Reels ranking input —
Meta's own list has nine Reels predictions and saves is not among them (it belongs
to Explore). This account had been judged on 0.00 saves for a year. The number
that DOES rank, `reels_skip_rate`, has been collected since migration 0108 and had
never been read. First read 2026-09-09, one row per post, latest snapshot,
reach > 0: **41 posts, mean skip 66.4%, best 39.8%, worst 92.9%, Pearson r vs
reach −0.633.** The generator now receives that scoreboard
(`server/services/hookPerformance.ts`), and it returns an EMPTY fragment when the
read fails, so an outage teaches nothing rather than teaching from nothing.

**A QUEUE OF FINISHED REELS IS NOT A STUCK QUEUE.** 32 reels sat `assembled` and
looked like idle paid inventory. They were a scheduled run with no gaps for 28
days, each with a populated `publication_intended_at`. I called it idle before
checking the dates; do not repeat that. The posting lane was already healthy.

**`kpi-snapshot` had NEVER succeeded** — 5 runs, 0 successes since 2026-09-03 —
on one identifier: `review_replies` spells it `created_at`, and the table beside
it in the same statement genuinely uses camelCase `sentAt`. **A column name in a
raw `sql` template is invisible to tsc, to Drizzle and to every lint.** The only
signal was a production cron failure. `kpiSnapshotSql.test.ts` now checks every
column the job names against the schema.

**`ig-autopost` was failing 20 of 703 runs** purely because it inherited the
4-minute `DEFAULT_JOB_TIMEOUT_MS` while doing two third-party round trips. Now
10 min. Budgets must stay UNDER the tier cadence (pulse = 15 min) or a slow run
holds its lock past the next pulse.

**The pack lane had NO call to action at all** — the builder never read `ask`, so
every pack-derived reel rendered no end card. Four packs faked one by burning the
shop address into their last BEAT, which `assembleReel` refuses, so those four
could never have shipped. And `motionLens`/`archetype` were hardcoded: 26 of 27
queued reels carried one lens. Both now rotate deterministically per pack id (all
14 lenses reached across the real 166 packs).

**MEASURE ON REAL FOOTAGE.** Film grain shipped default-OFF because a synthetic
smooth gradient said it cost 2.57x file size. On a real 8.2 MB reel master it
costs **1.18x**. The gradient was the worst case and was never representative.
`REEL_FILM_GRAIN=true` is now ARMED at strength 8; the curve turns hard just
after (9 → 2.19x, 10 → 3.34x, 12 → 6.40x, which produced a 52.8 MB file). It
applies at ASSEMBLY, so the 28 already-assembled reels keep their look — the
operator asked for exactly that.

**`docs/operations/REEL-PIPELINE.md` asserted `REEL_VIDEO_PROVIDER=template_stock`
"NOT higgsfield".** Production reads `higgsfield`. The paid lane is the one
running, so a reel costs money. Re-read the live value, never the doc.

**Where to look now:** Instagram admin → gear → **Pipeline health**
(`?igview=pipeline`). Forward schedule with the first empty day called out,
measured hook performance, queue, cost per published reel ($4.09 lifetime,
$6.49 last 30 days), lane health. Read-only.

**Left deliberately short of done:** the pre-spend ask-leak check is a WARN, not
a block. Promoting it regenerates briefs, and fixtures across seven test files
still model the old pattern (the three canonical SAMPLE_REEL_BRIEFS did too, and
those are fixed). Sweeping the fixtures is its own change. The render-time gate
remains the hard stop.

**Operator decision, declined:** AI audio disclosure. It is already ON — the
publish path sends `is_ai_generated` because `higgsfield` is on the generative
list — and the operator was told it is a flag in the API call, not visible copy.
No change made.

## 2026-09-08 · knip orphan gate unstuck (branch `nickstire/knip-orphans-2220`)

The `knip orphan gate` CI job was red on EVERY PR from #2215 (13:53Z) onward, docs-only ones included,
because `main` itself carried three new orphans: `inventoryBriefJson` + `INVENTORY_BRIEF_MAX_BYTES` (#2215,
imported only by their own test, and tests are excluded from knip project globs by design) and
`AUTO_APPROVABLE_CODES` (#2217, exported, read nowhere outside its own file). Not #2220 - that PR only inherited
the red. Fix: the pair is baselined WITH REASONS (test-visible contract; its runtime caller
`ensureReelDraftForJob` has three importers, so it is not vacuous) and the Set is made module-private (the
#2187 lesson again: keep policy lists private). Receipts: unmodified tree exit 1 naming exactly the three
(1000 findings / 1016 baselined / 3 NEW); after the change exit 0 (999 / 1018 / 0); planted `__orphanCanary__`
in `shared/reelScore.ts` caught by name, file restored byte-identical, exit 0 again; tsc exit 0; the three
touched test files 10/10. **Codex round 1 (PR #2224): one P2, real** - the baseline alone hid whether
`ensureReelDraftForJob` still calls the serializer; `reelInventoryBriefSize.test.ts` now drives the created branch through a
fake drizzle client (slimmed row / refuse-before-insert / updated control), mutation-proven: bypassing it fails 2 of 3.
**Running the gate on THIS machine (this is the 09-07 "stops at `lint:orphans`" note below, explained):**
`pnpm dlx` with pnpm default isolated linker fails here for ANY package, not just knip - first
`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`, and once past that a Node 24 `ERR_REQUIRE_CYCLE_MODULE` inside
formatly through the junction paths. It is NOT a stale cache: moving the `pnpm-cache/dlx` folder under
`%LOCALAPPDATA%` aside changes nothing. A flat layout works, script unmodified:
`npm_config_node_linker=hoisted node scripts/knip-orphan-gate.mjs` from `apps/nickstire` (60-80 s). CI (ubuntu,
Node 24.20) needs nothing.

## 2026-09-08 · release closure — what an outside review of the MERGED code found

#2173 merged `f2bcf949d` and deployed 20:14 ET (10/10 live GETs); #2179 merged `cfdcad9be`. A second outside
report reviewed the merged diff and was right about three things and wrong about three. **Right:** (R3) the
billed-sales rolling windows spanned **8 / 31 dates** — `salesWindow()` ran to *tomorrow* exclusive, and the
existing test pinned an eight-day literal pair under the name "7-day span" (a pinned literal is not a count);
(R5) the prerender regen runs against production with `DATABASE_URL_PRERENDER_RO || DATABASE_URL` and the
conversion beacon wrote a `customer_events` row per rendered page — `PRERENDER_MODE` skipped crons, not this
route; (R4) the drain's 25-candidate scan can starve, not just skip (handoff to the reel session, in §3 of the
program doc). **Wrong:** Grok Imagine resolution-tier pricing (xAI's model page lists a single $0.080/s);
"#2179 still open" (merged); "SEOHead JPEG fix was in the follow-up" (it was inside #2173, `c4105d71e`).
All three fixes + three regression tests + doc corrections are in this PR; the program doc has a §15 release
record. **Regen on main:** run `34172453611` failed at `git push` (non-ff — #2179 landed mid-run; the workflow
does not rebase); re-dispatched `34173664386` from `622426951` → landed `2336d313d` (337 files). **Tree check, not assumption:**
Parma snapshot at `f2bcf949d`/`cfdcad9be` = 1 JSON-LD `FAQPage` + WebP og:image; at `2336d313d` = 0 + JPEG. So
the in-PR regen had NOT made the fixes crawler-visible (the earlier ledger line claiming it had was wrong), and
a skip-ci-tagged regen commit DOES deploy on Railway (health showed `2336d313d` by 21:20 ET; the 20:51 probe was
before its build finished — poll health, never conclude "no deploy" from one early probe). #2182 merged `081f517f7`. **Crawler-visible VERIFIED 21:2x ET on `2336d313d`:** bot-UA GET
`/parma-auto-repair` → `X-Prerendered: true`, 0 `"@type":"FAQPage"`, 0 `aggregateRating`, og:image `/og-image.jpg`.
**Security hardening PR (branch `nickstire/security-hardening-2026-09-08`):** hash-based `script-src` in prod (one
inline loader; 336/336 snapshots share the hash — test walks every file), `cf-connecting-ip` gated by
`TRUST_CLOUDFLARE_HEADERS` (rotating the header defeated the 10/h form limit — proven through the real limiter),
`/.well-known/security.txt`. Post-deploy check: DevTools console on `/`, `/tires`, `/book` shows no "Refused to
execute inline script"; `curl -sI https://nickstire.org/ | grep -i content-security` shows `'sha256-` and no
`'unsafe-inline'` inside script-src. Rollback without deploy: `CSP_ALLOW_UNSAFE_INLINE_SCRIPTS=true`.
**Security PR #2187 MERGED `829067f76`** (after one knip red: three test-only exports — the #2179 lesson, re-learned;
helpers made private, test reads the served body).
**Mobile shop strip + estimate ticket (branch `nickstire/mobile-shop-strip-2026-09-08`):** MEASURED before designing —
the "StickyTrustBar" was static at y=0 under the fixed nav cluster and never visible (`elementFromPoint` → the red
closed-banner, or the membership band when open); no address/phone above the fold on a phone. Shipped: `ShopStrip`
inside `SiteNavbar`'s fixed cluster (open/closed + until · address → directions · tel · rating; closed adds Emergency
→ `nickstire:emergency-request` window event → `EmergencyMode` form), membership band `hidden lg:block`, red
closed-banner deleted, `StickyTrustBar` deleted, `shopHours` = Eastern time from canon (was visitor-local + a second
hard-coded schedule), hero margins `mt-36`/`pt-32`, written-estimate ticket on every `FocusedServicePage`, MERGED `3ce3c68dd`,
live 06:30 UTC. **Correction the same day:** I had paraphrased the AEO default's "you don't pay until you say yes"
as a fee-safety fix — WRONG: it is the canonical Repair Haiku (`shared/voice.ts` prescribes it; SMS, voice, 100+
pages), and the $59.99 diagnostic is itself quoted in writing before it is charged. Reverted in the follow-up PR;
only the owner changes that promise. Verified in the Browser pane at 375×812 on
`vite preview` (launch config `nickstire-preview` added to `.claude/launch.json`). OPEN: `NotificationBar` toast + two
FABs overlap the hero's third intent card on 812px phones → FIXED in the follow-up PR: on phones the card waits for a scroll past 60% of the first screen; desktop and the
prerender pass unchanged (`notification-bar-fold.test.tsx`). Still open: the two FABs on the cards' right edge when closed. **TRAP (cost one CI cycle):** I quoted the skip-ci token inside a sentence of commit 2's message and
GitHub skipped EVERY workflow for that push — the token counts anywhere in the head commit message. Never spell it
out in a commit message or in a PR body a squash merge might copy; pass `--subject`/`--body` to the merge. Verify by a bot-UA **GET** of a city page, never HEAD; bot responses are cached 1 h. `grep -c FAQPage`
over-counts (chunk names) — count `"@type":"FAQPage"`. Owner item: create the read-only prerender credential.

## 2026-09-07 (evening) · quality program — 16 public-site/admin fixes, one document

**PR #2173** (this branch) · **AGENTS.md rules PR #2176 MERGED `80c2b5d37`** ("No early exits" + "write the
if-this-then-that branches before starting; a branch that does not land is a hard block"). Three traps this
PR's CI taught, all green-locally/red-in-CI: (1) inside `app.use("*")` `req.path` is "/" — a catch-all keyed on
it never fires; test THROUGH the mount; (2) the knip orphan gate counts a test-only export as an orphan — keep
policy lists private and pin them as literals in the test; (3) an earlier file's `global.fetch = vi.fn()` leaks
into later files in the serial suite — probe a local server with `node:http`, never global `fetch`. Also:
`git add` on the gitignored-but-tracked `.remember/now.md` exits 1 and silently aborts a `&&` chain.
The prerendered snapshots were refreshed IN the PR via `workflow_dispatch` of `prerender-refresh.yml` on the
branch (the reviewer's P2), so the schema/og:image fixes reach crawlers with the deploy.

Full write-up: `docs/QUALITY-PROGRAM-2026-09-07.md` (answer first, fact-check of two outside reports,
the five Phase 1 slices against the code, design system, ordered SEO/AI list, gates, coverage matrix,
SEND-TO-THE-CODING-AGENT block). **Reel files were deliberately untouched** — a sibling session owned
the reel lane; two reel findings are handoffs in §3 of that doc (approval-time content-similarity veto
parity; delete the disarmed legacy `publishReel` route + its two tests — `REEL_LEGACY_PUBLISH_ENABLED`
is UNSET in prod, read across 410 Railway variables).

Measured live BEFORE fixing (all fixed on the branch): unknown URL → **200** with the home title and
`index, follow` (soft 404) · home HTML `max-age=86400` (express.static served `/` as a FILE; every other
route already had the 5-minute header) · `og:image` CloudFront PNG → **403** · sitemap `lastmod` = today
on every URL · `ai.txt`/`llms-full.txt`/`business-data.json` + 3 schema JSON orphaned and contradicting
canon (city "Euclid", oil $39/$69) · CityPage minted a distinct rated entity with `aggregateRating`
twice per page on 21 pages · two `WebSite` nodes on `/` · CSP `connect-src` blocked
`region1.google-analytics.com` / `analytics.google.com` / `stats.g.doubleclick.net` (real-Chrome probe;
no `/g/collect` beacon seen on load) · privacy policy never named Meta · Shop Pulse rendered a failed
read as "$0 · SLOW DAY" (writer fixed in #2163, consumer never read `_unavailableCounts`).

**TRAP:** `curl -I` (HEAD) as Googlebot returns the SPA shell with no `X-Prerendered` — the middleware
intercepts GET only. Probe crawlers with GET. Prerender is healthy (336 pages, 4+ JSON-LD blocks).

Environment: `pnpm run verify` stops at `lint:orphans` on this machine (pnpm dlx isolated-linker installs
break here: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` - NOT the cache; workaround in the 09-08 knip section above:
`npm_config_node_linker=hoisted`); every gate after it was run individually — full suite
**553 files passed | 2 skipped (555)**, tsc exit 0. PageSpeed Insights public API quota exhausted for
the day; Chrome DevTools MCP `lighthouse_audit` gave lab scores (a11y 96 → fixes, BP 73, SEO 100).

Runtime verification after deploy = §11 of the doc (404 status, 5-min cache header, og-image 200,
lastmod count, robots content, `/g/collect` 204, then `workflow_dispatch` the prerender refresh).

## 2026-09-07 · admin Phase 1 — PR #2163 (open)

Branch `nickstire/admin-queue-retire-sales-contract`, 10 commits, 47 files, all under
`apps/nickstire/`. **Nothing applied to production.** Full suite **542 files passed | 2
skipped (544) · 6,831 passed | 50 skipped | 1 todo (6,882) · 0 failed**.

**Verified in the LIVE admin first** (real browser, owner session): the home carried **no
revenue figure at all**, opened with a **227-item Decision Inbox**, and the summary counts
sat **7th** below an Automation Lift panel last measured 2026-06-07 with 3 of 4 metrics at
0.0%. The top 5 queue items were customers who texted **38–41 days ago, never answered**.

Shipped: Decision Inbox retired (home **and** morning brief — ROS-083 resolved by removing
the block AND the "Top 3 priorities" mandate together, since removing one re-creates it);
neutral `dismissed` state (VARCHAR(24), no migration); `captureStatedConcern` reshaped to
require `heardFrom: z.literal("customer")` — that literal made the old hide-button call site
a **compile error**; one sales definition (`services/shopSales.ts`, contract extended not
duplicated), labelled **"Billed"** not "Total Sales" until reconciled to ALG; two live-publish
bypasses closed (`reel-canary` + `generateAndPublishLiveTestReel`, the latter was posting AI
video **undisclosed**); drain fixed twice over; provider handle retained; read-only recovery
ledger; `docs/ADMIN-COVERAGE-2026-09-07.md` (18 sections, **10 honestly marked NOT AUDITED**).

**Prod flags re-verified live (read-only)** — these had been unverified in docs since
2026-08-11/16: `S3_BUCKET` + `S3_ENDPOINT` **set** (so masters ARE durable — the measured
404s are historical), `CLOUDFRONT_DOMAIN` unset, `REEL_PUBLISH_ENABLED` /
`REEL_AUTOPOST_ENABLED` / `REEL_GENERATION_ENABLED` **true**, `IG_AUTOPOST_DRYRUN` **false**,
`RENDERED_QA_ENABLED` **true**, `REEL_APPROVAL_TTL_HOURS` unset (72h default),
`REEL_VIDEO_PROVIDER` = `higgsfield`.

**Operator actions:** (1) apply `drizzle/0118` — **apply → reconcile → THEN wire schema.ts**;
wiring first makes `findLiveApproval`'s bare `select()` throw and it fails closed, silently
holding every reel. (2) The 227 open opportunities are real customers. (3) Visual pass after
deploy — **not verified**, the authed admin cannot render outside a signed-in browser.

**Environment note:** the pre-push gate fails on `@statenour/web#build` —
`Cannot find module '@sentry/nextjs/config'`, **missing from the primary checkout too**.
Environmental, hits any branch. Pushed via a hookless clone; CI runs the real gate.

**Objective:** Execute the 18-agent audit's findings + a forensic/growth audit grounded in the shop's REAL GSC data, fix every code-fixable defect, and ship a gate so the next drift can't hide.


## 2026-09-07 wave — three of four "outstanding" tasks were already done

A session brief listed four production tasks. **Three needed no write.** The pattern worth
carrying: every one of them was "outstanding" only in a doc, and production disagreed.

### Shipped
- **#2119 `e9da9632`** — 29 brand-voice violations in customer-facing copy. Repo-wide
  `--audit` went **57 violations / 31 files → 28 / 17**. Fixed the site-wide banner claim,
  the /problem hero band, /faq "happy to help", /careers filler, /fleet "exclusive", and SEO
  meta on /reviews, /estimate, /rewards, /ask-a-mechanic + 5 neighborhood routes.
  Receipts: `tsc --noEmit` exit 0 · vitest **534 files passed | 2 skipped (536)**,
  **6,709 passed | 55 skipped | 1 todo (6,765)**, 0 fail markers.
- **#2161** — corrected a false GBP-ownership claim in this file (see ACCOUNT OWNERSHIP below).

### THE 28 REMAINING BRAND-VOICE HITS ARE VERIFIED FALSE POSITIVES — do not "fix" them
The linter matches more than prose. Each was checked against its real source line:
- `bmw-premium-front-shop-sign.webp` — an **image asset filename** (2 hits).
- TireFinder `"premium"` — a **literal product tier**, which the rule's own text exempts (8).
- `"insurance premium hike"` — the **financial term**.
- LandingPage `"Best tire deal in Cleveland"` — a **CUSTOMER REVIEW QUOTE**. Editing it would
  falsify a testimonial.
- `"The corner you trusted"` — deliberate Moe's continuity wording from #2097/#2099.
- `unmatched.length` in `declinedWorkRecovery.ts` — a **variable** in an internal ops alert (5).
- `compare/*` hits — describe **COMPETITORS**, not Nick's (6).

**Do NOT take the Voice Kernel's suggested fix of "show it with 4.9★ on 1,700+ reviews."**
Those figures are UNVERIFIED (see Open/next). Replacing a cliche with an unproven claim is worse.

### TRAP · the brand-voice audit's printed line numbers are WRONG
Reported 513 → actual 517; reported 323 → actual 327; reported 341 → actual 345 (offset ~+4 in
every case observed). Anyone editing by the printed number edits the wrong line. Locate by
`grep` for the matched string, never by the reported line. **Not fixed — worth a follow-up.**

### TRAP · `pnpm run prerender` does NOT update the tracked tree
`scripts/prerender.mjs:8` writes to **`dist/prerendered/`**. The committed `prerendered/`
(336 files) is refreshed by **`pnpm run regen`** (`scripts/regen-prerender.mjs`), which is what
`.github/workflows/prerender-refresh.yml` runs on **`cron: "0 8 * * 1"` (Mondays 08:00 UTC)**
— that workflow exists precisely because Railway deploys do not regenerate prerender
(`PRERENDER_ON_BUILD` is off for fast deploys). It also has `workflow_dispatch: {}` for a
manual run — **prefer that over a local regen.**
- **`GOOGLE_MAPS_API_KEY` IS set on the Railway service** (measured: 129 variables, key
  present, non-empty). A regen under `railway run --service MAINnicks-tire-auto` therefore does
  NOT strip the 5 live review cards from /reviews. That hazard (133KB/5 cards → 107KB/0) is
  real only for a **bare local run without the key**. A prior claim that the key was
  "a GitHub Actions secret, not a Railway variable" came from a grep filtered to
  `*.yml|*.json|*.md` — it is referenced in **11 `.ts`/`.tsx` files** including
  `server/_core/index.ts`. **A filtered search reported as a whole-repo fact is how that
  happened; it happened four times in one session.**

### 0112_reel_publish_approvals was ALREADY APPLIED — the pack docs are wrong
Verified against prod TiDB 2026-09-07: table **present**, hash `53782a0a8587…5dd4c1` recorded
(n=1), **`SHOW CREATE TABLE` column-for-column identical** to the migration, **5 approval rows
already recorded**, `reconcile-migrations.mjs --strict` → **`✓ no blocking drift`, exit 0**.
Applied ~2026-08-28 via `db-migrate.ts`'s unjournaled-discovery path, so its recorded
`created_at` is a `Date.now()` stamp (`1787979040243`), not the journal's `1787000000000`.
Dedupe is by hash, so reconcile is clean — the ledger timestamp just doesn't match the journal.

**~192 reel-pack docs under `docs/reel-packs/` each repeat "whether
`0112_reel_publish_approvals.sql` has been applied to production TiDB — UNKNOWN/unresolved."
That is FALSE and has been since ~2026-08-28.** It is a rank-7 historical artifact that reads
as current fact and has already caused one session to declare a non-existent live risk its top
priority. Do not re-derive production state from a pack doc.

### Reel routine — DISABLED 2026-09-07
`trig_01L5xRvGTGDAywMYy3WXoFew` ("Faceless reel production pack", cron `27 * * * *`) is now
`enabled: false`, verified on read-back. It had produced ~192 packs and **zero published Reels**.
- **Correction to a claim made twice this session:** "it has zero MCP servers, so it cannot
  render video by construction" is **FALSE**. The routine has **13 connectors attached**
  (`mcp_connections`), including Adobe-for-creativity which exposes `video_render`,
  `video_resize`, `video_create_quick_cut`. The empty field is
  `session_request.config.mcp_servers`; reading that one and calling it proof was the error.
- **Likelier real cause (plausible, NOT verified):** `allowed_tools` is
  `["Bash","Read","Write","Edit","Glob","Grep","WebFetch","WebSearch"]` with no `mcp__*`
  entries, so the attached connectors were probably unreachable from inside the run. If anyone
  revives this, **fix `allowed_tools` — do not rebuild the routine.**

## The findings that shaped the 2026-09-03 arc
- **Traffic is NOT the bottleneck.** Whole site = ~776 clicks / ~194k impr in ~5.5 mo (home = 61% of clicks). `/oil-change` (49.7k impr, pos 39) and `/brakes` (44.6k, pos 37) are **national wrong-intent "near me"** ("oil change near me" = pos 50); position is DEGRADING over time, not ramping. The prior session's "young-site + competition, needs authority + time" was **misdiagnosed**. The real levers are GBP/Local Pack, converting existing clicks, and reviews — largely operator, not code. GSC export lives at scratchpad `gsc-export/` (Filters/Pages/Queries/Chart csvs).
- **A case-sensitive grep missed a live falsehood.** The Moe's bridge page said "new ownership" (lowercase, fixed) AND "New ownership" (capitalized, MISSED) — the second was the hero intro's first line, contradicting the FAQ + the owner-confirmed truth. Caught only by loading the LIVE page in real Chrome. **Lesson: sweep copy-truth with `grep -i`, and verify user-facing changes in a real browser (the in-app browser blocks the fonts, so it's not a fair visual check).**
- **Owner-confirmed truth (2026-09-03):** SAME owner, shop since ~2018, simply renamed Moe's Tire & Auto → Nick's Tire & Auto. Not "new ownership." Never imply "run by Moe" (truth guard blocks it).
- **PR #2094's neighborhood enrich+index was defeated:** 10 of 12 `indexed:true` slugs are prerender:true but served STALE `noindex` snapshots to crawlers (index+content lived only in client React). `prerender:check`/`semantic-check` never compared snapshot robots vs source intent.

## Shipped (all merged to main, deploying via Railway)
1. **#2097 `9f95078fc`** — Moe's continuity (bridge "new ownership"→"same owner", About former-name line, "5-Star Reviews"→"Google Reviews") + 5 self-review defect fixes: FTC $25 pricing band on 6 indexed pages, reverted premature neighborhood indexing (12 → `indexed:false`, kept enriched content), Acima durable event on all 3 CTAs (was 1), NeighborhoodSchema canonical @id + dropped duplicate aggregateRating, ChatWidget live-region scoped to transcript, removed "before your next shift starts" promise.
2. **#2098 `cff6a8fa`** — indexability drift-catcher test (`client/src/__tests__/prerender-indexability-consistency.test.ts`): proves `indexed` flag + routes.ts + SITEMAP_ROUTES + snapshot robots agree for every NeighborhoodPage-served slug. Static, no deps, ships a canary. Scoped to group:"neighborhood" (city slugs like lakewood-auto-repair are owned by CityPage).
3. **#2099 `fc73b176`** — the remaining capitalized "New ownership" instances (hero intro + What-Changed list + 2 stale comments), Chrome-caught. Reworded a "trusted" line to pass lint:brand-voice.
- **Report artifact** (external deliverable): https://claude.ai/code/artifact/3cdeb4b7-58fd-45de-9198-018b7f1c807d

## Verification receipts
check 0 · truth guard 15/15 · relevant tests 98/98 + gate 5/5 · prerender check 0 missing + semantic OK · brand-voice no new violations · live smoke 11/11 money pages 200 · **/brakes renders clean** (refuted the external report's "chunk error" — stale Google cache).

## Open / next
- **Operator (the real growth levers, no code):** claim Bing Places; fix Apple Business Connect ("Moe's"). **Verify the "1,700+ / 4.9★" figures against live Google Maps before any copy uses them** — no agent session can read GBP, so they stay UNVERIFIED *here* no matter who owns the account. Full 48h/2wk/30d plan in the report artifact.
- **ACCOUNT OWNERSHIP — operator-confirmed 2026-09-07. Do NOT re-raise.** Nour owns BOTH
  `nourdean22@gmail.com` (his CEO email) and `moeseuclid@gmail.com` (the Euclid store's
  account, which holds GBP). There is no third-party access, no owner split, and no lockout
  risk. The prior version of the line above claimed GBP was "under moeseuclid@" as if that
  were an access barrier, and told the next session to add owners to fix a split. **Both were
  false and cost a session real advice-time.** `moeseuclid@` being the *store's* address is a
  naming artifact of the Moe's → Nick's rename, not a sign of outside control.
- **Review flywheel: operator declined 2026-09-07.** Previously listed here as a growth lever.
  Not wanted. Do not propose it again.
- **Follow-up code (flagged, not rushed):** Playwright live-production smoke suite + `dynamic_import_failure` telemetry (heavy dep + CI wiring — do deliberately); `NEIGHBORHOODS` duplicates several city slugs → shadowed dead NeighborhoodPage routes (the gate surfaced this).
- **Re-indexing the 12 neighborhoods properly** (only if data justifies — it currently doesn't): needs a prerender regen + a visible FAQ to match FAQPage schema + the SITEMAP_ROUTES neighborhood-group exclusion lifted. The new gate makes that safe (fails if you re-flag without regenerating). **The regen is `pnpm run regen`, run via the `prerender-refresh.yml` `workflow_dispatch` button — not `pnpm run prerender`, and not locally.** See the prerender trap in the 2026-09-07 wave.

## Refuted (don't re-chase)
**Claims this repo's own docs made that PRODUCTION refuted (2026-09-07). Four in one session,
all the same shape: a partial or filtered read reported as a whole-population fact.**
1. *"`0112_reel_publish_approvals` is unapplied / unresolved"* — repeated in ~192 pack docs.
   **Applied since ~2026-08-28, 5 rows live.**
2. *"prerender is stale, crawlers see the old copy"* — the Monday `prerender-refresh.yml` job
   had already absorbed it. **206/206 routes verified matching**, canary-proven (the same
   comparator flags exactly 9 stale against pre-#2119 `routes.ts`, 0 against current).
3. *"`GOOGLE_MAPS_API_KEY` is a GitHub Actions secret, not a Railway variable"* — **it is set
   on the Railway service** (129 vars). The claim came from a grep filtered to `*.yml|*.json|*.md`.
4. *"the reel routine has zero MCP servers and cannot render video by construction"* — **13
   connectors are attached.** The empty field read was `session_request.config.mcp_servers`.

**The habit that catches all four:** `AGENTS.md`'s source hierarchy is not decoration.
Production evidence is rank 1; a `.remember` handoff is rank 8; a dated pack doc is rank 7.
Before acting on a doc's factual claim about prod, read prod. And before reporting a search
result as a fact about the repo, check what your search EXCLUDED.

External audit's "/brakes broken" (stale cache; renders fine live) and "duplicate brake-cost blogs" (exist in neither routes.ts nor the real GSC export).
