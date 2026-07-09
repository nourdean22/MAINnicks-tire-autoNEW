# Curiosity-Arc Design — Service-Page Open-Loop Hooks (2026-05-30)

> Produced under `/brainstorming` rigor: Understanding Lock confirmed, approaches weighed, incremental design validated, decision log complete. **This is a validated design, NOT an implementation.** Nothing ships until the operator green-lights a build (held — separate from the in-flight push).

---

## 1. Understanding Summary
- **What:** A minimal whole-page *curiosity arc* — TWO open-loop micro-hooks (hero + one mid-page seam) that pull a reader down a service page to the price/proof/CTA.
- **Why:** Price was just removed from the hero + AEO (`eb26f584`); the page no longer prices-at-the-door, so it needs *pull* to carry readers to where price now lives (`#pricing`). Page structure is already a strong drip; the missing layer is connective curiosity copy.
- **Who:** Cleveland/Euclid drivers landing on a service page from search — mid-intent, deciding whether to call.
- **North star:** **Pure curiosity craft** — maximize hook *pull*, agnostic of final action (call/scroll/book all count), but always depositing the reader at price → proof → existing CTA.
- **Scope:** Money pages only (core 4 firm: `/brakes`, `/tires`, `/oil-change`, `/diagnostics`; `/emissions` + `/tire-shop-near-me` included in the map, optional for v1).
- **Non-goals:** NOT changing section order; NOT template-generic auto-derived hooks; NOT touching the other ~24 service pages; NOT new sections; NOT full 5-seam arc (deferred).

## 2. Assumptions
- **A1** — Hooks are copy + a thin anchor element, not new behavior/components.
- **A2** — Core-4 money pages firm; emissions + tire-shop-near-me optional this pass.
- **A3** — Authoring = optional `curiosityArc` field on `ServicePageConfig` (hand-tuned per page).
- **A4** — Every hook passes the brand-voice linter + clarity-gate.
- **A5** — Hooks deposit readers at the page's existing CTAs (call/booking), never dead-end.

## 3. Hard Rules (the guard that keeps "mix-per-page" from becoming six experiments)
1. **No dollar figure in any hero hook** — it's a *gap*; the number is the payoff at `#pricing`. (Preserves the price-off-the-top decision, `eb26f584`.)
2. **Must resolve true** on the section it points to (clarity-gate — no manufactured intrigue).
3. **Brand-voice clean** — Caregiver+Everyman, no "premium/tier/inspection"/LLM-slop.

## 4. Final Design

### Field shape (optional, additive — zero change to pages that omit it)
```ts
curiosityArc?: {
  heroHook?: string;    // self-relevant gap, NO $ → chip jumps to #pricing
  stakesHook?: string;  // honest stakes one-liner at the Pricing→Fear seam
};
```

### Render points (2)
1. **Hero chip** — if `heroHook` present, chip text = it (else falls back to today's `"What's it cost?"`); still `href="#pricing"`.
2. **Pricing→Fear seam** (FocusedServicePage.tsx ~line 673→676) — a thin centered one-liner with a `↓` affordance, rendered only when `stakesHook` present; no section band when absent.

### Per-page hook map (DIRECTION — final word-polish at build; no figures)
| Page | Hero hook (→ `#pricing`) | Mid stakes hook (Pricing→Fear) |
|---|---|---|
| /brakes | "Two prices. Which one's your car? ⌄" | "Wondering if it can wait? There's a line — here's it." |
| /tires | "New, used, or somewhere between? ⌄" | "Bald-tire math, before the rain decides for you." |
| /oil-change | "Less than you'd guess. ⌄" | "Skip it twice and the number changes. Here's how." |
| /diagnostics | "Free to find out what's wrong. ⌄" | "That light gets more expensive the longer it's on." |
| /emissions (opt) | "Failed E-Check? Here's the fix + the cost. ⌄" | "30 days, then your tags are the problem." |
| /tire-shop-near-me (opt) | "What's installed, out-the-door? ⌄" | "What the chains add at the counter (we don't)." |

Mechanism mix: hero = self-relevant gap; mid = honest stakes-reveal substantiated by the existing FearStats section. "Free/$0" allowed (a draw, not a price).

### Testing
tsc (optional field → no break to 24 pages) · brand-voice linter on the new strings · `grep '\$'` each hero hook = 0 · manual: chip → `#pricing`, seam renders only when set.

## 5. Decision Log
- **Approach A (optional config field)** — over inline-JSX (brand/structure drift, 6 divergent impls) and template-generic (operator chose hand-tuned for sharpness). Same proven pattern as `aeoAnswer`/`fearStats`/`crossSell`.
- **Minimal 2 hooks** — over full 5-seam arc (YAGNI; validate the concept on the two biggest drop-off points first: entry + post-price).
- **Mix-per-page mechanism** — over one-size-fits-all; bounded by the 3 hard rules.
- **Hero hook carries NO figure** — preserves the price-off-the-top win (`eb26f584`); the chip teases the gap, `#pricing` pays it off.
- **Money-pages-only** — over sitewide; highest-traffic focus, lowest blast radius.

## 6. Open Questions (resolve before build)
1. Final core-4 vs core-6 for v1 (emissions + tire-shop-near-me optional).
2. Exact word-polish of the 6 hook pairs (this doc is direction; copy finalizes at build + passes the linter).
3. Build timing — held; gated on operator green-light + the in-flight push landing.

**Status:** design validated + documented. Implementation NOT started. On green-light: ~1 optional field + 2 render points + per-page `curiosityArc` config on the money pages.
