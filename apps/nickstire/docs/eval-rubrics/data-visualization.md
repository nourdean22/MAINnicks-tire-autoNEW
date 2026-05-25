# Data Visualization Patterns

**Skill port:** B12 · data-visualization + claude-d3js
**Applies to:** statenour `/scoreboard` · nickstire admin `MoneyBrief` / `LeadsBrief` / `CustomersBrief` / `VoiceBrief` / `OutreachBrief` · any future dashboard surface.
**Authored:** 2026-05-26.

## Why this doc exists

Nickstire + statenour have ~30 surfaces that render quantitative data. Without a chart-vocabulary doc, every surface re-invents how to draw a trend / sparkline / KPI tile · the same data gets 6 different visual treatments · operator cognitive load goes up · interpretation slows down.

This rubric defines the 7 canonical chart types · when to use each · what data shape each expects · and the anti-patterns that turn data into noise.

## The 7 canonical chart types

### Chart 1 · KPI tile (number + delta)

The atomic unit. One number · one comparison · one trend hint.

```
┌──────────────────┐
│ REVENUE TODAY     │   ← label (small uppercase)
│ $12,840           │   ← value (XL · gold)
│ ↑ $1,200 vs Mon   │   ← delta (small · gray)
│ ▁▃▅▆▇▅▃ 7d        │   ← sparkline (tiny inline)
└──────────────────┘
```

| Element | Role |
|---|---|
| Label | what (uppercase · text-secondary · 12px) |
| Value | the number (gold/white · 32-48px) |
| Delta | comparison (↑ ↓ · colored · 14px) |
| Sparkline | trend hint over comparison window |

**Use when** · single dimension · operator needs the number at a glance.
**Don't use when** · the number needs context to interpret (then use Chart 3 / 4).

Library · `apps/nickstire/client/src/components/admin/KpiTile.tsx` is canonical · re-use, don't re-build.

### Chart 2 · Sparkline (inline trend)

A 50-80px wide, 16-24px tall line/bar with no axes, no labels, no tooltip. The visual answer to "what's the shape."

**Use when** · embedded in a KPI tile OR a list row · the shape matters more than the values.
**Don't use when** · operator needs to read specific values (use Chart 5 line chart instead).

Pattern · `<Sparkline points={lastN} type="line" height={20} color="gold" />`

### Chart 3 · Line chart (trend over time)

The default for time-series. Always · clear x-axis labels · y-axis with units · one or two metrics max · NO grid noise.

**Use when** · operator needs to track a metric over weeks/months · spot anomalies · compare two trends.
**Don't use when** · the data has more than ~30 points (use Chart 4 with aggregation) OR less than 5 (use Chart 1 KPI tile).

Recharts patterns to follow:
- `<LineChart>` with `<XAxis dataKey="date" tickFormatter={formatShortDate}>` + `<YAxis tickFormatter={formatCurrency}>` + ONE `<Line>` (or two with different colors)
- NO `<CartesianGrid>` unless absolutely needed (kills signal-to-noise)
- `<Tooltip>` with custom content · format values + show comparison

### Chart 4 · Bar chart (categorical comparison)

For comparing N discrete categories. Horizontal bars (label-left) when labels are long · vertical when labels fit.

**Use when** · comparing categories (revenue by service type · leads by source · errors by route).
**Don't use when** · the categories are ordinal-time (use line chart) OR there are >12 categories (cluster into "top N + other").

Sort discipline · ALWAYS sort by value descending · never alphabetical (operator wants to see top firers · not look up "brakes").

### Chart 5 · Funnel chart (sequential conversion)

For stage-to-stage conversion. Each stage is wider/taller proportional to count · drop-off ratio is visible.

**Use when** · 4-7 stages of a customer journey (visit → search → quote → book → invoice → paid).
**Don't use when** · only 2 stages (use a delta KPI tile) OR more than 8 (the bottom slivers vanish).

Pattern · cross-ref statenour `/funnel` surface (master_report.funnel_overview consumer).

### Chart 6 · Distribution (histogram / box plot)

For showing the spread of a value (response times · cart sizes · session lengths).

**Use when** · operator needs to see "P50/P95/P99" or "are most customers in the $500 range with a long tail."
**Don't use when** · the value has only a few discrete values (use Chart 4 bar chart).

Pattern · Recharts doesn't have a native box-plot · use `<BarChart>` with pre-computed buckets OR upgrade to D3 directly for richer distributions.

### Chart 7 · Heatmap (2D · two categorical axes + 1 value)

For dense matrices · day-of-week × hour-of-day call volume · service × month revenue · operator × week activity.

**Use when** · operator needs to spot pattern density across two dimensions.
**Don't use when** · only one dimension has high cardinality (use stacked bar instead).

Pattern · Recharts has limited heatmap support · use a custom `<div>` grid OR D3 directly · cross-ref the existing `/system/calibration` heatmap.

## Color discipline (brand-locked)

| Color | Use | Tailwind |
|---|---|---|
| **Gold #FDB913** | Primary metric · operator's number-of-interest | `text-brand-gold` |
| **White #FFFFFF** | Secondary metric · comparison line | `text-white` |
| **Gray (#888-#aaa)** | Axes · labels · grid · context | `text-text-secondary` |
| **Green #22c55e** | Positive delta · "good" trend | `text-green-500` |
| **Red #ef4444** | Negative delta · "bad" trend (use sparingly) | `text-red-500` |
| **Violet (#7c3aed)** | Strategic-AI accent · only on statenour | `text-violet-500` |

**NEVER** use rainbow palettes (red-orange-yellow-green) for sequential data · use single-hue gradients instead. Rainbow palettes are a colorblindness landmine AND look amateur.

**NEVER** introduce a NEW color outside this palette. Brand-lint catches drift.

## The 5 dashboard storytelling principles

(Companion to `dashboard-storytelling.md`)

### Principle 1 · One story per surface

Every dashboard answers ONE question. "What's revenue doing today?" → MoneyBrief. "Where are leads getting stuck?" → LeadsBrief. Mixing stories means operator reads twice as long to extract half the signal.

### Principle 2 · Above-the-fold = critical 3

The 3 most important numbers ALWAYS visible without scroll · in the top viewport · on mobile too. Mobile is the operator's primary surface · `top-[0..400px]` must contain the 3 critical KPIs.

### Principle 3 · Color signals direction · NOT identity

Gold for "look here" · green for "going up" · red for "going down" · gray for "context." Don't use color to identify a metric (`revenue is purple, leads is blue, ...`) · that's a legend operator has to learn.

### Principle 4 · Compare to something

A number alone says nothing. "$12,840" → does the operator know if that's good? "$12,840 (↑$1,200 vs Mon)" → yes. EVERY KPI tile has a comparison · against same-period-last-week OR target OR previous-day.

### Principle 5 · The drill-down is the action

Hovering / clicking a chart should lead to the source · either the rows that make up the number OR the page where operator can ACT on it. A dashboard that doesn't drill-down is read-only · drilling-down converts looking into doing.

## Anti-patterns

### "Chart-junk maximalism"

Gradients · drop shadows · 3D bars · animated rotations · multiple legends · 8 colors. Each addition reduces signal-to-noise. Strip until only the data remains.

### "Single-metric KPI tile with no comparison"

A number with no comparison is a number with no meaning. ALWAYS include a delta or target or trend hint.

### "Recharts ResponsiveContainer with fixed height"

The `height={N}` prop on `<ResponsiveContainer>` defeats the responsive behavior. Use `aspect-ratio` on the wrapping container instead.

### "Tooltips that re-state the same data as the chart"

Tooltips should show MORE detail than the chart (e.g. exact value · related metrics · the row's context) · not less detail (e.g. just the value the bar already shows).

### "Color-by-default on every series"

If you have 5 lines on a chart · you have 5 colors · operator can't read it. Cap at 2 lines per chart · OR use small-multiples (5 small charts each with 1 line).

### "Time axis with random tick density"

Default Recharts tick logic picks weird intervals. Always override with `interval={...}` OR a custom `tickFormatter` so ticks land on every Monday OR every 1st-of-month · whatever the operator's mental model expects.

## Implementation plan (queued)

1. Audit existing chart components · grep for `<LineChart` `<BarChart` `<AreaChart` · catalog every chart in production
2. Extract canonical components · `<KpiTile>` (done) · `<Sparkline>` (done · in admin) · `<TrendChart>` (NEW) · `<CategoryBar>` (NEW) · `<FunnelChart>` (extract from statenour `/funnel`) · `<Heatmap>` (extract from statenour `/system/calibration`)
3. Migrate every dashboard to use canonical components · no inline chart code
4. Brand lint rule · refuse PRs that introduce hex colors outside the 6-color palette
5. Storybook (NEW dep · if no other use-case skip) OR a `/style-guide` page on statenour with every chart at every breakpoint · designer-reviewable

## Skill-port lineage

B12 from the audit's Round 2 + the existing `dashboard-storytelling.md` companion. Pairs with:
- `docs/eval-rubrics/dashboard-storytelling.md` (the macro of which charts to show · this doc is the micro of how to draw each one)
- `docs/eval-rubrics/visual-regression.md` (these chart components are exactly what visual-regression tests should pin)
- Wave Q + T + U lint discipline (brand-color lint catches palette drift)
- `aesthetic-principles.md` (statenour editorial-minimalist · the operator's brand contract that bans chart-junk)

Future · expose chart specs as a `tRPC.surfaces.chartSpec` query so the agent (per A2 agent-ready-apis) can dynamically generate a chart for a dataset without operator wiring it manually.
