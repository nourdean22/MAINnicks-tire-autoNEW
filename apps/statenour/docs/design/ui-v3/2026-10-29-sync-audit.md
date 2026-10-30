# bdnick.info sync audit, 2026-10-29

Read-only audit of every page route in apps/statenour (base origin/main c3d9b7fb1f; no statenour page file changed since). Source-read only: nothing rendered (no node_modules in the audit worktree, production needs Google sign-in). Manager spot-checked findings 1, 2 and 4 against source: all three hold.

Correction to the earlier plan note: W5a (7d9ffc735b) and W5b (7fa1be72ab) are MERGED; what remains of Control is the System detail pages, still boxed cards.

## Coverage (17 page routes)

| Route | v3 vs Home | Ratchet debt reachable | Phone gates |
|---|---|---|---|
| `/` Home | yes (reference) | 2 | distance, scroll, size |
| `/missions` | yes | 46 | distance, scroll, size |
| `/chat` | yes | 12 | distance, scroll, size |
| `/brain` | partial | 7 | scroll, size |
| `/people` | partial | 4 | scroll, size |
| `/journal` | partial | 0 | scroll, size |
| `/stats` | partial | 107 | scroll, size |
| `/system` | partial | 7 | scroll, size |
| `/system/actions` | no (Panel boxes) | 1 | none |
| `/system/alerts` | partial | 0 | none |
| `/system/crons` | no | 0 | none |
| `/system/inbox` | no | 0 | none |
| `/system/ui-lab` | no (QA fixtures) | 0 | scroll only |
| `/settings` | partial | 0 | scroll, size |
| `/photo-improver` | no | 0 | scroll only |
| `/decisions/[id]` | no | 4 | none |
| `/auth/sign-in` | n/a | 1 | none |

0 dead nav links (27 hrefs + ?tab= values checked). 0 `loading.tsx` files (PLAN.md:20 claims one).

## P1: out of sync or misleading

1. **Tower vs Alerts count different things.** `lib/services/system-pages.ts:275-283` + `lib/system/control-tower.ts:117-132` count `coach_event` rows keyed `coach:drift-recovery:`; `/system/alerts` reads `ALERT_CATEGORIES` (`lib/brain/alert-lanes.ts:12-20`, `lib/services/brain-domain.ts:101-104`), 7 categories, none `coach_event`. The hub Alerts tile (`components/system/hub-cards.ts:116`) is a static chip. Priority alerts can be open while the tower says ALL SYSTEMS NOMINAL. Fix: tower + tile read the Alerts page's own reader, dismissals applied.
2. **Approvals counted 3 ways.** Home brief `lib/home/operator-brief.ts:381-389` and app badge `components/hud/app-badge.tsx:44` = live requests + live autonomous actions; `/system/actions` `pendingCount = approvals.length` (`app/(mastery)/system/actions/page.tsx:336`) includes expired and omits autonomous actions; `lib/services/system-observability.ts:177` counts all pending_approval rows. Fix: one shared live-decisions helper; show "N live, M expired".
3. **Health thresholds differ.** `lib/home/health-state.ts:43,49` (broken at >=40 errors, never degrades) vs `lib/system/control-tower.ts:107-111` (exception at any error, rose at >=10). INFERRED: on an ordinary day Home says healthy while the tower is rose. Fix: one threshold table imported by both.
4. **"Pull to refresh" with no working retry.** `app/(mastery)/missions/page.tsx:327,470`, `components/missions/deck-evidence.tsx:109`, `components/missions/deck-triage.tsx:35`; the pull gesture calls `router.refresh()` (`components/layout/swipe-navigation.tsx:129`), which does not refetch client tRPC reads. Fix: a Retry button calling `refetch()`, as `home-console.tsx:81-87`.
5. **Cron controls too small.** `app/(mastery)/system/crons/page.tsx:608-624,629-633,402,416`: kill switch + run-now about 24 px, 6 px apart; filter pills small. Fix: min-h-11, more gap, confirm on run-now.
6. **Inbox overwrite unconfirmed.** `app/(mastery)/system/inbox/page.tsx:262-282,58`: buttons about 28 px; `handleResolve("overwrite")` has no confirm. Fix: 44 px + two-tap confirm (useConfirmDialog).
7. **Stats sticky tabs under the status bar.** `app/(mastery)/stats/page.tsx:173-177` sticky top-0 with black-translucent + viewportFit cover (`app/layout.tsx:48,72`). INFERRED. Fix: `top-[env(safe-area-inset-top)]`.
8. **Raw error text.** `app/(mastery)/error.tsx:40` shows error.message verbatim. Fix: fixed sentence + digest.
9. **People dossier error** `app/(mastery)/people/page.tsx:739-741` prints the raw message, no Retry. Fix: reuse the EmptyState ERROR with Retry from `:713`.
10. **PLAN.md stale** `docs/design/ui-v3/PLAN.md:3,20` (W5a/W5b merged; 0 loading.tsx, 17 routes). Fix in the wave PR.

## P2: ugly or inconsistent

11. Stats Learn `components/actions/mode-learn.tsx`: 67 off-grammar hues, 12 transition-all (Stats carries 87 of 153 hues).
12. `components/panel.tsx` is a second card primitive (34 uses in 11 files); ratchet does not count it. Ruled sections + a `panel` ratchet counter.
13. `components/system/hub-grid.tsx`: a grid of severity tiles; make ruled rows with a state word.
14. Stats hand-rolled tablist (`stats/page.tsx:173-198`): reuse `PageTabs`.
15. `app/not-found.tsx:9-21`: Panel, text-white, off-voice copy; rewrite in the Home voice.
16. `/system/inbox:169` raw error; the word "Inbox" means 3 things.
17. `decisions/[id]/page.tsx:212-229`: raw error in mono, no Retry.
18. `photo-improver/page.tsx:146` lowercase title; 7 Panel boxes.
19. `system/alerts/page.tsx:412` "Show all" pill about 22 px.
20. `components/ui/confirm-hold.tsx:129` h-9 (36 px).
21. `journal/page.tsx:46` min-h-screen; `journal-feed-view.tsx:141` pb-20; `home-console.tsx:65` pb-16: use the layout's bottom-chrome padding.
22. `missions/page.tsx:256` dead description prop.
23. `components/hud/app-badge.tsx:7-10` stale comment path.
24. Ratchet baseline still has 48 em dash, 3 emoji, 20 small input, 23 transition-all, 5 uppercase.

Dead code (repo-wide importer grep): `components/actions/loop-stream.tsx` (0 importers), `loop-row-item.tsx`, `event-timeline.tsx`, `derive-mission-matrix.ts` (test-only importer): 48 of 261 ratchet points. Check `tests/components/ime-enter-sites.test.ts` before deleting.

Task-detail files (fenced while the task-upgrades session works): `components/missions/execution-panel.tsx`, `mission-task-row.tsx`, `components/inspector/panels/task-inspector.tsx`, `task-edit-sheet.tsx`.

## Cross-page sync

| Shared number | Agree? |
|---|---|
| Pending approvals (Home, badge, /system/actions, observability, Telegram) | No (finding 2) |
| System health (Home dot, tower, hub chips, Chat pill) | No (finding 3) |
| Unresolved alerts (tower, Alerts page, Telegram, command center) | No (finding 1) |
| Level and XP | Yes (one reader) |
| Mission and task counts | Different populations, no conflict found |
| "Inbox" | Same word, 3 meanings (finding 16) |

## Waves

| Wave | Scope | Size |
|---|---|---|
| Sync (first) | findings 1, 2, 3, 4, 8, 9, 10 with tests that break the old behaviour | about 1 day |
| W5c Control | ruled sections + 44 px on System detail pages; findings 5, 6, 12, 13, 15-20; `panel` ratchet counter | 1-2 days |
| Cleanup | delete dead files; Stats Learn recolour; Stats PageTabs + safe area (7, 14); lower baselines | about 1 day |
| Gates | add the 6 uncovered routes to the phone specs | small |

Not checked: rendered layouts and click-through (R-35), live values behind findings 1-3, Chat internals, contrast on tinted tiles.
