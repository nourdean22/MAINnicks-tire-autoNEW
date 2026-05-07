# Admin KPI Framework

> Codifies which numbers nickstire's admin should surface, how they should
> be visualized, and what action each KPI triggers when it moves. Generated
> 2026-05-07 (wave-49) via kpi-dashboard-design + business-analyst skills.

---

## The KPI hierarchy (4 levels)

Information density rule from ADMIN_PHILOSOPHY.md applies. Admin shouldn't
display every metric; it should display the metrics that drive decisions.

### Level 1 — NORTH STAR (1 metric, top of admin)

The single number that, if it goes up, the business is winning.
For nickstire:

**WEEKLY GROSS MARGIN $** (revenue minus parts cost minus labor cost)

Why not "Revenue"? Revenue can be inflated by selling cheap tires at low
margin. Margin is what pays the rent.

Why not "# customers served"? Customers can be served unprofitably.
Margin is the actual outcome.

Display: prominent at top of /admin. Always visible.
Update cadence: real-time (computed from invoices + cost of goods).

### Level 2 — DIAGNOSTIC METRICS (5-7 metrics)

Movements in the North Star are explained by movements in these.

| Metric | Formula | Healthy range | Triggers |
|---|---|---|---|
| **Drop-offs today** | Count of cars logged in | 18-30 weekday, 25-40 Sat | Below 15 = red flag, investigate |
| **Avg ticket size** | Revenue / cars | $180-280 | Below $150 = check upsell pattern |
| **Estimate-to-invoice conversion** | Invoices / estimates given | ≥75% | Below 70% = price/quality issue |
| **Avg cycle time** | Drop-off to pickup hours | 2-6 hr | Above 8 hr = capacity issue |
| **Re-engagement open rate** | Customers returning within 90 days | ≥35% | Below 30% = retention issue |
| **Review pull rate** | New 5★ reviews / cars served | ≥1 / 8 | Below 1/12 = ask-for-review issue |
| **Active leads (followups)** | Leads in followup queue | < 30 | Above 50 = staff bandwidth issue |

### Level 3 — OPERATIONAL METRICS (10-15)

Granular shop-floor signals. Surfaced in section-specific dashboards
(Dispatch, Follow-Ups, Compliance, etc.). Not on the home admin overview.

Examples:
- Average wait time for walk-ins
- VAPI inbound call count + forward rate (already in DB)
- SMS open rate
- Dispatch board state at any point in time
- Specific service category performance (tire installs/day, brake jobs/day)
- Coupon redemption rate
- Financing approval rate
- Bay utilization %
- Inventory turn (used tire stock)

### Level 4 — DETAIL DATA (everything else)

Tables, search, lookups. Not visualized; queried as needed.

---

## Per-page KPI mapping

### `/admin` — Overview (AT-A-GLANCE mode)

Top of page:
1. **NORTH STAR** prominent: Weekly Gross Margin $ + delta vs last week
2. **ALERT BAR** — only renders if alerts exist
3. **DIAGNOSTIC GRID** — 6 KPI cards (drops today, avg ticket, conversion, cycle time, retention, reviews) each with sparkline

Below:
4. Today's dispatch summary (from DispatchSection)
5. This week's revenue chart
6. Top 5 customers by lifetime value (link to detail)

### `/admin/intelligence/overview` — Strategic dashboard (AT-A-GLANCE)

Higher-level than /admin:
- Monthly revenue + margin trends
- Customer LTV distribution
- Service mix breakdown
- Geographic heatmap (which Cleveland zip codes generate revenue)
- Marketing channel attribution (which traffic source converts)

### `/admin/dispatch` — Real-time ops (WORKFLOW mode)

KPIs in header:
- Cars on lot now / capacity
- Avg cycle time today
- Estimated wait if walk-in arrives now

### `/admin/customers` — Customer mgmt (DEEP-DIVE mode)

KPIs in customer detail:
- Lifetime spend
- Visit count
- Last visit date
- Average ticket size for THIS customer
- Outstanding balance
- Review status (left a review yet?)
- Referral count (Nicks150 program)

### `/admin/leads` — Pipeline (WORKFLOW mode)

KPIs in header:
- Active leads count
- Leads needing followup
- Conversion rate (lead → drop-off)
- Average days from lead to conversion

---

## Visualization patterns by metric type

### COUNTS (e.g., drops today)
- **Big mono number** with label above
- **Sparkline** for last 7 days as inline mini-chart
- **Delta indicator** (▲ +12%) compared to comparable prior period

### RATES + PERCENTAGES (e.g., conversion)
- **Big mono percentage** with label above
- **Bar gauge** showing current vs target range
- **Threshold indicator** — color shifts as it crosses target

### CURRENCY (e.g., revenue, margin)
- **Big mono $ amount** with label above
- **Trend line** as mini chart
- **Delta** as both $ and %

### DURATIONS (e.g., cycle time)
- **Big mono number + unit** ("2.3 hr")
- **Distribution histogram** as mini chart
- **Threshold band** indicating healthy range

### CATEGORICAL (e.g., service mix)
- **Stacked bar** OR **donut** — donut for ≤5 categories, bar for more
- Always sorted by value descending
- Top 3 highlighted, rest grouped as "Other"

### TIME-SERIES (e.g., revenue over weeks)
- **Line chart** for continuous data
- **Bar chart** for discrete period comparisons
- Always show comparison reference (last year, target line, prior period)

---

## Anti-patterns explicitly forbidden

- ❌ **Vanity metrics with no decision attached** — if a number doesn't
  trigger an action, don't display it. Page views with no traffic-source
  context = vanity. Cars served without margin = vanity.
- ❌ **Charts without scale/comparison** — a number without context is
  not a KPI; it's noise.
- ❌ **More than 6 KPI cards above the fold** — cognitive overload.
- ❌ **Pie charts with > 5 slices** — humans can't compare angles
  beyond 5.
- ❌ **3D charts** — always misleading.
- ❌ **Bright animated decorations on metrics** — admin user is in
  the data, not at a kiosk.
- ❌ **Auto-refreshing more than 1 minute** — disrupts decision-making
  for marginal real-time benefit. Hourly refresh is enough for most.

---

## Metric staleness signaling

Every metric must indicate WHEN it was last computed. Patterns:

- **Real-time** (computed on every render): no staleness label needed,
  but show a subtle pulse animation when value changes
- **< 1 minute old**: small dot indicator (green) + "live"
- **< 1 hour old**: timestamp visible ("Updated 14m ago")
- **> 1 hour old**: explicit warning ("Data from 3 hours ago — may be stale")

Staleness > 6 hours = ERROR state, the metric pipeline has broken.

---

## Implementation principles

1. **Compute server-side, display client-side.** Don't compute KPIs in
   React; have tRPC endpoints return pre-computed values.
2. **Cache aggressively.** Most KPIs don't need real-time. 1-min cache
   on Tanstack Query is fine for almost everything except dispatch.
3. **Surface failure visibly.** If a KPI computation errors, the card
   shows the error visibly — don't silently render 0 or "—".
4. **Test the math.** KPI logic should have unit tests. Wrong numbers
   = wrong decisions = real money.

---

## Future KPIs not yet wired up (gap analysis)

Based on the existing admin section files, these are NOT YET surfaced
but should be:

1. **Bay utilization %** — DispatchSection has the data; not visualized
2. **VAPI cost per booked drop-off** — VAPI logs + booking data both
   exist; cross-section join not yet built
3. **Pillar article + comparison page traffic** — wave-33-37 SEO play
   shipped; admin isn't tracking SEO outcomes yet
4. **Time-to-first-response on leads** — LeadsSection tracks leads
   but not response latency
5. **Customer churn cohort** — by drop-off month, what % return within
   90/180/365 days

These are wave-50+ targets when we audit each admin section.

---

## Last updated

2026-05-07 (wave-49). Next iteration on observation of real admin use.
