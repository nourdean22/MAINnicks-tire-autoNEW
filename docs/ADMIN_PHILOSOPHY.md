# Admin Design Philosophy — OPERATOR'S COCKPIT

> The aesthetic + interaction movement for the admin section of nickstire.org.
> DISTINCT from the customer-facing EUCLID GRIT philosophy. Same brand,
> different user, different goal, different design language.
>
> Authored 2026-05-07 (wave-49) via canvas-design + kpi-dashboard-design +
> business-analyst skills. Codified before applying tokens, audits, and
> polish so future commits anchor here.

---

## The movement: **OPERATOR'S COCKPIT**

A high-density power-user interface for the shop owner running a 7-day-a-week
operation in real-time. Trader terminal energy meets shop manual. Every pixel
either delivers actionable information, surfaces a decision, or signals a
state change. The customer-facing site is a story. The admin is an instrument
panel.

The design pillar: **the user is Nour, who knows the shop's data
intimately and uses admin daily to make hundreds of small decisions.
Every visual decision either compresses time-to-decision or it wastes it.
There is no middle.**

---

## Customer site vs admin — the philosophical split

| Dimension | Customer (EUCLID GRIT) | Admin (OPERATOR'S COCKPIT) |
|---|---|---|
| **User** | Skeptical Cleveland driver, first/second visit | Nour, in admin daily, knows the data |
| **Goal** | Build trust → convert | Compress decisions → execute |
| **Density** | Macro-whitespace, breathing | High info density, no scrolling for facts |
| **Motion** | Cinematic 850ms reveals | Snappy 200ms transitions; 0ms acceptable |
| **Hierarchy** | One memorable anchor | Many parallel signals at a glance |
| **Aesthetic** | Industrial editorial / photo-grain warmth | Trader terminal / cool monospace data |
| **Copy** | Brand voice / persuasion | Operator shorthand / no fluff |
| **Color** | Yellow as accent + trust signal | Yellow as ONE of multiple data colors |
| **Typography** | Heavy slab grotesque H1s | Tight sans + monospace numerics |
| **Page padding** | py-20 lg:py-32 | py-4 lg:py-6 |
| **Forbidden** | Glass / antigravity / 3D | Whimsy / decoration / marketing energy |

If a visual decision could equally support either philosophy → it's the wrong
decision. The two are explicitly differentiated.

---

## Visual mood (in words)

- **Trader terminal sensibility.** Monospace numerics, dense rows, parallel
  charts, color-coded states. Bloomberg / Linear / Vercel-dashboard
  reference range — but with EUCLID GRIT undertones (yellow accents
  reserved for action moments, deep-cool-grey backgrounds, no
  saccharine emerald-blue gradients).
- **Information density wins.** Compress ALL the time. Two columns where
  customer-facing would have one. Dense tables where customer-facing
  would have cards.
- **State communicated through color, not chrome.** A row needing
  attention turns subtly amber on the left edge — no banner, no badge,
  no modal.
- **Motion is utility, not personality.** Hover state changes are
  instant. Loading states are skeletons not spinners. Page transitions
  are 100-200ms, never 800ms.
- **The numbers are the design.** Big mono numerals communicate before
  any chrome around them. Stat cards show value first, label second,
  context third.

---

## Color system — admin-specific extensions

Reuse the wave-43 token system (--brand-yellow, --bg-deep, etc.) and ADD:

| Token | Value | Where |
|---|---|---|
| `--data-up` | `#22c55e` (emerald-500) | Positive deltas, "above target" KPIs |
| `--data-down` | `#ef4444` (red-500) | Negative deltas, "below target" |
| `--data-neutral` | `#a1a1aa` (zinc-400) | Static or unchanging values |
| `--data-info` | `#3b82f6` (blue-500) | Informational signals (FYI, not action) |
| `--data-warn` | `#f59e0b` (amber-500) | Attention required, not yet critical |
| `--data-crit` | `#dc2626` (red-600) | Critical — act now |
| `--data-purple` | `#a855f7` (violet-500) | Reserved for unique semantic class (e.g., "one-time anomaly") — explicitly ALLOWED in admin where it's BANNED in customer-facing because admin user understands data-color semantics |

**Why violet is allowed in admin but banned in customer-facing:** the
customer reads violet as "SaaS / startup / trying-too-hard." The admin
user reads violet as "this is a distinct semantic class of data." Same
color, different audience, different meaning. The audit later confirms
the existing 47 violet/purple instances in admin are mostly correct
data-color usage.

---

## Typography system — admin-specific

- **Headings:** smaller than customer-facing. H1: text-2xl md:text-3xl.
  H2: text-lg md:text-xl. NEVER uppercase H1s. Uppercase ONLY for
  10-11px section labels.
- **Body:** text-sm (14px) default. Customer site uses 15-16px; admin
  trades readability marginally for density.
- **Numerics:** ALWAYS mono. Tabular figures. `font-mono` or
  `font-feature-settings: "tnum"`. Stat numbers should be SF Mono or
  JetBrains Mono visually, not the proportional sans body font.
- **Labels:** uppercase 10-11px tracking-[0.18em] font-semibold
  text-foreground/45. The "data label" register.

---

## Spacing — admin-specific (tighter than customer)

- **Section padding:** py-4 lg:py-6 (was py-20 lg:py-32 customer-facing)
- **Card padding:** p-3 lg:p-4 (was p-6 lg:p-8)
- **Row height:** h-10 to h-12 for table rows (compact, glanceable)
- **Gap between cards:** gap-3 lg:gap-4 (not gap-6 lg:gap-8)

The macro-whitespace rule from customer-facing INVERTS in admin.
Whitespace = wasted screen real estate when the user is in admin to
GET INFORMATION.

---

## Component vocabulary — admin idioms

### The KPI Card
```
┌──────────────────────────────────────┐
│ TODAY'S DROPS                        │  ← 10px label
│                                      │
│ 23                            ▲ +12% │  ← big mono + delta
│                                      │
│ vs 21 yesterday  · 28 weekly avg    │  ← tertiary context
└──────────────────────────────────────┘
```

Pattern: Label / Big Mono Number / Delta indicator / Tertiary context.

### The Status Pill
- Solid color background only when state is critical
- Outline color for normal states
- 10-11px uppercase, tracking-[0.16em]
- `rounded-md` (NOT pill-rounded — admin doesn't need the friendly pill shape)

### The Inline Sparkline
- 80×20px sparkline in stat cards showing the last 30 days
- No axes, no labels, just the trend line
- Brand-yellow stroke when current trend is on target; red when off
- Adds context without taking space

### The Real-Time Toast
- Position: bottom-right (NOT top-center where customer site puts trust strip)
- Auto-dismiss in 4 seconds
- Stack max 3
- Color-coded (info / warn / crit)

### The Compact Table
- Row height 40-48px
- Sortable headers with subtle ▲▼ on hover
- Sticky first column on horizontal scroll
- Row hover state: subtle bg shift (NOT scale or shadow)
- NO row click animation; clicks are instant

---

## Motion vocabulary — admin specific

- **Snappy:** 100-200ms — most state transitions
- **Instant:** 0ms acceptable — table sorts, filter applies, modal opens
- **Magnetic (200ms only, NOT 500):** for primary action buttons
- **Forbidden:** anything > 300ms in admin. Cinematic motion belongs
  on customer-facing. Admin user values speed > drama.
- **Skeleton loading:** preferred over spinners for any data-fetch
  > 200ms.

---

## Information hierarchy — the "What needs my attention?" rule

Every admin page must answer "What needs my attention RIGHT NOW?" within
the first 200ms of load. Not "what's this page about" — that's
customer-site framing. Admin user already knows what the page is about.

Implementation:
1. **Top-of-page:** ALERTS BAR — only visible if anything needs attention
2. **Below alerts:** ACTION QUEUE — cards/rows the operator should act on
3. **Below action queue:** REFERENCE DATA — KPIs, charts, status panels
4. **Below reference:** LONG-TAIL DATA — detailed tables, full lists

The alerts bar might be empty 80% of the time. That's correct. Empty
alerts bar = "everything's fine, do whatever you came here for."

---

## What this philosophy explicitly REJECTS

- ❌ **Customer-facing brand voice** in admin section labels — no
  "Pull up to drop-off" microcopy on dispatch board. It's just
  "Drop-offs."
- ❌ **Macro-whitespace** — customer-facing's signature is admin's
  enemy
- ❌ **Storytelling sections** — admin user doesn't need narrative
  arc; they need data
- ❌ **Cinematic 850ms reveals** — slow motion in admin = friction
- ❌ **Single-anchor hero design** — admin pages have many parallel
  anchors, all relevant
- ❌ **Sticky trust strip** — irrelevant inside admin
- ❌ **Photo-grain overlay** — adds noise to data; turn off in /admin
- ❌ **Eyebrow-tag-then-H2 pattern** — too editorial; admin uses
  "Section: " label inline
- ❌ **Magnetic 500ms button physics** — admin user clicks 100x/day;
  feedback should be 100-200ms

---

## What this philosophy ENDORSES (some of it carries over)

- ✅ **Token system from wave-43** — fully reused (admin extends with
  data colors above)
- ✅ **Cleveland-tough register in admin EMPTY STATES** ("No drops yet
  today. Calm before the storm." rather than generic "No data found.")
- ✅ **Magnetic-physics on primary action buttons** — but reduced
  duration (200ms not 500ms)
- ✅ **Double-Bezel for high-importance KPI cards** — but at smaller
  scale (1rem outer / calc(1rem-2px) inner)
- ✅ **Honest data-driven headlines** — "23 drops today, 5 over
  capacity" not "Excellent performance!"

---

## The three admin user archetypes

Different admin pages serve different mental modes:

### Mode 1: AT-A-GLANCE
User: "What's happening right now?" (e.g., Overview, Command Center)
Design: KPI cards, real-time charts, alert bar prominent
Latency target: < 1 second to information

### Mode 2: DEEP-DIVE
User: "Tell me everything about this customer" (e.g., Customer detail)
Design: Dense detail page, all related data visible without nav
Latency target: instant within the page; no cross-page jumps

### Mode 3: WORKFLOW
User: "Process these 12 things" (e.g., Follow-Ups, Dispatch)
Design: Compact list + bulk actions + keyboard shortcuts
Latency target: action completes in < 200ms after click/keypress

Each section in `client/src/pages/admin/` should be classifiable into
exactly one of these modes. Mixed-mode pages should be split.

---

## How to use this document

1. Before any admin visual change, ask: does it serve the OPERATOR'S
   COCKPIT goal, or does it import customer-facing patterns?
2. When in doubt about density vs whitespace, choose density.
3. When in doubt about motion duration, choose snappier.
4. New admin section → classify into one of the 3 user modes first.
5. Color choice → use the data-color tokens, not the brand-yellow
   accent (yellow is reserved for genuine action moments).

---

## Living document

Updated when admin pages are observed in real use to drift from these
patterns, OR when new modes emerge.

Last updated: 2026-05-07 (wave-49).
