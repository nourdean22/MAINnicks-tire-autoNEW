# Agent Contract · statenour-os

Universal handoff doc. Any agent (Claude, Codex, Cursor, ChatGPT, or
a future-Nour) picking up work here reads this first.

---

## Who you're working for

**Nour Dean.** Single operator. ADHD. Owns Nick's Tire & Auto in
Cleveland. Lebanese-American. 31. Builds NOUR OS as personal mastery
+ business OS.

**Comm style:** ALL CAPS = emphasis, not anger. 5-10 asks per message
from phone. "GO" = execute now. "Continue" = keep going. "Deploy" =
commit + push + verify. Hates: vague work, lazy code, "does it
compile" handwaves, missing details, having to ask twice.

**The prime directive:** NEVER ASSUME. Verify by reading files, git,
DB, logs. When in doubt, verify.

**Quality bar:** Fortune 500 CEO minimum. "Good enough" is NOT good
enough.

---

## What you're working on

**statenour** — Nour's personal OS. Lives in the
[`nourdean22/MAINnicks-tire-autoNEW`](https://github.com/nourdean22/MAINnicks-tire-autoNEW)
monorepo at `apps/statenour/`, branch `main`, deployed by **Railway**,
served at `bdnick.info` (custom domain). Next.js 16 · Prisma 7 ·
Neon. The standalone `statenour-os` repo, the `codex/ollama-local`
branch, and Vercel are all retired. Companion app
`nickstire` lives in the same monorepo at `apps/nickstire/`. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the two-ring map.

---

## Startup checklist (first 60 seconds in this repo)

**Read these in order. Stop after step 3 if the picture is clear.**

1. `cd C:/Users/nourd/OneDrive/Desktop/nickstire-repo-staging/apps/statenour` (or platform equivalent).
2. `git status && git log --oneline -15` — what's uncommitted, what shipped recently?
3. **READ THIS FIRST:** [`docs/RECONCILIATION.md`](RECONCILIATION.md). It is the
   single source of truth for current reality:
   - HEAD commit, test count, pre-push gate count
   - Active wave + which tracks are open vs. blocked
   - Full v10 commit table with what each commit did
   - Status of every audit wave (v11 surface · cron x2 · brain x2 · API · self-audits)
4. Active execution plan lives in [`docs/project/V10-PLAN.md`](project/V10-PLAN.md).
   `UPGRADE-PLAN.md` is HISTORICAL (v8.x archive); don't use for current work.
5. Quick health (only if you're about to make changes):
   ```bash
   pnpm typecheck                 # expect: 0 errors
   pnpm test                      # expect: green (current count in RECONCILIATION.md)
   pnpm verify:hard               # statenour's full local gate
   ```
   If any fail, **fix before** you add new work. `verify:hard` runs
   typecheck · lint · test · raw-SQL audit · cron manifest ·
   prompt-size · `prisma validate`. The repo-root `lefthook.yml` pre-push hook
   hook separately runs `turbo build` for affected apps to catch
   Next.js prerender errors before Railway.

---

## Branch discipline

```
main   ← the one branch. Monorepo: statenour + nickstire share it.
         push → lefthook.yml pre-push runs `turbo build --affected`.
         Railway watches `main` with per-service watch paths and
         auto-deploys statenour-web on any push touching
         apps/statenour/**.
```

The repo-root pre-push hook (`lefthook.yml`) runs `turbo build --affected`
for the affected apps before letting a push leave the laptop — it
catches the Next.js prerender errors that only surface at build time.
statenour's own full local gate is `pnpm verify:hard`.

Skip pre-push once: `git push --no-verify` — but only when you know
exactly why.

---

## How Nour wants you to work

### Do

- **Big, thoughtful checkpoints.** A commit should be a complete
  increment — a feature landed, a surface polished, a wave closed.
  Not 6 micro-commits fixing typos.
- **Checkpoint-as-commit.** After each commit, update the
  `UPGRADE-PLAN.md` checkpoint log with the SHA so the next agent
  picks up cleanly.
- **Self-verification.** Run typecheck + lint + tests yourself before
  claiming done. Don't hand-wave.
- **Alive + interesting over static + minimal.** Pulse dots,
  sparklines, burn rates, live countdowns, freshness chips — if a
  number changes, animate it. If a number could mean "bad", tint it
  amber/rose.
- **Power + control everywhere.** Every cron has a kill switch and a
  manual run. Every integration has an enable toggle. Every AI call
  has a provider override.
- **Clever inside + outside the box.** Meta-intelligence (Ghost Nour,
  anti-pattern library, Nick-quality trend) is not scope creep —
  it's the thing.
- **Single source of truth.** `config/crons.ts` for crons.
  `lib/env.ts` for env. `config/retention.ts` for retention. If you
  add scattered state, you've introduced a bug waiting to happen.

### Don't

- **Don't scaffold "TODO" placeholders.** Half-finished surfaces annoy
  Nour more than missing features.
- **Don't leave `any` types behind** unless you're wiring a W6-level
  split. Every `any` is debt.
- **Don't delete without verifying.** Always run an import-graph scan
  before rm-ing a "dead" component. `/system/crons`-style false
  positives are common.
- **Don't over-document.** One comment when the WHY is non-obvious.
  Zero comments when the code is self-explanatory. Never reference
  "this fix" or "the current task" in code — belongs in commit
  messages.
- **Don't touch shared external state** (push, PR comment, Slack,
  SMS, destructive DB op) without explicit user OK.

---

## The 5 lies you might tell yourself

1. **"It probably works, I don't need to test."** Run the tests.
2. **"The orphan detection script said this is dead."** Grep the base
   name across all files. `device-controls.tsx` was a false positive
   once — will be again.
3. **"This warning doesn't matter."** It'll be 300 warnings by next
   week. Fix or document.
4. **"I'll just fix this one thing before the plan."** No. Update the
   plan first. Leapfrogging breaks the agent-handoff contract.
5. **"Nour won't care about this detail."** He will.

---

## Where to find things fast

| Looking for … | It's at … |
|---|---|
| Operator Biography & Context | [`OPERATOR-BIOGRAPHY.md`](OPERATOR-BIOGRAPHY.md) |
| Current state of the world | [`CURRENT-TRUTH.md`](CURRENT-TRUTH.md) + [`RECONCILIATION.md`](RECONCILIATION.md) (top entry). `UPGRADE-PLAN.md` §0 is HISTORICAL — do not use for current state. |
| Cron definitions | [`config/crons.ts`](../config/crons.ts) |
| Retention rules | [`config/retention.ts`](../config/retention.ts) |
| Env spec | [`lib/env.ts`](../lib/env.ts) · template `.env.example` |
| The 80 Prisma models | [`prisma/schema.prisma`](../prisma/schema.prisma) · map in [`DATA-MODEL.md`](DATA-MODEL.md) |
| Nick's tool catalog | `lib/ai/tools.ts` (W6 split pending — will become `lib/ai/tools/`) |
| System prompt | `lib/ai/system-prompt.ts` (W6.3 split pending — will become `lib/ai/prompt/`) |
| Chat pipeline | `app/api/ai/chat/route.ts` (W6.2 split pending → `lib/ai/chat/pipeline/*`) |
| Ultron surface | `app/(mastery)/page.tsx` + `components/ultron/ultron.tsx` |
| System ops deck | `app/(mastery)/system/*` |
| FloatingHome orb | `components/layout/floating-home.tsx` |
| Nav items + system tabs | `components/layout/nav-items.ts` |
| Cross-cutting state | `lib/state/nour-state.tsx` |
| Useful hooks | `lib/hooks/` (`useSystemPulse`, `usePullRefresh`, …) |
| Auth + middleware | `auth.ts` + `middleware.ts` |
| Product vision | [`ULTRON-VISION.md`](ULTRON-VISION.md) (partially superseded by v10.4) |
| Endpoint primary/helper map | [`ENDPOINT-HYGIENE.md`](ENDPOINT-HYGIENE.md) |

---

## Commit message format

Follow what's in git log. Example (commit `29dede9`):

```
feat(system+nav): v11.0 wave 2.4 + 2.5 + FloatingHome enrichment

Closes the 4-page observability deck AND makes the system health
signal ambient — Nour sees red/amber/gold on the floating orb
without opening anything.

/system/ai-cost · where the tokens go:
* ...

/system/actions · Nick's autonomous audit:
* ...

FloatingHome · live-vitals orb:
* Orb border tints by aggregate tone:
    gold  = calm (...)
    amber = watch (...)
    red   = alert (...)

Verification:
* tsc --noEmit → 0 errors
* eslint --quiet → 0 errors
* vitest run → 73/73
* check:crons → clean

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Structure:
- **Type + scope + summary.** `feat(...)`, `fix(...)`, `chore(...)`, `refactor(...)`, `docs(...)`.
- **1-sentence why.** What's the change for? What does it unlock?
- **Bulleted specifics grouped by area.** Give Nour enough to skim.
- **Verification block.** Prove it passes the gates.
- **Co-Authored-By.** Use your identity + model version.

---

## Respect the design philosophy

Quoted from [`UPGRADE-PLAN.md`](../UPGRADE-PLAN.md):

> Every page exposes at least one **knob** (filter, toggle, manual trigger, threshold).
> Every data surface shows **freshness** ("42s ago") and **provenance** (source chip).
> Every log is **drillable** — click row → full context + related records.
> Every cron has a **kill switch** + **manual-run** button + **last-N-runs** strip.
> Every error has **Nick's take** + **dismiss** + **open issue**.
> Every AI call has **cost** + **latency** + **provider** + **re-run w/ alt provider** button.
> Every number with a history has a **sparkline**.
> Every state transition has a **micro-animation** (150–250ms).
> Every input has a **keyboard shortcut**.
> Zero dead links, zero dead buttons, zero "not implemented yet" placeholders.

Don't add a surface that doesn't meet these. Upgrade the existing
one instead.

---

## Final rule

If you're about to do something that feels clever — adding a
sophisticated abstraction, clever workaround, elegant one-liner —
and it requires explaining itself: **DON'T.** The next agent needs to
grok it in under 30 seconds. Clear and boring wins.

If the clever thing is genuinely load-bearing, add one comment with
the **why**, not the what.

---

## Post-v11.1 status (updated 2026-04-22)

Since v11.0, the v11.1 "devastating lead" wave is mostly shipped.
Summary so new agents know what NOT to re-attempt:

### Shipped (don't re-do)
- All of Batches A, C1-partial, D1-D5, E5, F1-F5, G1-scaffold, G3-G6, H1-H6
- Meta-intel crons: correlation-scan (6h), decision-drift (weekly),
  prediction-streaks (daily), blindspot-surface (daily)
- `/brain/continuity` page · NudgePanel with 7d-dismiss ACK
- Chat: ambient/speaker mode (D2) · kinetic send morph · Streamdown
  replaced react-markdown · safe X-Persona sync · stall 6s/22s
- Business cards (CarsTodayCard · ConversionTrackerCard) UNMOUNTED
  from HQ per Nour — business data lives on admin, not statenour.
  Components preserved in `components/ultron/` so admin can mount.
- Browser agent scaffold live · inert until BROWSERBASE_API_KEY +
  BROWSERBASE_PROJECT_ID land in Vercel env
- Builder Sandbox: rollback · clone-commit · VS-Code · copy-path
- Retired-model Prisma shim DELETED (0 callers remain)
- `docs/BUSINESS-LANDSCAPE.md` + `docs/NICKSTIRE-QUERY-CONTRACT.md`

### Partially done (next agent picks up here)
- B2 · chat page decomp — 4 hooks extracted (haptics, error-guard,
  personality, stall). Remaining: useChatTransport, useChatKeyboard,
  useChatOverrides. Chat page is ~2800 lines.
- B4 · SSE reconnect — lite (6s/22s) done. Full heartbeat
  (server ping frames + resumable streams) not done.
- C1 · queryNick audit — `predictive-prefetch` + `pipeline-
  controller` wired. `lib/services/*` (customers/jobs/leads) still
  on stubs (acceptable — those are nice-to-have, not load-bearing).
- D5 · FreshnessChip — on 9 panels, missing on skill-library, ai-
  settings, cron-control. AnimatedCounter in ~5 spots.
- E1-E4 · visual polish — primitives ready, spread partial.

### Not done (queued)
- B3 · Virtualized message list (needs @tanstack/react-virtual).
  Must coordinate with use-stick-to-bottom + Streamdown memoization.
- Stagehand driver for browser_do (currently returns liveViewUrl
  only — no automated act/extract yet).
- A1 root-cause — diagnostic surfacing landed; waiting on Nour to
  paste actual error text from /brain after next load.

### Explicitly NOT on this repo
- **Snap Financing BNPL wiring** → nickstire/admin concern.
- **Cars/Conversion HQ cards** → moved to admin concept.
- **nickstire query action implementations** → build on nickstire
  repo. `docs/NICKSTIRE-QUERY-CONTRACT.md` has expected shapes.

### Pending external (cannot be done from here)
- Railway env vars: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
- nickstire ships 4 query actions (cars_today, estimates_conversion,
  estimates_aging, drop_off_ratio)

---

**Reconciled 2026-05-21** · infra sweep — the "what you're working
on", startup-checklist, and branch-discipline sections were rewritten
for the monorepo + Railway reality (was the standalone `statenour-os`
repo / Vercel / `codex/ollama-local` / `statenour-master`, all
retired). If a claim in this doc contradicts code reality, the code
wins · open an issue.
