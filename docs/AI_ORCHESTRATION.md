# AI / Agent Orchestration Patterns

> Codified prompt engineering + agent orchestration principles for the
> AI features inside admin (and any future AI features customer-facing).
> Generated 2026-05-07 (wave-55) via prompt-engineer + agent-orchestrator
> + ai-agents-architect + agent-evaluation skills.
>
> **VAPI explicitly out of scope** per Nour's policy. Any future VAPI
> assistant prompt/tool changes get an approval-first report, not
> embedded in this doc.

---

## What AI features exist today (audit)

Per session memory + codebase scan:

1. **Nick (VAPI receptionist)** — Gemini 2.5 Flash, 3 tools (scheduleDropoff /
   lookupCustomer / submitCallback). **Out of scope per policy.**
2. **AI blog seeder** — referenced in memory; generates blog post
   content programmatically
3. **AI chat in admin** — referenced in admin sections (`/brain`,
   `/chat` per memory); enables natural-language queries against shop data
4. **Brain learning architecture** — referenced in memory; 4-wave
   build of identity/recall/skill-library
5. **AI policy file** — `.claude/memory/ai_policy.md` per memory;
   documents Venice + Ollama Cloud Pro co-1st provider routing matrix
6. **Custom fetch wrapper for venice_parameters** — referenced in
   memory; provider-specific extension

---

## Provider routing principles (codified)

Per memory: Venice + Ollama Cloud Pro are co-1st choice; preferLargeContext
flag promotes Ollama. Fallback chain: Venice → Ollama → retry → OpenAI →
Anthropic.

**Rule:** preserve this routing. Don't introduce new providers without
adding them to the policy matrix. Each provider has a different cost
curve, latency profile, and refusal pattern.

**Adding a new provider:** document the use case where it wins (e.g.,
"Anthropic Sonnet 4 for tool-use heavy tasks because Venice doesn't
support function calling reliably"). Without explicit win condition,
don't add.

---

## Prompt engineering frameworks (when to use which)

The `prompt-engineer` skill catalogs 11 frameworks. Pick by task type:

### RTF (Role / Task / Format) — for simple, well-bounded tasks

```
Role: You are a Cleveland tire shop's marketing copywriter.
Task: Write a 60-character SEO meta title for a brake repair page.
Format: Plain text, no quotes, no preamble.
```

Use for: meta title generation, single-purpose summarization,
data-to-format transforms.

### Chain of Thought — for tasks requiring reasoning steps

```
Question: Should we promote Conrad's tire alternative content this
month given current GSC data?

Think through:
1. What's the current ranking position for "Conrad's tire alternative"?
2. What's our impression-to-click ratio at that position?
3. What's the comparable performance for our other competitor pages?
4. What's the marginal cost of additional promotion?

Then: provide your recommendation.
```

Use for: strategic decisions, multi-step reasoning, "why" questions.

### RACE (Role / Action / Context / Expectations) — for sustained-context work

```
Role: Lead engineer for nickstire.org.
Action: Audit and recommend fixes for the booking page form.
Context: Current conversion rate is X%. Wave-47 added a star strip.
The form has [N] fields. Page DFII is 17/15.
Expectations: Output a numbered punch list of 3-7 specific changes
with estimated lift per change.
```

Use for: technical reviews, audits, structured deliverables.

### Chain of Density — for summarization with progressive specificity

```
Summarize the booking page in increasing detail:
1. One sentence
2. One paragraph
3. Multi-paragraph technical analysis
```

Use for: documentation, briefings, executive summaries with detail
on demand.

### CLEAR (Concise, Logical, Explicit, Actionable, Relevant) — for instructions

```
TASK: Update the meta description for /diagnostics
CONSTRAINTS:
  - Max 170 characters
  - Front-load primary search query
  - Brand voice: Cleveland-tough plainspoken (see DESIGN_PHILOSOPHY.md)
  - Banned phrases: 'top-rated', 'trusted', 'premier', 'world-class'
  - Must include phone number
OUTPUT: Just the new meta description text. No explanation.
```

Use for: programmatic content generation, batch operations.

### STAR (Situation / Task / Action / Result) — for case studies + reports

Use for: documentation of past work, post-mortems, retrospectives.

---

## Agent orchestration patterns

### Single-Agent mode (most cases)

A single LLM call with one well-engineered prompt. Use when:
- Task is bounded
- Reasoning fits in one inference
- Output format is predictable

### Multi-Agent mode (specific cases)

Multiple agents with distinct roles. Use when:
- One agent's output feeds another's input
- Specialized expertise is needed (e.g., one agent for SEO, one for code)
- Quality benefits from cross-checking (one agent generates, another reviews)

#### Pattern 1: Producer + Critic

```
Agent A (producer): writes initial version
Agent B (critic): reviews against quality criteria, returns edits
Agent A (revised): incorporates edits
```

Use for: high-stakes content where quality matters more than latency.
Examples: pillar article generation, public-facing copy.

#### Pattern 2: Planner + Executor

```
Agent A (planner): decomposes task into steps
Agent B (executor): runs each step, returns results
Agent A (verifier): confirms outcome matches plan
```

Use for: multi-step tasks with branching logic. Example: "rebuild the
booking flow with X improvements" — planner makes the plan, executor
ships each piece.

#### Pattern 3: Router + Specialists

```
Agent A (router): classifies the request → routes to specialist
Specialists: domain-specific agents (SEO / code / copy / data)
```

Use for: catch-all "ask me anything" interfaces (the admin /chat).
Lets the router agent dispatch to the right narrow specialist.

### Anti-patterns explicitly forbidden

- ❌ **Recursive self-call without termination** — agent calling itself
  to "think harder" without a stop condition burns tokens and rarely
  improves output
- ❌ **Multi-agent for simple tasks** — adds latency + token cost +
  failure modes without quality benefit
- ❌ **Agent loops without observability** — every agent call should
  log inputs/outputs/tokens for debugging when behavior changes
- ❌ **Production agents without evaluation** — see Eval section below

---

## Agent evaluation discipline

Per the `agent-evaluation` skill: production AI features need an
evaluation harness BEFORE shipping changes. Without evals, behavior
silently regresses.

### Minimum viable eval set

For each AI feature in production:
1. **10-20 golden examples** — input + expected output (or
   acceptable output range)
2. **Pass/fail criteria** — explicit, automatable
3. **Run on every prompt change** — CI-style; bad changes blocked

### Example: AI blog seeder eval set

```
Input: { topic: "tire rotation", category: "Tires" }
Expected output traits:
  - Title contains target keyword
  - Length 800-1500 words
  - Brand voice operators applied (specificity inflation, etc.)
  - No banned phrases (top-rated, trusted, etc.)
  - Has 5-8 sections with H2 headings
  - Each section 100-300 words
Pass: all traits true
Fail: any trait false → block deploy
```

### Where to put eval code

`server/lib/ai/evals/` — eval definitions per feature. Run via
`pnpm test:ai-evals` (script doesn't exist yet — wave-55+ creates it).

---

## Cost discipline

Token spend is a real cost. Patterns:

1. **Cache aggressively** — if the same input is asked twice within
   24 hours, return cached output. Especially for blog content + meta
   field generation where the inputs are stable.

2. **Use smaller models for simple tasks** — meta title generation
   doesn't need GPT-4. Use Venice's lightweight tier or Ollama Cloud
   Pro's smaller models.

3. **Streaming over batch** — when generating long content, stream
   tokens to the user (or to admin) so partial output is visible.
   Reduces perceived latency.

4. **Bound context length** — a 100K-token system prompt costs >>
   a 5K-token one and rarely improves output. Strip context to
   what's essential per task.

5. **Log per-task token spend** — surface in admin so cost outliers
   are visible.

---

## Specific prompts to upgrade (not yet shipped)

### AI blog seeder

Likely opportunity: add the brand voice operators (5 codified in
`shared/blog.ts` header) to the seeder's system prompt explicitly.
Current state probably implicit. Making it explicit in the prompt
+ adding banned-phrase enforcement reduces post-hoc cleanup.

### Admin /chat AI assistant

Codify the natural-language-to-SQL or natural-language-to-tRPC
mapping with examples. The skill `ai-engineer` provides templates.

### Customer-facing AI (none currently)

If a customer-facing AI feature is added in the future, the system
prompt should be hard-locked to:
- Cleveland-tough brand voice
- Forbid hallucination of services/prices not in the canonical data
- Always offer a "talk to a human" escape hatch
- Disclose AI nature on first message ("I'm Nick's AI assistant")

---

## Memory + context management

Per session memory mention of "agent-memory-mcp" + "agent-memory-systems":

### Short-term (in-session)
Conversation context. Keep at <16K tokens. Trim oldest messages when
exceeded. Drizzle table for per-session message log.

### Medium-term (per-customer)
Customer history facts (last visit, preferences, vehicle make/model).
Pulled into system prompt at conversation start. Trims at <2K tokens
per customer.

### Long-term (organization-wide)
Brand voice rules, service catalog, pricing structure, policies. These
are STATIC and live in code (shared/business.ts, shared/services.ts,
DESIGN_PHILOSOPHY.md, etc.) — not in vector DB. Loading them via
prompt assembly is faster + more reliable than RAG retrieval for this
scale of content.

### When RAG becomes worth it
Once the corpus exceeds ~50K tokens of unique content (current pillars
+ supporting articles + comparison pages = ~30K tokens) AND the AI
needs to surface from that corpus on demand. At that scale, vector
embeddings + retrieval becomes worth the infrastructure complexity.

For now, keep prompt assembly simple: concatenate the relevant docs
into the system prompt at request time.

---

## Agent failure modes + recovery

Production agents fail. Common modes:

1. **API timeout** — provider-side latency spike. Pattern:
   timeout in 10s, retry once with same provider, fall back to next
   provider in policy chain.

2. **Refusal** — the model refuses to do the task ("I can't help
   with that"). Pattern: detect refusal phrases in output, fall back
   to next provider, log for prompt improvement.

3. **Hallucination** — model confidently outputs wrong info. Pattern:
   validate output against canonical data (e.g., service prices match
   shared/services.ts) before showing to user.

4. **Token budget exceeded** — context too long. Pattern: trim
   context aggressively, retry with smaller window.

5. **Provider outage** — entire provider down. Pattern: circuit
   breaker per provider; route around for X minutes after Y failures.

---

## Last updated

2026-05-07 (wave-55).

Future work:
- Eval harness for AI features (wave-56+ candidate)
- Vector DB + RAG when corpus exceeds threshold
- Per-feature cost dashboards in admin
- A/B testing infrastructure for prompt variations
