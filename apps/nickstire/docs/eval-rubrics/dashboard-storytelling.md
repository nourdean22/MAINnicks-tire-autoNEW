# Dashboard Storytelling Framework

**Skill port:** PORT 9 · kpi-dashboard-design + data-storytelling + data-visualization
**Applies to:** admin Today page, MoneyBrief, LeadsBrief, OutreachBrief, CustomersBrief, VoiceBrief, statenour /scoreboard NickHealthSection, any future operator dashboard.
**Authored:** 2026-05-26.

## Why this doc exists

Operator looks at the dashboard ~10× per day. Every viewing is a cognition opportunity OR a cognition tax. Most dashboards are tax · big number, vague color, no context.

The data-storytelling skill argues: a tile should answer THREE questions in <2 seconds.

1. What is the number?
2. Is it good or bad RIGHT NOW?
3. What changed to make it that way?

A tile that only answers #1 is a museum exhibit. Add #2 and it's an instrument. Add #3 and it's intelligence.

## The 3-line tile pattern

```
$1,847              ← THE NUMBER (large, monospace, primary color)
↓ 18% vs Tue avg    ← THE COMPARISON (sentiment-colored arrow + delta + baseline)
Brake jobs leading. ← THE NARRATIVE (one sentence · what's driving it)
```

Every tile gets all 3. If you can't write the narrative line, the tile isn't earning its pixels · cut it.

## Lead vs lag indicators

KPI design discipline · separate the metrics by causality:

**LEAD indicators** (predict the future) · place at TOP of dashboard:
- Lead velocity (new leads/day · 7d moving avg)
- Quote velocity ($ quoted/day)
- Voice-call velocity (calls/day · live)
- Customer-segment churn risk (new at-risk count)
- Cross-sell-prediction inventory (today's predictions ready to fire)

**LAG indicators** (measure the past) · place at BOTTOM:
- Revenue today
- Invoices this week
- Conversion rate (closed jobs / quotes)
- LTV trend

Lead indicators tell the operator what's about to happen. Lag indicators tell them what already happened. Most dashboards over-index on lag · "$1,847 today" doesn't tell you anything actionable. "12 leads today vs 7 yesterday" tells you tomorrow's revenue is coming.

## Narrative templates (use these · don't reinvent)

For each tile, pick the narrative template that fits the metric:

| Template | When to use | Example |
|---|---|---|
| **"X leading"** | One sub-category driving the headline | "Brake jobs leading $1,847 today" |
| **"Y above/below baseline"** | Single comparison to historical norm | "18% above Tuesday avg" |
| **"Z stuck"** | A WIP / pending count that's not moving | "3 declined estimates stuck >5 days" |
| **"W converting"** | A funnel-stage rate | "37% of leads converting to quotes (was 28% last week)" |
| **"V at risk"** | A predictive alert | "2 customers entered at-risk segment today" |
| **"U pacing"** | Mid-period extrapolation | "Pacing $4,200 by EOD vs $3,800 last Tue" |
| **"T cold/hot"** | Activity binary state | "Voice queue cold · 0 calls last 30 min" |
| **"S new since last visit"** | Operator-session-anchored delta | "5 new leads since 9 AM" |

If no template fits, the metric is probably too abstract · ask "what would a customer ACTUALLY do differently if this number changed?"

## Color discipline

3 colors max per tile. The 3-color palette from the existing minimalist UI (#FDB913 yellow, #0F1014 black, #F5F5F5 white) extends with:

- **Sentiment colors:**
  - green `#10B981` · positive delta
  - red `#EF4444` · negative delta
  - neutral `#9CA3AF` · no significant change

That's it. No traffic-light gradients · no sparkline-rainbow · no charts that need a legend.

## Anti-patterns called out

### "Big number, no context"

A tile showing `$1,847` with no comparison/narrative is a museum exhibit. The operator has to compute "is that good?" mentally · pure cognitive tax. Fix · always 3 lines.

### "Sparkline cargo cult"

Tiny squiggly line under the number that no human can read. If you need a sparkline, the tile is doing two jobs · split into the number + a separate chart elsewhere.

### "Ranked-list-of-everything"

"Top 10 customers by LTV" tile that shows 10 names + 10 numbers. The operator scans names looking for context · cognitive cost is enormous. Pick the TOP customer + a narrative line "5 customers ≥$1k LTV new this month."

### "Refresh-everything-every-second"

Tiles updating sub-second cause visual noise that hides actual changes. Refresh at 60s minimum for sub-page tiles · 5min minimum for top-page tiles. The HEADLINE of a change matters more than instant currency.

### "Click-through to the same data"

If clicking a tile takes you to a list that shows the same number bigger, the tile failed. Click-throughs should reveal SUB-DATA · breakdown, drilldown, drill into the narrative.

## Apply to existing dashboards

`MoneyBrief` · already shipped per memory · audit for the 3-line pattern · most tiles likely have NUMBER but missing NARRATIVE.

`LeadsBrief` · same audit · the velocity number is good · add "↑/↓ vs 7d avg" and "X channel leading."

`OutreachBrief` · the gateway state is good · the queue count needs a narrative ("12 ready to send · 0 stuck").

`CustomersBrief` · LTV roster works · the segment counts need narrative lines (what changed since last view).

`statenour /scoreboard NickHealthSection` · synthesized health score is the headline · the 13 components are the narrative · already partly aligned.

## Skill-port lineage

PORT 9 from the audit's Round 1 ROI ranking. Same shape as the other framework ports (Wave V autonomous-tiers, Wave R voice-eval rubric) · vendor the DISCIPLINE, not the specific dashboard.

Future extension · a `<DashboardTile>` React primitive that enforces the 3-line shape at compile time. TypeScript prop `narrative: string` (required) prevents shipping a tile without one.
