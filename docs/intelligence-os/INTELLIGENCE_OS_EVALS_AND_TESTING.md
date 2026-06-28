# INTELLIGENCE OS EVALS AND TESTING SPEC
> Verification, Quality Assurance & Calibration Framework

---

## 1. Braintrust Integration & Testing Pipeline

To ensure the AI models don't drift and structured claim extraction remains accurate, we integrate **Braintrust** as our core evaluation and observability harness:

```txt
Prompt / Model Changes 
  ---> Run Braintrust Evals (Local Vitest integration)
  ---> Compare Scores against Baseline (Golden Dataset)
  ---> Assert: Score >= Baseline
  ---> Proceed to Deploy / Block
```

* Evals are located in: `apps/statenour/tests/eval/`
* Execution Command: `pnpm eval:live` or `pnpm eval:memory`

---

## 2. Structured Extraction Evals

These tests evaluate how reliably the Acquisition and Extraction plane structures claims into valid JSON schemas.

### Evaluation Criteria
* **Schema Compliance (Binary)**: Checks if the output matches the required database schema (1.0 = valid JSON, 0.0 = parse error).
* **Information Fidelity (LLM-as-a-Judge)**: Assesses whether the extracted claim alters the meaning of the source text.
* **Citation Accuracy**: Verifies that every extracted claim includes a valid, traceable source URL or document ID.

### Golden Dataset Example
```json
{
  "input": "We have reduced the cost of our Qwen-2.5 models by 40% on OpenRouter effective June 23.",
  "expected_output": {
    "text": "Qwen-2.5 cost reduced by 40% on OpenRouter",
    "category": "research_claim",
    "domain": "ai",
    "confidence": 0.95
  }
}
```

---

## 3. Judgment Evals

These tests evaluate whether the scoring algorithms (SQS, OS, TS) rank alerts and opportunities correctly.

* **Relevance Rank Parity**: Evaluates if the system ranks real opportunities above noise.
* **Urgency Calibration**: Asserts that safety-critical alerts (such as database deadlocks or ranking drops) receive a Threat Score $\ge 80$.
* **Hallucination Detection**: Verifies that generated briefings reject claims with grounding scores $< 0.55$.

---

## 4. Outcome Evals (Calibration & Brier Scores)

For every strategic prediction made, the outcome engine calculates the **Brier score** to evaluate model calibration:

$$Brier = \frac{1}{N} \sum_{t=1}^{N} (f_t - o_t)^2$$

Where:
* $f_t$: The forecast probability (confidence score between $0.0$ and $1.0$).
* $o_t$: The actual outcome ($1.0$ if the event occurred, $0.0$ if it did not).

### Calibration Dashboard Metrics
* **Perfect Score (0.0)**: Complete predictability.
* **Naive Guess (0.25)**: Equivalent to a coin-flip.
* **Poor Calibration (>0.25)**: Indicated model overconfidence or high noise ingestion.

Sources with low historical Brier calibration scores are automatically penalized, lowering their SQS.
