---
clarity-gate-version: 2.1
processed-date: 2026-06-11
processed-by: Antigravity + Nour
clarity-status: CLEAR
hitl-status: REVIEWED
hitl-pending-count: 0
points-passed: 1-9
document-sha256: ad6ddf28f37cf91a9846f4993fd48a6df7b4a8ab6dbedacfaba9c63351900431
hitl-claims:
  - id: claim-0ef4081e
    text: "The nightly cron skips tasks that do not meet the minimum evidence standards (no completion note, actualMinutes = 0 or null, and no proof)."
    value: "skip if !completionNote && !actualMinutes && !proof"
    source: "Statenour calibration system specifications"
    location: "CLOSED_LOOP_CALIBRATION.cgd.md#L15"
    round: A
    confirmed-by: Nour
    confirmed-date: 2026-06-11
  - id: claim-fdb6fd3a
    text: "Resolved calibration lessons are stored in BrainMemory with a 90-day TTL expiration."
    value: "expiresAt = 90 days from resolve date"
    source: "Statenour calibration system specifications"
    location: "CLOSED_LOOP_CALIBRATION.cgd.md#L18"
    round: A
    confirmed-by: Nour
    confirmed-date: 2026-06-11
  - id: claim-e95f9635
    text: "Bulk approval resolves task ROI items automatically if the difference between estimate and actual is within 5 points."
    value: "diff <= 5 points"
    source: "Statenour calibration system specifications"
    location: "CLOSED_LOOP_CALIBRATION.cgd.md#L21"
    round: A
    confirmed-by: Nour
    confirmed-date: 2026-06-11
---

# Closed-Loop Outcome Calibration Engine Documentation

This document describes the design, API surfaces, nightly routines, and UX flows of the Closed-Loop Outcome Calibration Engine in Statenour.

---

## 1. Engine Core Heuristics

The calibration engine resides in [calibration-engine.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/brain/calibration-engine.ts) and is responsible for evaluating completed tasks and resolved predictions.

### 1.1 Task ROI Heuristics (`proposeTaskRoi`)
- **Baseline ROI computation**: Evaluates the difference between estimated and actual minutes relative to the estimated `EffortBand`, and applies bonus/penalty multipliers (e.g. 2.0x time = 30% penalty).
- **Additive Modifiers**:
  - **Goal Alignment**: If a task is linked to a `LifeGoal`, it receives a `+10` ROI bonus.
  - **Horizon Payoff**: If that goal is long-term (`QUARTER`, `YEAR`, `LIFE`), it receives a `+5` payoff leverage bonus.
  - **Business Domain**: If a task is linked to a mission under the `BUSINESS` or `FINANCE` domains, it receives a `+10` domain leverage bonus.
  - The final score is constrained between `1` and `100`.

### 1.2 Prediction Outcome Heuristics (`proposePredictionOutcome`)
- **Business/Operational Predictions**: Calls the `Nick's Tire` revenue query bridge (`queryNick`) with a strict 5-second timeout.
- **Continuous/Numeric Predictions**: Checks target vs actual revenue amounts, automatically calculating percentage absolute error and auto-grading with a 10% threshold.
- **Evidence Formatting**: Telemetry properties are added (`dataFreshness`, `source`, `proxyStatus`) and bridge errors are logged to `failureState` for transparency.
- **General Predictions**: Falls back to semantic vector similarity searches in `brain_memories` (KNN = 10, similarity threshold = 0.72) to match positive/negative indicators in the completion notes.

---

## 2. Serverless API Routing & Cron Job

### 2.1 Nightly Calibration Generator Cron
The cron job at [route.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/api/cron/calibration-generator/route.ts):
- **Sample-Quality Gate**: The nightly cron skips tasks that do not meet the minimum evidence standards (no completion note, actualMinutes = 0 or null, and no proof).
- **Lesson Hygiene Pruning**: Automatically soft-deletes expired prediction lesson memories (`expiresAt <= now`) from `BrainMemory`.

### 2.2 Resolution API (`reviews/[id]/resolve`)
- Gated under `auth: "owner"`.
- Updates the source Task/Prediction (calculates Brier score for predictions).
- Creates or updates the lesson memory in `BrainMemory` with category `prediction_lesson`.
- Resolved calibration lessons are stored in BrainMemory with a 90-day TTL expiration.

### 2.3 Bulk Resolve API (`reviews/bulk-resolve`)
- Gated under `auth: "owner"`.
- `approve_low_risk`: Bulk approval resolves task ROI items automatically if the difference between estimate and actual is within 5 points, and auto-grades prediction outcomes if they have concrete auto-gradable statuses.
- `reject_stale`: Soft-rejects pending items older than 14 days.

---

## 3. Stats UI layout & Keyboard Deck

- **Search-Param Navigation**: Restructures the `/stats` route in Next.js using `?tab=...` search parameters to load mastery, goals, body, learning, and calibration sections dynamically in a client-side suspense wrapper.
- **Bulk Action Toolbar**: Renders batch approval and stale reject buttons.
- **Keyboard Shortcuts**: Allows Tinder-style arrow review:
  - `Right Arrow`: Approve item.
  - `Left Arrow`: Reject item.
  - `Up/Down Arrow`: Enters correction mode and adjusts actual ROI score by 5-point bands.
  - `Enter`: Submits manual correction when focused on correction overrides.

---

## HITL Verification Record

### Round A: Derived Data Confirmation
- Claim claim-0ef4081e (Statenour calibration system specifications) ✓
- Claim claim-fdb6fd3a (Statenour calibration system specifications) ✓
- Claim claim-e95f9635 (Statenour calibration system specifications) ✓

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|-------|--------|-------------|------|

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | REVIEWED
