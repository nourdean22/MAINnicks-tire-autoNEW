# Gate — "NOUR OS: Adversarial Audit + Upgrade of the AI-OS Surfaces" (2026-08-10)

The eleventh externally-authored mega-plan, gated per
[`.claude/skills/plan-gate`](../../../.claude/skills/plan-gate/SKILL.md) before any
code was written.

**Verdict: this plan measures unusually well and concludes badly.** Nearly every
individual figure in it is exact. The number its entire subtractive half rests on
is not, because that number is a *ratio* and nobody checked the denominator.

**Nothing was deleted as a result of this gate.** The one deletion it proposed as
"free" would have destroyed 634 lines of working code — see "The near-miss".

## What the plan got right (verified with `git ls-files | xargs wc -l`)

| Claim | Actual |
|---|---|
| `lib/brain` ≈ 51k · `lib/ai` ≈ 50k · `lib/services` ≈ 54k | **51,146 · 49,646 · 54,153** — total 154,945 vs its "155k" |
| ghost-nick 564 · wisdom-distiller 556 · contextual-recall 1176 | **564 · 556 · 1176** — exact |
| autonomous-engine 1405 · brain-graph 641 · skill-extractor 1015 | **1405 · 641 · 1015** — exact |
| §C1 pages: missions 303 · pins 437 · journal 89 · knowledge 414 · scoreboard 13 | **all exact** |
| 38 pages · 102 Prisma models · 3,343 schema lines · 16 `system/*` pages | **all exact** |

Treat its per-file numbers as trustworthy. That is rare here and it earns trust —
which is exactly why the failure below matters.

## The number that is wrong

§A1 asserts a **93:1** machinery-to-domain ratio and derives "delete or freeze
~60% of the introspection layer" from it.

The numerator is right (154,945). The denominator is invented. §A1 sizes the
domain surface as *"journal 68, missions 79, pins 64, home 53"* ≈ 1.7k. Those four
figures appear nowhere in this repo — and **the plan's own §C1 contradicts them**,
listing journal 89, missions 303, pins 437. §C1 is the correct set. There is no
`app/home/page.tsx` at all.

Counted properly, the surface the machinery serves is:

| Layer | Files | LOC |
|---|---|---|
| all `app/**/page.tsx` | 38 | **11,087** |
| `app/**` (routes, handlers, layouts) | 440 | 53,457 |
| `components/` | 321 | **82,812** |
| `features/` + `hooks/` | 65 | 9,896 |

`lib/{brain,ai,services}` = 154,945 against ~146,000 of UI-side code. **The real
ratio is about 1.06 : 1.** Even the most machinery-favourable framing available —
`lib/brain` alone (51,146) against page shells alone (11,087) — is 4.6:1.

Two things produce 93:1: a denominator that contradicts the plan's own later
section, and the omission of `components/`, which is where an App Router app keeps
its UI. A `page.tsx` is a route entry, not the feature.

**Provenance:** `/people (1,002 LOC)` is mandate 9's *pre-refactor* figure — the
file is 1,017 and was decomposed the previous day in #1473. §A1's numbers were
inherited from an earlier plan rather than measured; §C1's were measured.

## Refuted

| Claim | Reality |
|---|---|
| §A6 `lib/ai/moneyprinter` is "cargo-culted dead weight. Delete it." | **Live, and deliberately provisioned in production.** Registered tool at `lib/ai/tools/system.ts:1566`; present in `lib/ai/tools/catalog.ts`, `lib/ai/tool-families.ts`, `lib/ai/chat-mode.ts:419`, and a `nick-quality-evals` expectation. `next.config.ts:43` traces `lib/ai/moneyprinter/**/*` into the standalone build for `/api/ai/chat`. `Dockerfile:90` installs `python3 ffmpeg imagemagick py3-pip` + a pinned pip set at runtime. `Dockerfile:22-28` records the Alpine bump that broke its Python dep and **failed the statenour deploy on 2026-08-03** — the Alpine release is pinned because of this tool. `docs/UPSTREAMS.md` row 30 already recorded it as live. |
| §A4 calibration "cannot function for you — no resolution habit"; delete the stack | `scorePendingPredictions()` runs **nightly, unattended**, from `app/api/cron/brain-intelligence/route.ts:34` → `lib/brain/outcome-tracker.ts:46`. Falsified once already, 2026-08-09, as mandate 8 stage 5.5. **Second time this premise has shipped in a plan.** |
| §A5 collapse `lib/eval` + `lib/evals` + `lib/judge-eval` | `lib/eval` **0 tracked files** — deleted in #1465 after being proven *not* a duplicate of `lib/evals` (zero shared symbols). `lib/judge-eval` **0 tracked files**, never existed. `lib/evals` (4 files) is the live one. |
| §B1 "delete the XP layer" — `mastery-xp`, `xp-decay` | **0 tracked files each**, and `git grep masteryXp\|xpDecay` returns **nothing**. Same for `calibration-generator` and `ghost-predict`. The named modules do not exist. |
| §A2 "adopt Graphiti rather than maintain 641 bespoke LOC" | `docs/UPSTREAMS.md` row 65 already gives Graphiti a **PATTERN** verdict: take the supersession/provenance design, do not add a Python graph dependency to a working pgvector system. |
| "60 crons" | **50** `app/api/cron/**/route.ts`. |

## The near-miss — read this one

§C2 ranks second, after the health item: *"Delete the empty `/decisions/[id]` — it
breaks your build now. Free."*

**The file is 634 lines of implemented code** (25,277 bytes) — a decision-detail
page built as the showcase for the `DecisionSpread` primitive. Its sibling
`app/api/decisions/[id]/route.ts` is 47 lines. Neither is empty, and `next build`
has never been broken by them.

This gate deleted both anyway, then caught it in the commit diffstat and reverted
before pushing. The cause was the measuring instrument, and it generalises:

> **PowerShell treats `[` `]` in a path as a wildcard character class.**
> `Get-Content`, `Test-Path` and `Measure-Object -Line` against
> `app/(mastery)/decisions/[id]/page.tsx` do not match the literal file — they
> emit a non-terminating error and yield **zero lines**, which reads exactly like
> an empty file. `-LiteralPath` is required.

**28 route files / 2,735 LOC in statenour sit under a dynamic segment** and are
silently invisible to any naive PowerShell file scan. Any LOC census of this repo
run through `Get-ChildItem | Get-Content` under-reports every Next.js dynamic
route to zero. Use `git ls-files | xargs wc -l`.

Mandate 8 made the identical claim about the identical page ("the 0-line build
breaker is 635 implemented lines" — `nourcity-campaign-gate-2026-08-09`). **The
same false claim has now been made by two independent plans and falsified twice.**
It is the single most likely thing plan 12 will re-propose.

Same session, same lesson, opposite direction: the "inflated ~8% LOC" finding this
gate first published was itself a PowerShell artifact — `Measure-Object -Line`
under-counts where `wc -l` does not. **Retracted.** The plan's counts are accurate.

## Open, measured, NOT executed

`lib/ai/moneyprinter` is **201 MB / 149 tracked files**, traced into the Railway
image on purpose. The payload is 97% assets:

| Path | Size | Status |
|---|---|---|
| `resource/fonts/STHeitiMedium.ttc` | 55.7 MB | **Load-bearing** — hardcoded default at `app/services/video.py:920`, `app/models/schema.py:101,125` |
| `resource/fonts/{STHeitiLight,MicrosoftYaHeiBold,MicrosoftYaHeiNormal}.ttc` | **92.4 MB** | Reachable only via `webui/Main.py:1458` `get_all_fonts()` directory enumeration. The webui never launches — the tool shells `cli.py` |
| `resource/songs/output*.mp3` (29 files) | 56 MB | `bgm_type` defaults to `"random"` (`app/models/schema.py:94`), which globs this directory. Trimming to 2–3 is plausible; emptying it is not |

Roughly **140 MB** looks removable from the production image without touching the
tool. Deliberately not executed: it changes the deploy artifact for a lane that has
already broken one production deploy, and it diverges a vendored upstream tree.
Operator's call, with the numbers above.

## Not assessed

The Part B literature (Gollwitzer d=0.65, Deci d=−0.28/−0.40, Frattaroli d=0.15,
Roediger–Karpicke, Camacho AHI 24.5→12.3, the Apple Watch 66.3%/98.5% figures,
Kapur 2017) was not verified — outside a repo gate, and the plan's own §C6 concedes
several were not freshly sourced either. **§B5's recommendation to book a home
sleep apnea test does not depend on any claim falsified above.**
