# Deep Research Workflow

**Skill port:** B15 · deep-research + claude-scientific-skills
**Applies to:** any operator question that needs synthesized intelligence from multiple sources · "what's the state of art on X" · "what are competitors doing about Y" · "how do other shops handle Z" · "what does the latest research say on W".
**Authored:** 2026-05-26.

## Why this doc exists

The operator periodically needs research-grade answers · not chat-grade. A chat-grade response is "here are some thoughts." A research-grade response is "I checked 6 sources, 4 agree on X, 2 say Y, here's why the disagreement matters, here's my synthesis."

Without a framework, every research request restarts from scratch. With one, the workflow is predictable, the output is comparable, and the operator can trust the methodology.

## The 5-phase research protocol

### Phase 1 · Frame the question (5 min)

Before searching, write down:
- The DECISION this research will inform (if no decision, skip the research · just curiosity)
- The 3-5 specific sub-questions whose answers would resolve the decision
- The "would change my mind" threshold · what evidence would make me act differently

If you can't write the threshold, the question is too vague · refine.

### Phase 2 · Cast a wide net (30 min)

Search across 4 source classes (each weighted differently):

| Source class | Weight | Examples |
|---|---|---|
| **Primary research** | 1.0 | Peer-reviewed papers · industry studies · raw data |
| **Practitioner reports** | 0.8 | Trade-publication articles · operator blogs · case studies |
| **Aggregator analysis** | 0.5 | Industry-analyst summaries · Reddit r/AutoMechanics · Quora · YouTube explainers |
| **Vendor marketing** | 0.2 | Vendor whitepapers · self-promotional content (high-bias) |

Collect ≥6 sources across ≥3 source classes. If all 6 are from one class, the research is biased by construction.

### Phase 3 · Score each source (15 min)

For each source, capture:
- **Date** · how recent · stale sources for fast-moving domains get downweighted
- **Author credibility** · industry-recognized · OR · methodology disclosed · OR · neither
- **Methodology** · empirical · anecdotal · opinion · self-reported
- **Conflict of interest** · does the author benefit from the conclusion?
- **Replication** · does any independent source confirm?

Score each source 0-10. Sources <5 get summarized but not weighted in synthesis.

### Phase 4 · Map the disagreement (20 min)

Where do high-credibility sources DISAGREE?

Disagreement is the most valuable signal · it tells you where the genuine uncertainty lives. Write down:
- The CLAIM
- The SOURCES on each side
- WHY they disagree (different methodology · different time period · different population · different definition of terms)

A research project that finds "all sources agree" is either lucky OR sloppy. Disagreement is the norm in any non-trivial domain.

### Phase 5 · Synthesize with explicit uncertainty (15 min)

The output document has 5 sections:

1. **Decision context** · what this research will inform (from Phase 1)
2. **The settled facts** · claims where high-credibility sources agree
3. **The contested ground** · claims where they disagree, with the disagreement map
4. **My synthesis** · operator's best read of the situation, with EXPLICIT uncertainty markers
5. **Recommended action + watch-fors** · what to do AND what would change the recommendation

Total · ~1.5 hours per research project. Cheaper than getting it wrong.

## Quality markers

A good research output:
- Cites ≥6 sources, ≥3 classes
- Has at least one "where sources disagree" section
- Uses hedge language only where genuinely uncertain · NOT as performative humility
- Closes with a SPECIFIC action AND a SPECIFIC watch-for trigger
- Can be re-read in 6 months and still make sense

A bad research output:
- "Here are some thoughts on X"
- All citations are vendor marketing OR Reddit
- "It depends" without specifying what it depends on
- No action recommendation · just "interesting"
- Reads like the inside of a brainstorm

## Anti-patterns

### "Single-source synthesis"

Operator asks · agent grabs the first ChatGPT-generated summary · presents it as research. That's not research, that's plagiarism. Multiple sources OR explicitly call it "informal investigation."

### "False confidence"

Stating "the data shows X" when the data shows X with substantial caveats. Either include the caveats OR drop the certainty.

### "Quote-mining"

Picking quotes from sources that support the pre-existing answer. The research should CHANGE the answer at least sometimes · if it never does, you're not researching, you're confirmation-biasing.

### "Recommendation without watch-for"

"Switch to X because Y." OK · but if W happens, should I switch back? Research without exit criteria leaves the decision irreversible by design.

### "Stale sources"

For fast-moving domains (LLM ops, web perf, security threats), sources older than 12 months are usually wrong. For slow-moving domains (basic mechanical principles), 50-year-old sources are fine. Match source-recency to domain-velocity.

## Apply to current open questions

Per the broader operator-context, several questions are research-grade:

1. **"Should I migrate to Temporal/DBOS?"** (S1 audit recommendation · L-effort migration)
2. **"What's the right AI-citation strategy for local shops in 2026?"** (B6 + B13 content + competitive)
3. **"What's the actual ROI of customer-LTV-prediction models for shops Nick's size?"** (memory #50 mentions LTV intelligence · could go deeper)
4. **"How do other Cleveland shops handle the SMS sender-ID identity question?"** (per memory's F25e gateway · vs operator-phone questions)
5. **"What's the state of AEO (answer-engine optimization) for service businesses in 2026?"** (PORT 3 FAQPage was a first step · this is the broader research)

Each could use this 5-phase protocol · output is a permanent doc the operator references when re-deciding 6 months later.

## Skill-port lineage

B15 from the audit's Round 2 deep-pass. Pairs with:
- Wave Z · multi-advisor-board (advisors can RUN this protocol in parallel · 6 advisors × 5 phases = parallelized research)
- Wave T · postmortem template (research that comes out of an incident)
- Wave Z · B13 competitive-landscape (research on competitors · uses this protocol)
- Wave V · autonomous-action tiers (research is Tier-4 read-only · output is the action)

Future · auto-generate research doc skeletons via Claude · operator fills in the source list · agent synthesizes against this protocol.
