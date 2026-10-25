# Lens B review of PRs 3260, 3264, 3266, 3267 (2026-10-25)

Job 2026-10-25-lens-b-review, statenour lane, branch `statenour/lens-b-fixes-2026-10-25`.

## Answer

9 findings: 0 P1, 3 P2, 6 P3. 1 is fixed here (finding 1, the brief's continuity-view ruling, which turned
out to be two defects in one file). The worst one still open is finding 2: offline, the System
observability panel says Langfuse is "not initialized: no init outcome reported on this boot", a claim
about the server made from a read that never ran. No P1 was found, so no extra one-file fix was made.

Note on the PR set: 3260's title says wave E1 (Journal and System), not wave C. The four PRs reviewed are
3260 (E1), 3264 (D, Brain Memory), 3266 (E2, Stats and Settings) and 3267 (F, ratchets and deep links).

## Findings, ranked

Line numbers are on `origin/main` 51e8be7ea unless marked.

| # | Sev | PR | File:line | What breaks | Proof | Status |
|---|---|---|---|---|---|---|
| 1 | P2 | 3264 (file), pre-existing gate | `apps/statenour/components/brain/continuity-view.tsx:130` | Offline, the continuity block rendered nothing (`if (!data) return null`). The same gate also hid four blocks that own their reads (change line, Time Travel, receipts, judgment quality), so offline or failed, `/brain?tab=health#time-travel` (command palette, cross-system nudge) had no target. | `tests/components/brain/continuity-view-read-states.test.tsx` against the main file: 7 failed / 3 passed | FIXED here |
| 2 | P2 | 3260 (moved into the Detail fold) | `apps/statenour/components/system/observability-status-panel.tsx:83-103` | A paused read has `isError` and `isLoading` false, so the panel renders `langfuseState(undefined)`: "not initialized, no init outcome reported on this boot". | Throwaway render probe with a paused query printed exactly that text | Open, one-file fix: an offline branch via `readState` |
| 3 | P2 | 3260 | `apps/statenour/app/(mastery)/system/actions/page.tsx:353, 631, 644, 672` | The page 3260 reshaped keeps phone controls under 44 px: Refresh is `px-4 py-2 text-xs` (16 px line + 16 px padding = 32 px tall), the window and approval chips are `px-3 py-1 text-xs` (24 px), and so is "Clear rule filter". The e2e floor never measures this page. | Class arithmetic on those lines; `tests/e2e/target-size.spec.ts:28` PAGES has `/system`, not `/system/actions` | Open |
| 4 | P3 | 3260 | `apps/statenour/app/(mastery)/system/actions/page.tsx:311, 339, 393` | Offline, the page says "loading..." and "loading approvals..." for as long as the connection is down: a paused query stays `isPending`, which `loading` reads as in flight. | Read of those lines plus `lib/query-state.ts` (paused = no data, no error, still pending) | Fixed, this PR |
| 5 | P3 | 3264 | `apps/statenour/components/brain/memory-verdict.tsx:33-36` | Offline, the verdict reads "Memory couldn't be read, so what the brain believes is unknown." right above "Offline. Memory shows when the connection returns." Offline is a pause, not a failed read. | Same probe: both sentences rendered together | Fixed, this PR |
| 6 | P3 | 3260 | `apps/statenour/components/system/detail-fold.tsx:10-12, 62` | The System fold counts only `[data-read-failed]`. Wiring census, trust ladder and home decision render `data-read-state="offline"` inside it, so a closed fold shows no sign they are offline. BrainFold (3264) counts offline and stale; the two folds disagree. | Grep of the seven fold children for markers; BrainFold `READ_OFFLINE_SELECTOR` | Fixed, this PR |
| 7 | P3 | 3266, 3267 | `apps/statenour/tests/repo/deep-link-hash-targets.test.ts:78, 98` | The gate drops `?tab=` and unions the ids of every tab's files, but PageTabs renders only the active tab (`components/layout/page-tabs.tsx:12, 255`). A link like `/brain?tab=health#contradictions` would pass while landing on nothing. No such link exists today. | Read of the LINK regex and `mounted()`; every current hash link listed and checked against its tab | Fixed, this PR (test weakness) |
| 8 | P3 | 3260 | `apps/statenour/lib/trpc/routers/task.ts:774, 791`; `apps/statenour/tests/lib/validators/ultron-task-schemas.test.ts:193-230` | 3260 deleted `active-task-companion.tsx`, the only caller of `task.session` and `task.logSessionEvent`. The procedures now have no client caller, and the schema test still pins a "call-site payload contract" for call sites that no longer exist. | Grep for `task.session` and `task.logSessionEvent` over the app: hits only in the router and that test | Fixed, this PR (dead code) |
| 9 | P3 | 3260, 3266 | e.g. `apps/statenour/app/(mastery)/system/crons/page.tsx:11` | The em dash sweep replaced the dash with a comma but kept the alignment padding: `STATUS DOT (live)    , green/amber/red`. Comments only. | Sweep of added lines for ` , ` patterns: 11 hits in 3260, 4 in 3266, all comments; 0 in rendered strings | Fixed, this PR (cosmetic) |

## Checked and clean

- Em dashes in added lines: 0 in all four diffs. Positive control: the same pattern matched 126, 211, 149
  and 32 removed or context lines.
- Native dialogs (`window.confirm/alert/prompt`) in added lines: 0 (one comment names the rule).
- Ratchet baseline slack: `UPDATE_RATCHET=1` on the ratchet test (CI unset) wrote no change, so no lowered
  count was left unrecorded (INFERRED: a no-op write and a skipped write look the same). The baseline file
  was restored from a copy either way.
- Every `/brain`, `/stats` and `/settings` hash link in the tree names an id on the tab it opens; none
  outside the swept roots (worker, packages, config, scripts).
- Settings E2 reshape dropped no panel; the four parked Brain cards (Ghost Nick, calibration, prediction
  streaks, preferences) are each mounted once in their new homes.
- Phone-width sweep of added classes (fixed px widths, `whitespace-nowrap`, wide grids): one hit, the
  "Deconstruct" button, which fits at 390 px.

## NOT PROVED

- Whether BrainFold's "(n)" overcounts: the `#nudges` and `#qualitative` wrappers always render, but I did
  not prove their panels can render nothing.
- Deep links already stored in database rows (old notifications or coach events naming `/brain#ghost` and
  similar): needs a production read, which this job may not do.
- The real box size of the `/system/actions` controls: class arithmetic only, no browser measurement.
- Offline-first launch on the phone: per `lib/query-state.ts` a launch with no connection shows the error
  note, not offline; not exercised on a device.

## What changed here

1. `apps/statenour/components/brain/continuity-view.tsx`: the read goes through `readState`; offline,
   failed and stale render `ReadStateNote` (Retry on failure, data kept on stale); the four self-reading
   blocks mount in every state. The one-off rose error block is gone.
2. `apps/statenour/tests/components/brain/continuity-view-read-states.test.tsx` (new): 10 tests. Red
   against the main file 7 failed / 3 passed. Mutations: no-data branch back to `return null`, 3 failed;
   self-reading blocks dropped from the no-data branch, 2 failed.
3. `apps/statenour/tests/repo/alpha-text-contrast.test.ts`: the KNOWN_FADED entry for
   `continuity-view.tsx -> text-rose-300/70` removed, because the fix deleted that line (the reverse
   canary failed until it was).
4. Round 2 (Codex P2 on PR 3283): now that the children mount offline, two of them had to say so.
   `receipts-timeline.tsx` fell through a paused read to "0 in window" and "No receipts in the current
   window"; `judgment-quality-panel.tsx` drew its promotion counts from undefined. Each now returns the
   offline note first. `brain-change-line.tsx` renders nothing until its read succeeds and
   `time-travel-panel.tsx` reads only on a tap, so neither makes a claim offline. Test
   `tests/components/brain/continuity-children-offline.test.tsx`: red 3 failed / 2 passed (controls
   green); mutations: receipts guard removed, 1 failed; judgment guard removed, 2 failed.
