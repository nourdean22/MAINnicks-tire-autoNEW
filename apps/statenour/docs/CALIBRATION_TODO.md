---
clarity-gate-version: 2.1
processed-date: 2026-06-11
processed-by: Antigravity + Nour
clarity-status: CLEAR
hitl-status: REVIEWED
hitl-pending-count: 0
points-passed: 1-9
document-sha256: 0e24773c3bb0d68b4c80f82a6b3847e56a2a012f9bd837e54c03e3654e1cfbcf
hitl-claims:
  - id: claim-calibration-threshold
    text: "To graduate from a preliminary verdict to a confident assessment, we require a minimum sample size of n >= 30 rated comparisons with an agreement rate of >= 70%."
    value: "n >= 30, agreement >= 70%"
    source: "Statenour calibration system specifications"
    location: "CALIBRATION_TODO.md#L15"
    round: A
    confirmed-by: Nour
    confirmed-date: 2026-06-11
---

# Statenour Judge Calibration Runbook

This guide explains how the Statenour V1 vs V2 prompt judge calibration works, why it is currently in a `preliminary` state ($n = 0$), and how the operator can trigger and rate comparisons to reach the calibration threshold ($n \ge 30$).

---

## 1. What is Judge Calibration?

Statenour V2 prompt builders are evaluated by an LLM judge. The judge decides whether V2 outperforms V1 on a 5-axis rubric. However, to ensure the LLM judge does not share blind spots with the prompts, we calibrate the LLM judge against **human feedback** (the operator's thumbs-up or thumbs-down reactions).

The calibration system calculates **agreement**:
- **Agree**: The judge picked V2 and the operator gave it a thumbs-up (+1), OR the judge picked V1 and the operator gave it a thumbs-down (-1).
- **Disagree**: The judge picked V2 and the operator gave it a thumbs-down (-1), OR the judge picked V1 and the operator gave it a thumbs-up (+1).

To graduate from a `preliminary` verdict to a confident assessment, we require a minimum sample size of **$n \ge 30$ rated comparisons** with an agreement rate of **$\ge 70\%$**.

---

## 2. Step-by-Step Calibration Procedure

To populate comparison runs and provide the human feedback needed to meet the threshold:

### Step 2.1: Trigger Comparison Runs

You can generate prompt comparison runs in two ways:

1. **Option A: Run the Automated Comparator Script (Recommended)**
   Run the following script to sample recent user queries from chat history, generate responses using both V1 and V2 prompts, and execute the LLM judge to record comparisons:
   ```bash
   pnpm tsx scripts/prompt-judge-comparator.ts
   ```
   *This will write new comparison run records directly to the database `BrainMemory` table.*

2. **Option B: Chat in Shadow Mode**
   Ensure `NICK_PRIME_PROMPT=shadow` is set in your Vercel dashboard environment variables. This causes production chat traffic to generate parallel V1/V2 prompt builds and delta logs on every chat turn.

---

### Step 2.2: Rate Chat Responses (Operator Action)

For the calibration pipeline to match judge evaluations against human feedback, you must rate the corresponding messages in the Statenour chat UI:

1. Open the Statenour Chat interface.
2. Review responses for conversations that have parallel comparison runs.
3. Click the **Thumbs Up** (👍) or **Thumbs Down** (👎) icon on these messages.
4. Each reaction writes a feedback score (+1 or -1) to the `ChatMessage` table, which is linked to the `BrainMemory` comparison run by `sourceMessageId`.

---

### Step 2.3: Check Calibration Status

Run the check script periodically to monitor progress towards the $n \ge 30$ threshold:

```bash
pnpm tsx scripts/check-calibration.ts
```

**Expected Output:**
```
Checking judge calibration...
---------------------------------------
Total Scored (n): 32
Agreement %: 78.1
Verdict: well-calibrated
Verdict Reason: judge-operator agreement 78.1% over 32 samples · ground-truth confirms judge rulings
Ties: 4
No operator reaction: 15
No source message: 2
Matrix: [{"judge":"v2","human":"thumbs_up","count":20}, ...]
---------------------------------------
```

---

## 3. Graduation & Cutover Gate

Once the status report displays `Verdict: well-calibrated` ($n \ge 30$ and agreement $\ge 70\%$), Criterion 4 is fully satisfied. The operator can then greenlight the next cutover phase (Phase 1: 10% canary) as detailed in `docs/v2-prompt-cutover-plan.md`.

---

## HITL Verification Record

### Round A: Derived Data Confirmation
- Claim claim-calibration-threshold (Statenour calibration system specifications) ✓

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|-------|--------|-------------|------|

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | REVIEWED
