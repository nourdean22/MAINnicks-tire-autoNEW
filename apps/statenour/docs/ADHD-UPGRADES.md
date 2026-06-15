# Statenour: ADHD / Executive Dysfunction UI Upgrades

This document outlines the design philosophy, technical implementations, and interface mechanics for the ADHD and Executive Dysfunction (EF) support upgrades implemented across the `/stats` page surface: **Goals**, **Body**, **Learning**, and **Calibration** tabs.

---

## 1. Design Philosophy

ADHD and executive dysfunction are characterized by low friction tolerances, decision paralysis under list fatigue, high activation energy when faced with manual inputs, and struggle with intention-to-action execution loops.

Statenour addresses these friction points with three core principles:
1. **Intention Anchor**: Restricting focus to a single, concrete ambition at a time.
2. **Visual Simplicity**: Collapsing or hiding advanced, non-essential input fields behind clear, toggleable accordions.
3. **One-Tap Actions**: Replacing typing and sliders with instant, tactile rating buttons.
4. **Time-Boxed Focus**: Introducing visual countdown timers to create gentle urgency and discourage overthinking.

---

## 2. Tab Upgrades

### 2.1 Goals Tab (Execution Coach)
* **AI Task Deconstruction**: Deconstructs goals into 3-5 trivial chronological, physical actions using `trpc.ai.deconstructTask` to reduce initiation friction.
* **EF Rescue Focus Mode**: A toggle switch that restricts the task countdown timer to a maximum of 3 minutes and opens a "Mental Clutter Dump" text area to dump cognitive noise.
* **Distraction-Free Overlay**: Activating the timer displays a fullscreen modal overlay (`fixed inset-0 z-50 bg-zinc-950/98`) showing only the current micro-step, progress tracking, and timer control.
* **Deficit Warnings**: Automatically checks daily sleep and energy tracking from the Body tab. If sleep is low (< 6 hours) or energy is depleted (≤ 2/5), it triggers a physical deficit warning and pre-enables EF Rescue Mode.
* **Mastery Integration**: Completing a focus loop awards mastery experience points (XP) to the goal's domain stat (e.g. `discipline`, `mental`) with a `+25% multiplier` when EF Rescue Mode is active.

### 2.2 Body Tab (EF Quick-Log Mode)
* **State Hook**: Managed via `efLogMode` (boolean) state.
* **One-Tap Ratings**: Replaces standard numeric input fields with button groups:
  * **Sleep**: `Low (<6h)` (logs 5.5h) | `Restful (7h)` (logs 7h) | `Optimized (8h+)` (logs 8.5h)
  * **Energy**: `🔋 Low` (logs 1) | `⚡ Medium` (logs 3) | `🔥 High` (logs 5)
  * **Stress**: `😌 Low` (logs 1) | `⚖️ Medium` (logs 3) | `⚠️ High` (logs 5)
  * **Workout**: `💪 Yes` | `☕ Rest`
* **Collapsible Details**: Weight, Body Fat %, Waist, and Notes are automatically hidden behind a collapsible "Show advanced fields" accordion to eliminate typing fatigue.

### 2.3 Learning Tab (ADHD Focus Review)
* **State Hooks**: Managed via `focusReviewMode` (boolean), `activeReviewIdx` (number), `reviewTimeLeft` (number), and `showSummary` (boolean).
* **Single Focus Overlay**: Hides suggested topics, the main search bar, history lists, and due reviews lists when active. Focuses the user on exactly one due card.
* **45-second Countdown**: A visual Ebbinghaus countdown progress bar set to 45 seconds to keep reviews brief and urgent.
* **Auto-Reveal Urgency**: If the timer hits zero, it flashes a red timeout alert and auto-reveals the summary to prevent overthinking.

### 2.4 Calibration Tab (ADHD Quick-Grade Mode)
* **State Hook**: Managed via `efGradeMode` (boolean) state.
* **Streamlined Rows**: Pending reviews display in high-density cards containing one-tap action selectors:
  * **Task ROI**: `Underestimated (+20)`, `Spot On`, and `Overestimated (-20)`.
  * **Predictions**: `Confirmed ✅` and `Disproven ❌`.
* **Glow Indicators**: Enhances the visual prominence of the `Approve Low Risk` bulk resolve button, encouraging fast backlog clearing.

---

## 3. Technical Implementation

All data actions are integrated with the existing backend API surfaces:
* Logs are posted to `/api/body/vitals` using the mapped low/restful/optimized values.
* Focus review completions call the `trpc.brain.forgetMemoryByKey` mutation to soft-delete reviews.
* Calibration resolutions call `/api/system/calibration/reviews/{id}/resolve` with the mapped status updates and ROI corrections.
