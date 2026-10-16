# UI v3 plan: Command Deck, finished

**Status (2026-10-15):** Wave 0 merged (#3056), W0b merged (#3065), W1a merged (#3066: uppercase sweep + net, header diet, aura to state word, spring tokens, em dash and emoji sweep). W1b (the shell: approvals land on Approvals, ticker rows as `Link`, pin-to-tab-bar, Command slot, v3 baselines committed) is in progress on `statenour/ui-v3-w1b`. Every later wave needs Nour's go.
**Base:** origin/main `ec21736f9` when W0 started; the W0 PR merged newer main before integration. **Owner:** the manager session "bdnick ui upgrade" (job id `2026-10-15-bdnick-ui-v3`).
**Genome:** COMMAND DECK ([`docs/design/SURFACE-DNA.md`](../../../../../docs/design/SURFACE-DNA.md)): one dominant thought per screen, then a rail; void and depth; the mission is the dominant object.
**Builds on:** UI v2 ([`../ui-v2/PLAN.md`](../ui-v2/PLAN.md), [`SYSTEM.md`](../ui-v2/SYSTEM.md)) and the workbench grammar ([`../ui-workbench-2026-09-15.md`](../ui-workbench-2026-09-15.md)).
**Evidence rule:** counts and file:line cites below are dated 2026-10-15 and drift. Re-verify before relying on one.

## 1. Outcome and proof

- Done: Home, Missions, Chat, Brain and Stats look obviously new next to v2, and the five phone jobs take fewer taps. The jobs: what needs me, ask Nick, approve, capture, why did it fire.
- Proof: a v3 distance gate (at least 0.35 from frozen v2 renders, same instrument as the v2 gate: `tests/e2e/visual-distance.ts`), tap counts per journey, and Nour's own six-feet look at one screenshot per PR.

## 2. Why v3 (audit of all 37 routes, 2026-10-15, read-only)

1. v2 re-skinned every page but recomposed only Home: the `uppercase` utility appears in 201 of 336 TSX files (623 hits); 43 files use StandardPage and so share one eyebrow + title + description header; a state-colored aura wraps every page (`components/hud/ambient-aura.tsx:36`, `app/styles/effects.css:657-678`).
2. Failure UX is the weakest part, and it is when Nour opens the app: People says "tap reload" with nothing to tap (the failure branch of `app/(mastery)/people/page.tsx`, fixed in W0); Home's approvals row lands on the Logs tab, not Approvals (`app/(mastery)/system/actions/page.tsx:196`); the alert inspector prints developer copy (`components/inspector/panels/alert-inspector.tsx:121-123`, fixed in W0).
3. Navigation: 4 tabs plus More. Brain, People, Stats are 2 taps; system pages 3; `/intelligence/ledger` 4 (an orphan chain). The System hub has 20 tiles, 5 of them QA fixtures. Two "brief" surfaces exist.
4. iPhone haptics do nothing: `lib/ui/haptic.ts` requires `navigator.vibrate`; MDN browser-compat-data (read 2026-10-15) has `api.Navigator.vibrate` Safari `version_added: false` and iOS Safari mirroring it. About 48 call sites in 9 files.
5. Speed is unmeasured (LCP, INP, CLS never measured). 307 of 336 TSX files are client roots; one `loading.tsx` for 37 routes.

## 3. Waves (one PR each, one validated push per PR)

| Wave | What changes | Gate | Waits for |
|---|---|---|---|
| W0 gates and honesty, invisible | Four honesty fixes (haptics row, People read failure + Retry, alert inspector copy, Brain loading line); ratchet tests for uppercase, em dash, emoji, `transition: all`, Tailwind duration classes over 300 ms, inputs under 16 px; this doc | Tests red first; ratchets proven by planted violations | nothing |
| W0b fixture lane | v3 distance spec (opt-in until baselines exist), Playwright-stubbed DEMO fixtures under `tests/e2e/fixtures/`, workflow dispatch wiring, v2 baselines captured in CI | Controls first: identical re-render scores 0.000, a 16 to 64 px shift stays under 0.35 | a platform-lane edit to `.github/workflows/e2e-statenour.yml` (dependabot #3014 merged as 2d7d5175e; Playwright 1.64.0 is on main); lands before W2 |
| W1 shell and grammar | W1a (merged #3066): stop stray uppercase; header diet; replace the aura with a state word + notch; spring tokens. W1b (in progress): pin-to-tab-bar + Command tab; approvals land on Approvals; ticker rows as `Link`. Not in scope: /goals and /scoreboard, which have been `redirect()` stubs since 2026-05-30 (f162673e6), so nothing to do | Ratchet baselines drop; Home and Missions at 390 vs v2 | W0 |
| W2 Home deck + Missions | Verdict hero; finite brief (max 7 ruled cards, Keep/Less, "Done for today"); approve in place; right rail at 1280+; one capture control; detent sheet pilot | Distance >= 0.35 at 390 and 1440; iPhone check | W1, W0b |
| W3 Chat | Header pill becomes a dot; tap-to-attach chip; error card for the new Retry behavior; composer at least 16 px | Distance gate; iPhone check | the T2 branch `statenour/t2-streaming-receipts` merged |
| W4 Mind | Brain 1-row compact tabs; People attention list first (Retry shipped in W0); Journal one field, no emoji; Stats 3 tabs + verdict line | Ratchets + gate | W2 |
| W5 Control | System attention strip first, QA fixtures under one "Lab"; Priority/Other lanes for inbox + alerts; dismiss-with-reason; Settings cleanup | Ratchets | W1 |
| W6 intent surface (later) | Nick composes the screen from typed cards | Not scheduled | the two typed-card registries merged, Keep/Less live for 2 weeks, W2 gate green |

The W0 ratchets do not tighten by themselves: each wave PR that removes violations runs `UPDATE_RATCHET=1` (`pnpm exec vitest run tests/repo/ui-v3-ratchets.test.ts`) and commits the lowered numbers. A legitimate new number is added with `UPDATE_RATCHET=init` in the PR that adds it, with the reason in the PR body, and is reviewed like any raise.

Estimates (not measured): about 1 day per wave at v2's pace; CI cost about 8 to 12 runner-hours for six PRs.

## 4. Mechanisms we steal (mechanism, not skin)

| Idea | Source, date | Wave |
|---|---|---|
| Pin-to-tab-bar | https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile (2026-01-22) | W1b |
| Command as a tab | https://developer.apple.com/design/whats-new/ (2026-06-08) | W1b |
| CSS `linear()` spring tokens | https://www.joshwcomeau.com/animation/linear-timing-function/ (2025-10-28, updated 2026-05-05) | W1 |
| Animate first encounters only | https://rauno.me/craft/novelty (2026-02) | W1 |
| Detent sheet (peek, half, full) | https://base-ui.com/react/components/drawer (docs show v1.9.0, undated) | W2 pilot |
| Finite daily brief with expiry and Keep/Less | https://help.openai.com/articles/12293630-chatgpt-pulse (launch about 2025-09, CLAIM from press) | W2 |
| Priority/Other inbox lanes | https://linear.app/changelog/2026-09-03-priority-inbox (2026-09-03) | W5 |
| Tap-to-attach context chip | https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile (2026-07-30) | W3 |
| Compact content-width tab strips | https://linear.app/now/behind-the-latest-design-refresh (2026-03-12) | W4 |
| Dismiss with a reason suppresses repeats | https://cursor.com/changelog (2026-09-23) | W5 |
| Motion numbers as tests (under 300 ms, `:active` scale 0.97, no animation on keyboard-initiated actions) | https://github.com/emilkowalski/skill (created 2026-03-16); copy the rules, do not install | W0 ratchet covers only Tailwind duration classes over 300 ms; `:active` scale and keyboard-initiated motion are W1 |
| Web Interface Guidelines as tests (inputs at least 16 px, no `transition: all`, reduced motion) | https://vercel.com/design/guidelines (undated); copy the rules, do not install | W0 ratchet covers inputs and `transition: all`; reduced motion has no test yet |

Not doing: NumberFlow, Liveline and morphing icons (new dependencies), `corner-shape` squircle (not on iOS Safari), Speculation Rules (not on iOS Safari), sync engines (Zero, Linear-style), CSS `base-select` replacing Base UI, Raycast-style auto contrast.

Browser support facts used (webstatus / MDN browser-compat-data, read 2026-10-15; iOS Safari latest is 27.0): `linear()` since iOS 17.2; `@starting-style` since 17.5; scroll-driven animations since iOS 26.0; `text-wrap: pretty` since 26.0; `field-sizing: content` since 26.2; cross-document view transitions since 18.2. Not on iOS Safari: `interpolate-size`, `calc-size()`, `corner-shape`, Speculation Rules, Vibration API.

## 5. Alternatives, 10x, kill criteria

- **A, evolve in place:** keep 37 routes and polish by group. Reuses everything; cannot fix the sprawl.
- **B, consolidate first:** redirect and merge about 10 routes, then polish. Deletes work; cannot change the look alone.
- **Pick:** B-lite inside W1 and W5 (tombstones, fixtures, orphans) plus A on the five daily surfaces. Low-traffic pages get only the global rules.
- **10x (W6):** an intent surface where Nick composes the screen from typed cards (A2UI vocabulary, see `docs/UPSTREAMS.md`). It removes the question "which page do I open". Blocked until the two typed-card registries merge.
- **Kill or switch:**
  1. Distance below 0.35 on Home or Missions after W2: stop polishing and change the composition.
  2. The detent sheet fails in the iOS PWA (scroll lock, safe area, keyboard): keep the hand-rolled sheet and add springs only.
  3. Two red lane returns for the same reason, or any edit under a sibling's lease: stop and name the assumption.
  4. A wave needs a dependency: a separate platform-lane PR, with Nour's go.
  5. Nour's iOS is below 26: no scroll-linked header, no polyfill.

## 6. Pages by group (all 37 routes)

| Group | Pages | Treatment |
|---|---|---|
| Deck | Home, Missions, Chat | The six-feet wave: one dominant thought per screen, then a rail |
| Mind | Brain, People, Journal, Stats | Compact tabs, verdict + notch per page, attention first, no emoji |
| Control | System hub and 16 subpages, Settings, Proof, Intelligence x2 | Triage first, fixtures under Lab, orphans folded in |
| Library | Content, Links, Photo improver, Learn, Pins, Decisions/[id] | Global rules only (caps, header, em dash) |
| Edge | Sign-in, shell (tab bar, spine, palette, inspector), redirects | Pin-to-tab-bar, Command tab, palette System group built from the hub list |

## 7. Session protocol (so sessions do not collide)

- Before each wave: footprint check on the claimed paths (`git -C <worktree> diff --name-only origin/main...HEAD -- <paths>` and `git -c core.fsmonitor=false -C <worktree> status --porcelain -- <paths>`), GitHub lease refs, open PRs. Then lease `statenour/ui-v3-<wave>`.
- Messages to sessions: first line `REPLY NEEDED:` or `NO REPLY NEEDED:`, one decision per message, say what we will not touch, close the loop in one line.
- Order: W3 waits for the T2 branch (it edits `features/chat-v2/components/chat-island.tsx`, `use-chat-stream.ts`, adds `features/chat-v2/lib/saved-turn.ts`, `lib/ai/receipts/*`, `app/api/ai/chat/*`). W0b no longer waits for #3014 (it merged as 2d7d5175e); it waits only for the platform-lane edit to `.github/workflows/e2e-statenour.yml`. W0 to W2 add no dependency, so no `package.json` or lockfile edits.
- Hot files, one writer at a time: `app/styles/*`, `components/layout/*`, `docs/UPSTREAMS.md`, `docs/agent-os/MANAGER-LEDGER.md`.
- At most 2 background agents at once; no dev server or full suite without telling the other sessions first (a dev server measured 4.5 to 6.3 GB RSS in CI).

## 8. Unknowns and decisions

Unknown (cheapest check in brackets): Nour's iOS version [Settings, General, About]; real-data layouts at 390 (all committed screenshots are empty-database, 2026-10-02) [fixture lane W0b]; per-card feedback storage for Home [grep the Home brief writer before W2]; the detent sheet inside the iOS PWA [device test in W2]; haptics on a device [2-minute test]; LCP, INP, CLS [Lighthouse mobile or a web-vitals beacon].

Decisions, defaults assumed until Nour says otherwise (confirm before W2): v3 must pass the six-feet test vs v2 on Home and Missions (yes); the bottom ticker shows only when something changed (yes, his earlier request makes it his call); keep Home's brief and retire `/intelligence/brief` (yes); Keep/Less stored on the device first, no schema (yes); an accessibility gate via `@axe-core/playwright` as a separate platform PR (yes).

W2 decisions (2026-10-16, branch `statenour/ui-v3-w2`): the brief is rows, not cards (`components/home/brief-rows.tsx`, cap `BRIEF_ROW_CAP` = 7); Keep / Less lives under `nour:brief-feedback` as `{kind -> {verdict, at}}`, Less hides a KIND for seven days, Show hidden is the way back; Home records only `accepted` on the lead (alternatives and Why left Home; the Missions hero keeps Pick different); the brief carries the two oldest LIVE approvals (`APPROVAL_ROWS_CAP`) for in-place approve through the /system/actions mutations behind the house confirm; the detent sheet pilot was not shipped (kill criterion 2: snap points and scroll lock cannot be proven in jsdom, and no device was in the loop), so `PulseFeedSheet` stays a Dialog.

## 9. Audit top ten mapped to waves (file:line dated 2026-10-15)

| # | Fix | Where | Wave |
|---|---|---|---|
| 1 | One base.css rule stops stray `uppercase`, allowlisting `.eyebrow`, `.vt-eyebrow`, `.section-label`, `.text-eyebrow`, `.vt-verdict`; the chat shell (`data-chat-shell` on the chat page root) stays outside it until W3 | `app/styles/base.css:305-320` (precedent) | W1 (ratchet in W0) |
| 2 | Replace AmbientAura with a state word + notch; edit the pinned tests | `components/hud/ambient-aura.tsx:36`, `app/styles/effects.css:657-678` | W1 |
| 3 | Approvals link opens Approvals; approval-windows box below the list; ticker rows use `Link`; alert footer in plain words | `lib/home/operator-brief.ts` (about 408, 654), `app/(mastery)/system/actions/page.tsx:196,606-640`, `components/ultron/bottom-pulse-ticker.tsx:406-410`, `components/inspector/panels/alert-inspector.tsx:121-123` | W1 (alert footer in W0) |
| 4 | Header diet: eyebrow only when it adds information; drop the description on core pages. Exception: /missions keeps its description until W2 lands its hero (without it the 390 render scored 0.342 against the v2 gate, CI run 38834210402) | `components/layout/standard-page.tsx:177-186`, `components/layout/header-diet.ts` | W1 (Missions in W2) |
| 5 | One state block with Retry for empty, loading, error | `app/(mastery)/people/page.tsx` (failure branch, fixed in W0), `app/(mastery)/stats/page.tsx:62-72` | W0 (People), W4 |
| 6 | Sweep em dashes, emoji, More-sheet emoji | `lib/floating-home/smart-now.ts`, `components/journal/reflect-composer.tsx:93-102` | W1, W4 |
| 7 | Delete the Missions FAB, fold "New mission" into the capture row | `components/actions/omni-capture-modal.tsx:112-115`, `app/(mastery)/missions/page.tsx:352-381` | W2 |
| 8 | Brain single scrolling lens row, filters inside the canvas | `components/layout/page-tabs.tsx:223`, `app/(mastery)/brain/page.tsx:80-100` | W4 |
| 9 | Chat capability pill becomes a dot | `features/chat-v2/components/chat-capability-indicator.tsx:49-57`, `chat-island.tsx:285-289` (leased by T2) | W3 |
| 10 | Fold the 5 QA fixtures under Lab; palette System group from the hub list (/goals and /scoreboard already `redirect()`, since 2026-05-30) | `components/system/hub-grid.tsx:121-386`, `components/command-palette.tsx:345-357` | W5 |
