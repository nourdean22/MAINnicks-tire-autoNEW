# INTELLIGENCE OS BRIEFING SPEC
> Briefing Formats, Layouts, Filters & Scheduled Workflows

---

## 1. Daily Executive Brief

* **User**: NOUR (CEO / Operator)
* **Goal**: Surface what changed overnight and what critical choices must be made today.
* **Max Length**: 500 words (single-screen mobile viewport).
* **Delivery Channel**: Web Push Notification at 08:30 local time -> launches full-screen minimalist markdown panel in Statenour PWA.
* **Scoring Thresholds**:
  - Requires Claim Confidence $\ge 0.80$ OR Threat Score $\ge 80.0$.
  - Opportunities must score $\ge 75.0$.
* **Exclusions**:
  - News summaries, general industry gossip, and unresolved, ungrounded community posts.
* **Action Format**:
  - Every item must have a clear action verb, estimated return on investment (ROI), and a direct two-tap "Accept/Decline" button.

### Daily Layout Structure
```markdown
# Daily Executive Brief · [Date]

## 🚨 Critical Alerts (Threat Score >= 80)
* **[SEO Drop]** Google Maps rank for "brakes Cleveland" dropped from #2 to #6.
  - *What it means*: Estimated loss of 15 booking calls/week.
  - *Action*: Trigger rank recovery sequence. [Approve] / [Dismiss]

## 💡 Top Opportunities (Score >= 75)
* **[AI Price Reduction]** OpenRouter dropped Qwen-2.5-Coder costs by 40%.
  - *Action*: Swap default fallback model in AI gateway config. [Approve] / [Defer]

## ⚡ Decisions Pending (Action Ledger)
* **[Finance]** Approve Snap Finance reconciliation writeback script.
  - *Context*: Locks in $1,200 of auto-credits. [Approve] / [Open Ledger]
```

---

## 2. Weekly Strategic Brief

* **User**: NOUR (Investor / Strategist)
* **Goal**: Monitor macro indicators, competitor movement, and evaluate prediction accuracies.
* **Max Length**: 1000 words.
* **Delivery Channel**: Email via Resend fallback or direct Obsidian sync file weekly on Sundays at 09:00 local time.
* **Scoring Thresholds**:
  - Claims Confidence $\ge 0.65$.
  - Opportunities score $\ge 50.0$.
* **Sections**:
  1. **Macro Indicators**: Interest rate movements, FRED local indexes.
  2. **Competitor Movement**: Competitor pricing changes, new marketing strategies.
  3. **Prediction Resolutions**: Calibration Brier scores for the week.

---

## 3. Monthly / Quarterly Strategic Review

* **User**: NOUR (CTO / Long-Term Allocator)
* **Goal**: Evaluate overall system accuracy, deprecate low-value sources, and adjust capital allocation.
* **Max Length**: 2000 words.
* **Delivery Channel**: Pre-rendered PDF in research lab or Obsidian folder.
* **Sections**:
  1. **Operating Leverage Gain**: Calculated time saved and revenue impact from system actions.
  2. **Source Quality Audits**: Rank sources by error rates and SQS changes.
  3. **Domain Performance**: Review accuracy across the 5 MVP domains.
