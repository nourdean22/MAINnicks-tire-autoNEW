# Surface DNA — four products, four visual genomes (2026-09-16)

> **Why this file exists.** The monorepo converged. `apps/nickstire/client/src/index.css` and
> `apps/statenour/app/styles/tokens.css` independently define the same world — `#0A0A0A` /
> `#050505` void, `#FDB913` gold, Barlow Condensed display, `--radius: 0.5rem`, raised /
> elevated dark surfaces, gold glow, shadcn card primitives. Months of tokenising, polishing
> and "don't break the design system" pushed every surface toward one attractor: *small gold
> label · big heading · muted line · card grid · glow*. Nick's public site, Nick's admin,
> StateNour and Lot Intelligence read as cousins. Nickstire even wrote the split down —
> `docs/ADMIN_PHILOSOPHY.md` (2026-05-07, "Operator's Cockpit … DISTINCT from EUCLID GRIT")
> and an opt-in admin `neutral` theme (`.admin-shell[data-admin-theme="neutral"]`, 2026-06-01)
> — and then kept the admin tokens *alongside* the customer tokens, so the split never became
> the default look. There were dozens of forces pushing toward consistency and none pushing
> toward distinctiveness. This file is the counterforce: a **contract per surface** plus a
> **test that fails on convergence**.
>
> **What it is not.** Not a redesign programme and not "polish". Engineering stays converged
> (tokens, primitives, tests, data, a11y, responsive behaviour); only the *experience layer*
> diverges. shadcn / Base UI stay for behaviour — focus management, dialogs, keyboard, forms,
> a11y, state machines — and stop being the visual vocabulary. Card appearance, page
> composition, navigation grammar, hierarchy, surface treatment, motion character and metaphor
> are **per-surface decisions**, never inherited from a primitive.

## 1. The two-second test (the rule every visual review applies first)

> Remove the logo and every proper noun from the screenshot. Can a person say which product
> they are looking at within two seconds? **If not, the screen fails review.**

A screenshot of the admin that could plausibly be StateNour is a design defect, whatever else it
does right. The mechanical proxy is §4; the human test is the bar.

## 2. The genomes

| Dimension | Nick's public (**EUCLID GRIT**) | Nick's admin (**OPERATOR'S COCKPIT**) | StateNour (**COMMAND DECK**) | Lot Intelligence (**THE CAMERA IS THE INTERFACE**) |
|---|---|---|---|---|
| Metaphor | the physical shop on Euclid Ave: garage signage, service manual, street photography, newspaper ad, shop wall | dispatch board × trader terminal × repair-shop whiteboard | mission control for one life: command deck, timeline, dossier, cockpit HUD, living memory | surveillance / spatial: live video with reality overlaid |
| Geometry | irregular, editorial, full-bleed; sections do not live in boxes | rectangular, dense, tabular; rows and rails | cinematic, hierarchical; one dominant thought, then a rail | viewport + overlays |
| Primary material | photography (real tires, bays, concrete, salt, signage, Cleveland) | data | void and depth | video |
| Density | medium-low | extreme; no scrolling for facts | selective | contextual |
| Navigation | the customer journey | the workflow | the mission | space and time |
| Typography | huge advertising display, prices painted into layouts | compact utilitarian sans + mono numerics | dramatic command display (Barlow Condensed verdicts), mono metadata | technical mono overlays |
| Gold `#FDB913` | signage and price / action moments only | sparse; **owner / business priority** only, ≈90% neutral | identity — navigation, mission energy, rules | almost none; amber / red / green are *operational state* |
| Cards | rare — the exception | containers only, never decoration | selective (a card must earn its border) | nearly zero |
| Motion | physical, cinematic (850 ms reveals) | instant (≤200 ms, 0 acceptable) | deliberate (ViewTransition on inspect, nothing decorative) | real-time |
| Dominant object | a service / an action | a work item | a mission | a vehicle |
| Owns black + gold? | brand moments only | no | **yes — this is where the identity belongs** | no |

The lines that decide most reviews:

- **Public site:** if a section could be a SaaS card with tire copy, it is wrong. Prices, hours
  and the address are typography, not widgets. Imagery bleeds off the screen.
- **Admin:** the UI should almost disappear; it is an instrument. No cinematic hero, no
  marketing cards, no glass. Rows, queues, status rails, live numbers, exceptions, money, cars,
  work. `docs/ADMIN_PHILOSOPHY.md` already says this; the `neutral` admin theme becomes the
  default, not an opt-in.
- **StateNour:** one dominant thought per screen (`.vt-verdict`), a gold rule instead of a card,
  eyebrow `<h2>`s, ruled lists, mono 11–12 px metadata, 15–18 px body. Shipped on the five
  flagship pages in the Visible Transformation wave (`apps/statenour/docs/RECONCILIATION.md`,
  2026-09-16) and gated by `apps/statenour/tests/e2e/visible-transformation.spec.ts`.
- **Lot:** video first; everything else overlays reality (bay labels, dwell, arrival zone, the
  event ledger under the frame). Not a card grid with a video in one card.

## 3. Gold gets semantic scarcity

`#FDB913` had become the answer to "how do we make this ours?" on every surface, so it stopped
meaning anything. From here:

| Surface | Gold means | Everything else |
|---|---|---|
| Nick's public | the sign, a price, the one action | neutral, photographic |
| Nick's admin | owner / business priority (one thing on a screen) | `--data-*` semantic colours on graphite |
| StateNour | identity: the active nav item, the mission rule, the verdict's emphasis | void, fg tiers, amber/rose only for state |
| Lot | (none) | amber / red / green for operational state, mono white for labels |

Same brand family, four different worlds.

## 4. The sameness detector (the force that pushes away from homogenisation)

Every PR already produces screenshots — nickstire through Argos (`docs/UPSTREAMS.md`,
adopted 2026-09-15), statenour through the Visible Transformation gate. The detector reads
them and **yells on convergence**. It does not need to be academically right; it needs to fire.

**v1 — structural DNA audit (per surface, no new dependency).** For each flagship screen:
count of card-like containers (bordered + radius ≥ 8 px + a surface colour that differs from
the body), rounded-container ratio, surface-colour distribution, font families on `h1`/`h2`/
body, gold-pixel share of ink, border frequency, button morphology (pill / square / text),
and the dominant grid (columns at 1440). Each genome declares bands for these; a screen outside
its bands fails. StateNour's bands are asserted by the wave's gate helpers
(`apps/statenour/tests/e2e/visual-distance.ts` measures ink and mass; the DNA counts land beside
it in the next slice).

**v2 — cross-product distance.** The registered ink-mass distance already built for the
statenour gate (`visual-distance.ts`: 48 px cells, relative L1, ±2-cell registration; it reads a
64 px slide as 11–26 % and a recomposition as ≥ 50 %) is applied *across products*: a candidate
admin screen is compared against the committed StateNour renders, a public-site screen against
the admin renders, and the assertion is inverted — **they must be far apart**. Output shape:

```text
⚠ VISUAL CONVERGENCE · admin/home ↔ statenour/home
   ink-mass distance 0.21 (floor 0.45)
   shared: 81% surface palette · same display family · 9/11 rounded panels ·
           identical gold-accent hierarchy · similar 3-column card composition
```

**CLIP / DINO embeddings:** recorded in `docs/UPSTREAMS.md` as WATCH — a model in CI is a
dependency the structural + mass metrics do not need yet. Revisit only if the detector stays
green on a screen a human fails in two seconds.

## 5. Attack order — five representative screens

Do not do this page by page. Fix the five screens that define the four genomes; the grammar
propagates outward through the nearly-finished system.

| # | Screen | Genome | Status 2026-09-16 |
|---|---|---|---|
| 1 | StateNour Home (`bdnick.info/`) | Command Deck | **done** — verdict, gold-rule lead, ruled command line; gate 0.54 / 0.61 |
| 2 | StateNour Missions | Command Deck | **done** — NEXT MOVE hero, ruled board, rail; gate 0.58 / 0.50 |
| 3 | Nick's Home (`nickstire.org/`) | Euclid Grit | **next wave (nickstire session)** — full-bleed shop photography, painted prices, sections without boxes |
| 4 | Nick's Admin Home (`nickstire.org/admin`) | Operator's Cockpit | **next wave (nickstire session)** — the `neutral` theme becomes default; bays / waiting / declined money / needs-action as rows and rails; gold only for owner priority |
| 5 | Lot Intelligence (camera) | The camera is the interface | **deferred by the operator** ("leave the cameras for now") — video-first layout when the camera work resumes at the shop |

Nickstire's two screens change *what the screen looks like, not what it does* — the same rule
the StateNour wave used: existing capabilities must remain, visual similarity to the other
products is the failure condition.

## 6. How an agent uses this file

1. Name the surface and its genome in the first line of the plan ("This is ADMIN DNA").
2. Apply the two-second test to the *before* screenshot; write down what gives it away.
3. Build from the genome's dominant object and material, not from the primitives upward
   (`Card / Button / Badge / Tabs / Sheet / Grid` is the monoculture's grammar).
4. Spend gold only where the table in §3 allows.
5. Run the surface's gate (statenour: the Visible Transformation spec; nickstire: the proof
   workflow's Argos screenshots) and apply the two-second test to the *after*.
6. A screenshot that could belong to another product fails, whatever else it does right.
