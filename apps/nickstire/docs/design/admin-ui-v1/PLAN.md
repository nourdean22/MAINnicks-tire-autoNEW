# Admin UI v1 plan: Operator's Cockpit, finally the default

**Status (2026-10-17, morning):** W0 (#3070), W0b (#3078), W1 (#3080), W2 the Today board (#3091, 75472edbf) and W5 Reach, Machine and System (#3098, 62de053a8) merged and live; six pre-W1 renders frozen under `tests/e2e/admin-v1-baselines`. Today at 390 measures 0.359 (gate 0.35). W3 the Lot board lands in the PR from `nickstire/admin-ui-v1-w3`: Lot at 390 measures 0.518. W4 (Customers and Money) is in review. W6 waits for its own condition (W2 live two weeks, Keep/Less stored). Nour authorized W3 to W6 without a per-wave go (2026-10-16).

**Status (2026-10-19):** admin prune W1 (job 2026-10-19-admin-prune, branch `nickstire/admin-prune-w1`): the sidebar drops to 13 sections; Opportunities, Call Tracking, Market, Traffic, Growth, Nonstop Nick and Intelligence HQ become tabs or are cut; Keep/Less and Ad Studio are retired; one slug resolver serves the first URL, back/forward, the in-app event and `/admin/<slug>` paths.

**Base:** origin/main `5cfad6b78`. **Owner:** the manager session "nick admin ui upgrade" (job id `2026-10-16-nick-admin-ui-v1`).
**Genome:** OPERATOR'S COCKPIT ([`docs/design/SURFACE-DNA.md`](../../../../../docs/design/SURFACE-DNA.md) column 2, [`docs/ADMIN_PHILOSOPHY.md`](../../ADMIN_PHILOSOPHY.md)): dispatch board, rows and rails, graphite, gold only for owner priority, motion at or under 200 ms. Both docs have said this since 2026-05-07 and 2026-09-16; the live admin is still black and gold with a scan-line overlay.
**Method:** copied from the bdnick plan ([`apps/statenour/docs/design/ui-v3/PLAN.md`](../../../../statenour/docs/design/ui-v3/PLAN.md)): read-only audit, honesty first, ratchet tests, one PR per wave, a six-feet gate. Mechanism copied, files not.
**Evidence rule:** counts and file:line cites are dated 2026-10-16 (audit notes in the manager's shared notes folder, `nick-admin-ui-v1-audit-A-shell-daily.md` and `-B-rest-counts.md`) and drift. Re-verify before relying on one. Paths below are under `apps/nickstire/client/src/` unless noted.

## 1. Outcome and proof

- Done: on an iPhone, Today, Lot, Approvals and Customers look obviously new next to the current admin, and the five daily jobs take fewer taps: work the queue, call back, see who is on the lot, approve a held item, quote a walk-in (jobs INFERRED from code, confirm with Nour in one line).
- Proof: (1) a v1 distance gate, at least 0.35 from frozen current renders of Today and Lot at 390 px, same instrument as bdnick (`apps/statenour/tests/e2e/visual-distance.ts`, ink-mass distance), fed by stubbed DEMO fixtures because admin e2e needs `E2E_ADMIN_STORAGE_STATE` and skips without it (`tests/e2e/instagram-admin.spec.ts:21`); (2) tap counts per job before and after; (3) Nour's own six-feet look at one screenshot per PR; (4) the honesty ratchet never rises.

## 2. Why v1 (audit of the 20 registry sections, the Ad Studio route and the shell, 2026-10-16, read-only, 176 files, 53,368 lines)

1. The phone nav is a 36 px hamburger opening a 260 px drawer with 5 groups and 20 sections plus the Ad Studio link (`pages/Admin.tsx:320-340`); no bottom bar. Today is 0 taps, every other daily section 2, approving a held item 4. The walk-in quote lives only behind the 56 px palette FAB among about 32 actions (`components/admin/CommandSearch.tsx:238-249,782`). The home-screen icon opens the public site (`public/manifest.json` start_url "/").
2. Honesty: 9 of 12 non-Daily surfaces and 4 Daily ones show a failed read as 0, "none" or a green state. Worst: Today's "Needs action" card says "All clear" under a red banner when the whole bundle fails (`pages/admin/OverviewSection.tsx:197-199,498-506`; `today/MorningBrief.tsx:125`); the held-reel badge that exists because three reels sat stuck for 32 hours hides on a failed read (`pages/admin/instagram/InstagramAdmin.tsx:55`); Customers has zero `isError` reads (`customers/CustomersList.tsx`, `$0` at `:212`); Voice says "No calls yet today" on failure (`VoiceReceptionistSection.tsx:145,673`); Call Tracking shows 0/0/0 (`CallTrackingSection.tsx:39-40,154-179`).
3. Today buries the job: the queue is the 11th block (`OverviewSection.tsx:570`) after MorningBrief, SalesCard, ArrivalLoad, 4 stat cards, Promises, Inspection, ClosedLoop, ExceptionFeed and Freshness (`:452-548`); about 18 queries on first paint. Lot's "On the lot right now" panel (`LotSection.tsx:1978`) sits after a 90-line evidence panel and 4 stat cards in a 2,347-line file.
4. Grammar: `uppercase` 477 hits in 103 files; `tracking-*` 691; em dash 1,541 raw, about 620 outside comments; `transition-all` 73 plus `.number-animate { transition: all 0.6s }` on every StatCard value (`index.css:905-907`, `pages/admin/shared/cards.tsx:103`); `.revenue-glow` infinite pulse (`:840-846`); a fixed scan-line overlay over the whole admin (`:1042-1050`); topbar `backdrop-filter: blur(20px)` (`:692`); 97 off-palette purple/violet/cyan/indigo/pink hits by grep (171 by the ratchet, which also counts fuchsia and rose); 167 of 232 inputs under 16 px by a tag scan (145 by the ratchet, which follows only same-file classNames), mitigated on phones only by `index.css:1596-1604`; slop icons Zap 22, Sparkles 20, Star 9, Crown 5 files. Grep counts here are the audit's; the committed ratchet baseline (`client/src/__tests__/admin-ui-v1-ratchets.baseline.json`) is the authority from W0 on.
5. The `neutral` graphite theme SURFACE-DNA says "becomes the default" is dead CSS: `index.css:1617-1655` exists, nothing sets `data-admin-theme`, and `__tests__/admin-shell-contract.test.ts:101-104` forbids it. The 2026-06-01 modernization plan's Stream home never shipped (`docs/admin-modernization/HANDOFF.md`: branch not pushed).
6. Good news to keep: zero native alert/confirm/prompt calls (ConfirmDialog is in-DOM, 44 px buttons); badges carry three states (`counted`, `unknown`, `not_measured`); Lot, Approvals, Opportunities, Tires, Market and Ops Hub read failures honestly.

## 3. Waves (one PR each, one validated push per PR)

| Wave | What changes | Gate | Waits for |
|---|---|---|---|
| W0 honesty and gates, invisible | Honesty fixes: Today `queueTrustworthy` reads the bundle `isError`, the two cards show "unknown" on a missing slice, the morning brief says "queue unknown" and the banner gets Retry and plain words; CustomersList, CustomersBrief and CustomerProfile gate "No ... found" and the tiles on `isError`; IG held-reel badge, Voice todayCalls, Call Tracking stats/calls, WinBack tiles show unknown not 0; Ad Studio "Post now" goes through ConfirmDialog (the route mounts its own host) and locks after success, Copy caption awaits the clipboard; "Open work order" opens Money, where work orders render (no single-row deep link exists yet, `OverviewSection.tsx:354-357`); the section boundary names the section. Ratchet test over the admin tree: uppercase, emDash, emoji, transitionAll, slowDuration, smallInput, offPalette, with a zero-slack baseline. This doc. | Each fix red first; ratchets proven by planted violations; `pnpm run verify` green | nothing |
| W0b fixture lane | DEMO fixtures for Today, Lot, Approvals served by `page.route` (auth stubbed the same way, see Unknowns), frozen current renders at 390 and 1440, opt-in v1 distance spec reusing `visual-distance.ts`, a `workflow_dispatch` capture in `nickstire-proof.yml` (platform lane) | Controls first: identical re-render 0.000, a 16 to 64 px shift under 0.35 | W0; a platform-lane edit |
| W1 shell and grammar | Graphite becomes the default (wire or inline the neutral tokens, delete the forbidding test lines); bottom thumb bar with Today, Lot, Approvals, Customers, Search, 44 px targets; hamburger keeps the rest; drop scan-line, glow, blur, number-animate, revenue-glow; one base rule stops stray `uppercase` with an allowlist; em dash and emoji sweep; tab strips scroll instead of overflowing (`shared/table.tsx:212`); `start_url` for admins settled | Ratchet baselines drop; Today at 390 vs frozen render | W0 |
| W2 Today board | The queue first: finite ruled rows (car, customer, money, one verb), act in place (Call, Text, Done, Approve) with the existing ConfirmDialog, "Done for today" end state; MorningBrief to one line; stat cards to one strip; Promises, Inspection, ClosedLoop, Freshness under one collapsed "Checks" rail | Distance at or above 0.35 at 390; iPhone check by Nour | W1, W0b |
| W3 Lot, Approvals, walk-in | Lot: "On the lot right now" first, evidence and counters below; Approvals: Approve is not a red confirm; walk-in quote as a bar action and a row verb | Distance gate on Lot; tap counts | W2 |
| W4 Customers and Money | Lookup from the bar, profile with honest tabs, Dispatch and Work Orders rows, Nonstop Nick counter lookup with error state | Ratchets; iPhone check | W2 |
| W5 Reach, Automation, Truth, System | Outreach 7+3 pills, Settings 5+3+3, Instagram 12 views: Priority/Other lanes and one scrolling strip each; dead Call/SMS buttons wired or deleted; Reports tab stops listing repo paths; global rules only elsewhere | Ratchets | W1 |
| W6 the Stream (later) | One ranked self-clearing queue across sections, the 2026-06-01 plan, fed by W2's row grammar and Keep/Less feedback | Dropped 2026-10-19 by Nour: Keep/Less got 0 marks in 30 days; Today stays the daily board | n/a |

The W0 ratchets do not tighten by themselves: each wave PR that removes violations runs `UPDATE_RATCHET=1` and commits the lowered numbers; a legitimate new number uses `UPDATE_RATCHET=init` with the reason in the PR body. Same rules as the bdnick ratchet.

Estimates (not measured): W0 about half a day; W1 and W2 about a day each; W3 to W5 about half a day each. CI cost about 6 to 9 runner-hours for seven PRs at the 2026-10-08 rates.

## 4. Mechanisms we steal (mechanism, not skin; primary sources read by the manager 2026-10-16)

| Idea | Source, date | Wave |
|---|---|---|
| Tab bar navigates, never acts; fewer tabs; five or fewer by default; search as the trailing tab | https://developer.apple.com/design/human-interface-guidelines/tab-bars (change log 2026-06-08) | W1 |
| Controls at the bottom or middle of the display; swipe to act on a list row | https://developer.apple.com/design/human-interface-guidelines/designing-for-ios (undated, current) | W1, W2 |
| 44 x 44 pt default control size, 28 the floor; Reduce Motion drops zoom, scale, peripheral motion | https://developer.apple.com/design/human-interface-guidelines/accessibility (2025-06-09) | W1 |
| Pin what you use most to the bottom bar | https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile (2026-01-22) | W1 (fixed set first; pinning is W5 if asked) |
| Priority/Other lanes for a crowded inbox | https://linear.app/changelog/2026-09-03-priority-inbox (2026-09-03) | W5 |
| Compact content-width tab strips, density without overwhelm | https://linear.app/now/behind-the-latest-design-refresh (2026-03-12) | W1, W5 |
| Inputs at or over 16 px; never `transition: all`; honor reduced motion; 44 px on mobile; stable skeletons; all states designed; no dead ends | https://vercel.com/design/guidelines (undated); copy the rules, do not install | W0 ratchet (inputs, transition), W1 (rest) |
| UI motion under 300 ms; keyboard and 100+/day actions get no animation; transform and opacity only | https://github.com/emilkowalski/skill (created 2026-03-16, pushed 2026-10-11, MIT); copy, do not install | W0 ratchet (durations), W1 (no entrance animation on the queue) |
| Error summary at the top, always shown, receives focus | https://design-system.service.gov.uk/components/error-summary/ (v6.2.0, 2026-06) | W0 (section failure copy), W2 |
| Safe-area insets for the bottom bar in the standalone PWA | https://developer.mozilla.org/en-US/docs/Web/CSS/env (2026-10-08) | W1 |

Not doing: a sync engine, NumberFlow or any new dependency, Liquid Glass or blur anywhere, a dark/light toggle redesign (dark graphite is the cockpit), the Stream before W2 proves the row grammar.

## 5. Alternatives, 10x, kill criteria

- **A, evolve in place:** keep 20 sections and the drawer, fix honesty and grammar per section. Reuses everything; from six feet nothing changes.
- **B, the Stream rebuild (2026-06-01 plan):** one ranked queue replaces sections. Biggest payoff; needs entity pages and a ranker nobody has proven, and it dissolves Lot, which has its own board.
- **Pick:** A on honesty and grammar (W0, W1), then a cockpit shell (W1) and the Today board (W2) as the six-feet change; B is W6, earned by W2.
- **10x (W6):** the Stream, where the five jobs are rows in one queue and the sections become filters. Removes "which section do I open".
- **Kill or switch:**
  1. Distance under 0.35 on Today after W2: stop polishing, recompose.
  2. The bottom bar collides with iOS Safari's standalone bottom inset or the FAB: fold Search into the bar and delete the FAB.
  3. Admin fixtures cannot get past the auth gate without a real session: keep the gate opt-in on Nour's storage state and gate on tap counts and screenshots instead.
  4. Two red lane returns for the same reason, or any edit under a sibling's lease: stop and name the assumption.
  5. A wave needs a dependency: a separate platform-lane PR, with Nour's go.

## 6. Pages by group (21 registry sections + 2 standalone routes)

| Group | Pages | Treatment |
|---|---|---|
| Board (Daily, the six-feet wave) | Today, Lot, Approvals | Queue or board first; rows and one verb; checks under a rail |
| Desk | Customers, Sales Pipeline, Opportunities, Tires, Money (Unpaid, Declined, Dispatch, Work Orders), Nonstop Nick | Honest tabs, rows, lookup from the bar; global rules |
| Reach | Market, Marketing / Growth, Website & Local, Instagram, Outreach, Ad Studio | Priority/Other lanes, one strip per section, Post now confirmed; global rules |
| Machine | Intelligence HQ, Voice Receptionist, Call Tracking, Reports, Traffic to Revenue, Settings / Safety | Honesty fixes, dead controls removed, global rules only |
| Edge | shell (drawer, topbar, bar, palette, ConfirmDialog, DegradedDataBanner, AdminSectionBoundary), manifest | Graphite default, bottom bar, 44 px, plain-words failure copy, section name not registry id |

## 7. Session protocol

- Before each wave: footprint check on the claimed paths, lease `nickstire/admin-ui-v1-<wave>` with `scripts/agent-os/agent-start.mjs` (only a `[agent-start] leased` line is a receipt), `repo-status.mjs` for siblings on the same paths. Writer lanes: `lane-nickstire-client` only; `lane-nickstire-server` only if a read must change (none planned); `lane-platform` for the workflow edit in W0b.
- Before each push: a NO REPLY NEEDED message to the "bdnick ui upgrade" session with branch, files, PR number, head SHA, then the squash SHA after merge. Stay out of `apps/statenour`. Keep both rows on ledger or metrics tail conflicts.
- One validated push per PR (`pnpm run verify` locally; name the failing link, never "verify failed"); merge with `merge-gate.mjs` only while no other PR has node or e2e in flight; then live check `nickstire.org/api/health` `.deploy.commit`.
- Hot files, one writer at a time: `index.css`, `pages/Admin.tsx`, `pages/admin/registry.tsx`, `pages/admin/shared/*`, `docs/agent-os/MANAGER-LEDGER.md`.
- Skills per lane: nickstire-verify, nickstire-ios-pwa-primitives, empty-vs-error, positive-control-first, antislop (during, session override) with antislop-ui and antislop-layoutmobile for W1 onward.
- Machine: at most 2 background agents; no dev server or full suite without telling the other sessions first (3.4 GB free at 2026-10-16 03:00 UTC).

## 8. Unknowns and decisions

Unknown (cheapest check in brackets): the five daily jobs as the crew does them [one line from Nour]; which roles Mash, Manny and Zach hold, since `front_desk` and `tech` see fewer sections (`shared/adminPermissions.ts:23-24`) [Nour, or the users table read-only]; whether the installed icons open "/" or the last URL [Nour's phone, 1 minute]; whether a stubbed `/api/auth` reply lets fixtures past the MFA gate (`components/admin/AdminMfaGate.tsx`) [W0b spike, 30 minutes]; whether failed procedures throw or return sentinels (the honesty fixes assume `isError`) [read the 8 procedures in W0]; real-data layouts at 390 [fixtures]; iOS version [Settings, General, About].

Decisions, defaults assumed until Nour says otherwise (confirm before W1): graphite neutral becomes the admin default, gold only for owner priority (yes, SURFACE-DNA already says so); the bottom bar is Today, Lot, Approvals, Customers, Search (yes); the FAB goes when Search is in the bar (yes); `start_url` stays "/" and an admin-only shortcut is documented instead (yes, the public PWA shares the manifest); no new dependency in any wave (yes).

## 9. Audit top ten mapped to waves (file:line dated 2026-10-16)

| # | Fix | Where | Wave |
|---|---|---|---|
| 1 | "All clear" cannot render when the bundle failed; cards show unknown on a missing slice | `pages/admin/OverviewSection.tsx:197-199,498-511`, `today/MorningBrief.tsx:125` | W0 |
| 2 | Customers reads `isError`: list, stats, profile tabs | `customers/CustomersList.tsx:74,97,184-243,580-587`, `customers/CustomerProfile.tsx:435,519,572,624` | W0 |
| 3 | Held-reel badge, Voice today calls, Call Tracking stats, WinBack tiles show unknown not 0 | `instagram/InstagramAdmin.tsx:55`, `VoiceReceptionistSection.tsx:145,673`, `CallTrackingSection.tsx:39-40`, `outreach/WinBackSection.tsx:724` | W0 |
| 4 | Ad Studio "Post now" confirmed and locked after success | `pages/admin/AdStudio.tsx:112-117` | W0 |
| 5 | "Open work order" opens Money (work orders), not Customers; a single-row deep link and the hidden second button | `OverviewSection.tsx:354-357,397-400,630` | W0 (target), W2 (deep link) |
| 6 | Bottom thumb bar, 44 px targets, graphite default, no scan-line/glow/blur | `pages/Admin.tsx:320-345`, `index.css:692,840,905,1042,1617` | W1 |
| 7 | Queue first on Today; checks under one rail | `OverviewSection.tsx:452-570` | W2 |
| 8 | "On the lot right now" first on Lot | `LotSection.tsx:1848-1978` | W3 |
| 9 | Tab strips scroll; Outreach, Settings, Instagram lanes | `shared/table.tsx:212`, `OutreachHubSection.tsx:55`, `SettingsSection.tsx:50-56`, `instagram/InstagramAdmin.tsx:114-165` | W1, W5 |
| 10 | Dead and developer-facing: Call/SMS buttons without handlers, DegradedDataBanner copy, boundary prints registry ids, AdminAlertBar unused, Reports lists repo paths | `intelligence/CustomerIntelligence.tsx:94,97`, `components/admin/DegradedDataBanner.tsx:50-61`, `AdminSectionBoundary.tsx:54-79`, `AdminAlertBar.tsx`, `OpsHubSection.tsx:90-106` | W0 (copy), W5 |
