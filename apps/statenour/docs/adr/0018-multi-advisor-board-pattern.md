# ADR-0018 · Multi-advisor board · preserving divergence

**Status:** ACCEPTED · 2026-05-23
**Companion code:** `lib/ai/board/` · `lib/services/board-consult-record.ts` · `app/(mastery)/brain/board/`
**Tasks:** #23 (Slice A · foundation) · #24 (Slice B · surface + persistence)

## Context

Statenour's existing strategic intelligence stack already has a
`lib/ai/strategic-frameworks/` registry of ~30 codified lenses
(elon-musk · warren-buffett · steve-jobs · porter's five forces ·
jobs-to-be-done · inversion · second-order-thinking · etc.). The
detector picks the top ≤3 matching lenses for any given Nick turn
and injects them as a "STRATEGIC LENS" block into the system prompt.
Nick reasons THROUGH the fused lenses and emits ONE answer.

This pattern works well for tactical / daily decisions — one
calibrated answer beats five competing ones when the operator just
wants to act.

But for MAJOR strategic decisions — choices with compound consequences
across multiple time horizons — fusing lenses into one voice
**destroys the most valuable information**: WHERE the lenses disagree.
When Elon's first-principles math says push price and Buffett's moat
analysis says hold, the operator's decision quality is improved by
SEEING that split explicitly, not by reading a synthesized middle.

The `multi-advisor` skill (community ecosystem) crystallizes this
pattern: consult N advisors in parallel, keep each take distinct,
synthesize the SHAPE of the collective view (consensus · divergence ·
tension axis) without collapsing the takes themselves.

## Decision

Introduce a second strategic-intelligence pattern alongside (NOT
replacing) the existing lens-injection system. Two patterns, two
jobs:

| Pattern | Today | When to use |
|---|---|---|
| **strategic-frameworks** (fused) | ≤3 lenses fused into ONE Nick answer | Tactical / daily / "what should I do next" |
| **board** (parallel · this ADR) | N advisors in parallel · synthesis preserves divergence | Major / multi-faceted decisions |

Operator picks the surface. `/chat` → Nick (fused). `/brain/board` →
the board.

### Architecture (three layers · pure → composed → surfaced)

**Layer 1 · `lib/ai/board/` (pure)**

```
types.ts       · Board · AdvisorTake · BoardSynthesis · BoardConsultation
boards.ts      · 5 pre-configured boards · each is a list of framework
                 ids resolved against the strategic-frameworks REGISTRY
                 at consult time
consult.ts     · consultBoard(boardId, question) · fans out via
                 Promise.all over aiChat (one call per resolved member,
                 in PARALLEL · this is the whole point) · then
                 synthesizes (one sequential synthesizer call that
                 reads ALL takes)
```

No Prisma. No tRPC. Pure pattern. Unit-testable in isolation (20
tests at `tests/ai/board/consult.test.ts`).

**Layer 2 · `lib/services/board-consult-record.ts` (composed)**

Wraps Layer 1 with `brainMemory.remember` for persistence + provides
a flat-projected read helper (`listRecentBoardConsultations` ·
metadata Json opened inside the service · TS2589 firewall · same
pattern as `listRecentReflections` from ADR-0012 / task #13).

**Layer 3 · `/brain/board` surface + tRPC procedures**

`brain.consultBoard` mutation + `brain.recentBoardConsultations`
query. The page renders the synthesis card on top + expandable
advisor takes + recent consultations rail.

### Five pre-configured boards (Slice A · v1)

| Board | Members | Use |
|---|---|---|
| **strategic** | elon-musk · warren-buffett · steve-jobs · inversion · second-order-thinking | Major life/career decisions |
| **invest** | warren-buffett · capital-allocation · unit-economics · pricing-power · opportunity-cost | Capital decisions |
| **product** | steve-jobs · jobs-to-be-done · innovators-dilemma · blue-ocean · ideal-customer-profile | Product / feature direction |
| **operator** | elon-musk · inversion · five-whys · ooda-loop · pareto-principle | Personal decision quality |
| **full** | 8 advisors · max signal | Critical decisions only |

Board sizing locked at 5 (full at 8): 3 is too narrow (one voice
dominates), 8+ is too noisy + 8× the LLM cost.

### Cost + tracing

Per consultation cost = `members.length` advisor calls + 1
synthesizer call. Default 5-member board = 6 aiChat calls.
`taskType: "reason"` routes to Venice + Ollama Cloud Pro co-1st per
`lib/ai/policy.ts` (cheap-first chain).

Every call goes through `makeTracedAiChat("board-consult")` so each
advisor + synthesizer call shows in `/system/agent-traces`. Operator
can spot a chronically failing advisor (e.g. "warren-buffett keeps
timing out") without ad-hoc logging.

### Divergence preservation contract

The advisor-side system prompt explicitly instructs:

> *"Other members are consulting on the same question through their
> own lenses · stay TRUE to your lens. Don't try to be comprehensive.
> Don't blend perspectives with hypothetical other lenses. Surface
> what YOUR lens uniquely sees that others might miss."*

The synthesizer's prompt explicitly forbids blending:

> *"Never blend perspectives into mush. The value of this synthesis
> is preserving the SHARPNESS of distinct lenses while pointing the
> way forward."*

The synthesizer output is structured:
- `consensus[]` · bullets where advisors converge
- `divergences[]` · each bullet names WHO disagreed with WHO and WHY
- `tension` · the axis that splits the board (optional · short-term
  vs long-term · simplicity vs completeness · etc.)
- `recommendation` · the lean with EXPLICIT acknowledgment of which
  lenses get overridden
- `confidence` · lower when board is split, higher when convergent

### Graceful degradation

Independent failure modes for each layer:
- Advisor throws · take has `error` field · other advisors still
  produce takes
- Advisor provider unavailable (Venice + Ollama + paid all down) ·
  take has `provider: "emergency"` + `error: "provider unavailable"`
- Advisor JSON parse fails · take has `error: "parse failed: ..."` ·
  raw content preserved in `keyInsight` for debugging
- Synthesizer fails · takes still surface · synthesis has degraded
  `recommendation: "synthesizer parse failed · board takes above"`

Only fatal errors are: unknown boardId (Zod) · board with zero
resolvable REGISTRY members (registry drift · operational, not
runtime).

## Consequences

### Positive
- Major strategic decisions get multi-perspective intelligence
  without the operator manually orchestrating 5 separate Nick chats
- Existing strategic-frameworks REGISTRY is reused as the source of
  persona definitions · no parallel persona maintenance
- Persistence in BrainMemory means past consultations are replayable
  + recallable via the standard /brain/recall pipeline
- Cost is bounded (6 calls for default board) and tracked in
  /system/agent-traces

### Negative
- 6× the LLM cost of one Nick turn for the same input · operator
  picks deliberately (not every question needs the board)
- Latency · 6 sequential round-trips in worst case (parallel fan-out
  helps but the slowest advisor + the synthesizer still serialize)
- New surface to maintain · `/brain/board` joins the 5 existing
  `/brain/*` sub-pages

### Neutral
- The board is FEATURE-FLAGGED only by operator choice (no env gate ·
  the surface is just a URL). If the cost or quality proves wrong,
  drop the link · the data persists for replay.

## Future work (not blockers)

- **Decision-replay coupling** — every board consultation should
  optionally tag a MasteryDecision so the ghost-Nour system can
  ground future predictions on board verdicts
- **Suggested-board routing** — Nick's chat could detect "this is a
  major decision" and propose: "→ consult the strategic board?"
- **Custom boards** — operator-defined board compositions via
  /brain/board/configure (drop-down framework picker)
- **Board-consultation eval scenario** — extend the LLM-as-judge
  regression suite (#14) with a board-vs-Nick-fused comparison on a
  known-divergent decision

## Distinguishing from related patterns

- **Multi-agent parallel sub-agents (ADR-0009)** · those fan out to
  different MODELS or PROVIDERS on the same task for ensemble
  quality. The board fans out to different LENSES on the same model.
  Orthogonal axes · can compose (the board could itself use
  multi-agent parallelism per advisor, but doesn't yet).

- **Specialist sub-agents (#13/#16)** · those ROUTE a single turn to
  one of {financial-analyst, decision-coach, schedule-keeper} based
  on intent classification. The board CONSULTS multiple advisors on
  ONE turn. Routing picks one · the board uses many.

- **CoALA reflection (#12/#17)** · those synthesize patterns OVER
  TIME from many BrainMemory rows of the same category. The board
  synthesizes perspectives ACROSS LENSES in one moment. Temporal vs.
  lateral.

## Implementation checklist

- [x] Slice A · `lib/ai/board/types.ts` · `boards.ts` · `consult.ts`
- [x] Slice A · `tests/ai/board/consult.test.ts` (20 tests)
- [x] Slice B · `lib/services/board-consult-record.ts`
- [x] Slice B · `lib/brain/categories.ts` registers `BOARD_CONSULTATION`
- [x] Slice B · `brain.consultBoard` + `brain.recentBoardConsultations` tRPC
- [x] Slice B · `app/(mastery)/brain/board/page.tsx`
- [x] Slice C · this ADR + RECONCILIATION + AGENTS
- [ ] Future · decision-replay coupling · custom boards · routing nudge
