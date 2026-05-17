# Statenour Next Evolution · 2026-05-16

> **Status**: master roadmap for what's NEXT after the 10-wave consolidation
> sprint (Waves 46-57 shipped today).
> **Source**: 6-agent god-mode audit · cost+capability · cognition · UX ·
> data+ops · tech debt · strategic capability · ~10,000 words synthesized
> **Companion docs**: `CONSOLIDATION-PLAN-2026-05-16.md` (what we just shipped),
> `cohort-2026-05-16-consolidation-eod.md` (the sprint EOD)

---

## Part 1 · What's NOT done from Waves 46-57

The consolidation plan defined 12 waves. 10 shipped, but each wave's scope
was narrower than the plan flagged. Here is the honest "still pending" list,
in priority order.

### From Wave 47 (Elon delete-first sweep) — partial
- 9 orphan Prisma enums never dropped (CustomerRiskStatus · LtvBand ·
  CustomerFollowUpStage · CustomerSegment · LeadSource · LeadType ·
  LeadUrgency · LeadStatus · ServiceCategory)
- 11 dead Prisma models never dropped (StateLog · AuditEvent ·
  LocalSyncLog · SessionReport · MasteryScore · EnvironmentalSignal ·
  PersonProfile · SystemSnapshot · OperatorProfile · OperatorPreference ·
  BrainDump) — these need a data audit first since some appear to be in
  active use (PersonProfile especially)
- 8 dead packages never `pnpm remove`d (stripe · twilio · cheerio ·
  @react-pdf/renderer · @next/env · sharp · react-markdown · remark-gfm)
- `useChatPersonality` hook still on disk (0 callers · 80 LOC)
- `components/ui/button-group.tsx` still on disk (0 callers)
- `components/metric-card.tsx` still on disk (1 caller — should migrate
  to TrendCounter then delete)
- `legacy-shims.ts` shop helpers still on disk (3 caller patterns to inline)
- 5 dead `lib/ai/*` modules never deleted (gemini-image · openai-image ·
  shadow-mode · nick-agent superseded · voice-clone-trainer)
- 54 `lib/ai/strategic-frameworks/**` files (only 2 test imports)
- `puppeteer` still in next.config `serverExternalPackages` (not in deps)
- `.next-ci/types/**` still in tsconfig include (no CI build variant)
- Duplicate `seed` script in package.json
- `pnpm dedupe` never run (hono 4.12.14 + 4.12.18 still duplicated)

### From Wave 50 (UI consolidation) — barely started
- 3 card primitives still parallel (Panel · GlassCard · Card · should
  collapse to one)
- Border-radius still inconsistent (4-5 different rounded-* values)
- 47 raw `animate-pulse` callsites still not migrated to ShimmerSkeleton
- 19 inline pills still not migrated to Badge primitive
- CycleChip primitive never built (mode-pill + mode-persona-chip stay separate)
- 3 hook primitives shipped (Wave 50) but NONE of the 33+ callsites
  migrated yet · the hooks exist, the migration was deferred

### From the original Wave 51 (service layer unification) — not done
- `/api/tasks/[id]/check` is still 354 LOC in the route layer · never
  extracted to `completeTask` service
- 76 routes still use legacy `requireSession` (no rate-limit · no
  normalized errors) · `apiHandler` migration never completed
- 5 ZERO-service domains still without services (journal · decisions ·
  commitments · mastery · financial — ~150 LOC each)
- `VALID_BRAIN_CATEGORIES` enum + write-time enforcement never added
  (BrainMemory category sprawl can recur · the 85→138 regression risk
  is still open)
- 68 silent `.catch(() => {})` still NOT replaced with `recordError`
- 38 inline `deletedAt: null` filters still NOT promoted to
  `findManyActive()` helper

### From the original Wave 53 (split mega files) — never attempted
- `tools.ts` still 5537 LOC · catalog plan in comments only
- `chat/page.tsx` still 3849 LOC · 14 hooks exist, page never deleted inline copies
- `system-prompt.ts` still 1933 LOC · v2 migration plan documented, not finished
- `business-knowledge.ts` still 1844 LOC
- `interceptors.ts` still 1364 LOC

### From Wave 54 (tests) — partial
- ✅ Shipped: resolveInboxMissionId · memory-manager · auto-learn
- ❌ Pending: chat/brain-context.ts · skill-recall.ts · Playwright E2E
  wired into ci.yml (currently never runs · spec comment lies)

### From Wave 55 (integration cleanup) — mostly deferred
- HuggingFace Whisper → OpenAI/Venice migration · DEFERRED with rationale
- Apollo · ClickUp · Fireflies registry stubs · not yet cleaned
- 8 missing env vars in `.env.example` (VAPI_API_KEY · VAPI_WEBHOOK_SECRET ·
  TAVILY_API_KEY · EXA_API_KEY · OLLAMA_API_KEY · OLLAMA_MODEL ·
  OLLAMA_BASE_URL · BUFFER_*)
- `OPENAI_MODEL="gpt-5"` placeholder still wrong in .env.example
- `driverAdapters` preview feature never added to Prisma generator

### From Wave 56 (docs refresh) — 3 of 9 done
Shipped: ULTRON-VISION · DEVICE-RPC · CONSOLIDATION-PLAN
Pending: DB-MIGRATION-POLICY · agent/DEVICE_DIAGNOSTIC ·
.remember/core-memories · OBSERVABILITY · ENDPOINT-HYGIENE ·
state-of-autonicks AM+PM · plus 5 missing critical docs
(how-to-add-a-tool · cron-map · model-reference · pre-push-gates ·
provider-routing) and 5 duplicate docs to merge

### From Wave 57 (config strictness) — partial
- ✅ Shipped: noFallthroughCasesInSwitch · noImplicitReturns · noImplicitOverride
- ❌ Pending: noUncheckedIndexedAccess (866 errors to fix first)
- ❌ Pending: exactOptionalPropertyTypes (347 errors)
- ❌ Pending: noUnusedLocals + noUnusedParameters
- ❌ Pending: vercel.json branch ref still `statenour-master` (should be
  `codex/ollama-local`)
- ❌ Pending: vitest coverage thresholds
- ❌ Pending: Playwright `webServer` stanza + CI wire-up

**Honest total**: the consolidation moved the OS from "~85% coherent" to
"~92% coherent". Closing all the above gets us to "~96% coherent". The
remaining 4% is true capability work (Part 2 below).

---

## Part 2 · What's NEXT (the evolution roadmap)

The 6-agent audit found 60+ opportunities. Ranked here by impact ÷ effort
across all 6 dimensions, with the CRITICAL bugs at the top because they
must ship before anything else.

### 🔴 SHIP THIS WEEK · 3 critical-severity items uncovered by the new audit

**1. VAPID private key hardcoded in source** · `lib/notifications/push.ts:20-21`
   Same class of bug as the runner-secret fallback we killed in Wave 49,
   but worse: a production VAPID private key sits in plain text as a
   fallback string. Anyone with repo access can impersonate the push
   notification sender → phishing on operator's phone. **Fix**: remove
   fallback, fail loudly. 5 min.

**2. nickstire webhook swallows ALL alert failures** ·
   `app/api/webhooks/nickstire/route.ts:65,77,88,100,113,132`
   Six `.catch(() => {})` blocks mean a `lead`, `callback`, or `emergency`
   event from nickstire can arrive, return 200 OK, and Nour gets ZERO
   alert. Lost leads with no signal. **Fix**: structured log + re-throw
   on emergency. 30 min.

**3. proactiveAlerts permanently broken** ·
   `lib/brain/pipeline-controller.ts:348,365`
   `staleQuotes` and `unansweredLeads` are hardcoded `Promise.resolve(0)`.
   The brain cycle fires every tick and the alert never fires because the
   value is structurally 0. **Fix**: wire to nickstire bridge OR remove
   the alert branch. 1 hour.

### 🟠 SHIP NEXT 1-2 WEEKS · 8 high-leverage quick wins

**4. Anthropic prompt cache: `ephemeral` → `extended` TTL** ·
   `lib/ai/provider.ts:1088` · 1 hour · 50-70% cost cut on Anthropic fallback
   Currently 5-min TTL · upgrade to 1-hour TTL · same cache discount,
   much higher hit rate for Nour's working-session usage pattern.

**5. Kill 3 raw-OpenAI bypasses** · `pretask-fanout.ts:79-110` ·
   `multi-agent-orchestrator.ts:89-128` · `deep-research.ts:84-130`
   These three bypass the provider chain entirely · always burn OpenAI
   tokens even when Venice/Ollama would handle it free. Route through
   `aiChat()`. 2 hours · estimated 30-50% cost cut on deep-research sessions.

**6. AiGeneration missing `conversationId`** · `lib/services/cost-slo.ts:22`
   The cost flywheel is BLIND · `topConversationsByCost()` is documented
   as a fallback no-op. Add 1 column + update 1 callsite. **Unlocks**
   per-conversation cost attribution + correlation with quality scores. 2 hours.

**7. Slow-query tracker → SystemMetric persistence** ·
   `lib/db/slow-query-tracker.ts:7-19`
   Currently in-memory only · resets on every Vercel cold start.
   Every regression is invisible. Add a flush-to-SystemMetric on
   mega-morning. 4 hours.

**8. Skill-to-wisdom auto-promotion** · `lib/brain/skill-extractor.ts:636-677`
   Skills that hit `graduation_ready_at` sit in limbo forever ·
   `promoteToWisdom()` is built but never called for graduated skills.
   30-day stability gate + auto-promote. 4 hours. **The brain
   self-evolves for the first time.**

**9. Wisdom citation tracking — close the "never cited" loop** ·
   `lib/brain/wisdom-evolution.ts:96-131` + `lib/brain/contextual-recall.ts`
   Wisdoms injected into the system prompt never get their `lastSeen`
   bumped · `findStaleCandidates()` is running on corrupted input. 3 lines.
   **Makes the entire wisdom-evolution pipeline trustworthy.**

**10. Cross-session Nick state persistence** ·
    `lib/brain/session-distiller.ts:49-62`
    `SessionDistill` captures `questions_still_open` per conversation
    but there's no rolling "Nick's current concerns" aggregate. Every
    new session starts cold. Add one upsert · inject in system prompt.
    Half day. **Continuity across sessions for the first time.**

**11. 4 brain engine slots still `Promise.resolve(0)`** ·
    `thinking-engine.ts:189-190` · `reflection-engine.ts:132-133` ·
    `daily-scheduler.ts:52-53` · `memory-consolidation.ts:552`
    Same plague as #3 above. Brain context strings are structurally
    corrupted. Wire them OR cut the consuming code. 2-3 hours.

### 🟡 SHIP NEXT MONTH · 7 strategic capability evolutions

**12. Health + Body as decision variable** · the operator's most personally
   consequential gap · `/body` page is manual weight only. Add sleep +
   workout + energy to the daily checkin · feed into MODE classifier ·
   trigger RECOVERY mode when sleep < 6h. Foundation: `PersonalDailyLog`
   schema model already has the fields. 1-2 days.

**13. Calendar as active intelligence (not passive recall)** ·
   `app/api/cron/ingest-calendar/route.ts` currently passive-ingests only.
   Add: pre-meeting cards (30 min before each event with person profile
   + last conversations + open commitments) · daily 8am cron that
   computes available work-blocks and sets Today's 3 capacity. 1-2 days.

**14. Relationships layer needs a SURFACE** ·
   `lib/brain/people-intelligence.ts:26-149` is a complete 218-line
   engine with trust scores + neglect detection. Zero operator-facing
   surface. Add `/relationships` page + weekly Telegram digest of
   neglected contacts. 2 days. **100% surface work on top of complete backend.**

**15. Proactive memory surfacing via Telegram** ·
   `lib/brain/anticipated-questions.ts` already precomputes tomorrow's
   3 likely questions nightly. Currently dies in BrainMemory. Add 3
   daily Telegram micro-pushes (morning recall + 2pm topic-prep + 9pm
   energy-state) using existing channel. 1 day. **Brain pushes instead
   of waiting for operator to come look.**

**16. Identity axis forward projection** ·
   `lib/brain/identity-snapshot.ts:570` writes daily history rows that
   nobody reads forward. Add 20 lines of least-squares math to project
   each axis 30 days out · surface trajectory card on `/brain/identity`.
   Highest-signal thing the identity layer could say: "at your current
   velocity, promise_integrity hits 42 in 28 days." 4-6 hours.

**17. Glanceable digest as PWA badge / push** ·
   `components/hud/notification-center.tsx:77-88` already computes the
   pulse summary. PWA install prompt exists. Wire the badge count or
   Web Push so phone-locked operator sees signal without opening the app.
   1 day.

**18. /content approval queue** ·
   `lib/social/buffer.ts` + `lib/social/meta-publish.ts` are built ·
   content generation pipeline exists · no operator-facing approval
   queue. Add `/content` page with pending drafts + scheduled queue +
   one-tap approve. ~200 LOC. 2-3 days.

### 🟢 BIGGER STRATEGIC LEAPS · evaluate then plan

**19. Skill mastery learn→apply→graduate pipeline** ·
   1,423 skills indexed but no proficiency tracking. Weekly "skill
   spotlight" in morning brief · 3 engagements graduates skill to
   always-on bundle. Closes the static→evolving gap in the skills layer.
   1 week of focused work.

**20. Unified operator cockpit** · `/cockpit` page with 5 scorecards
   (cost today · eval pass rate · cron success · brain recall precision ·
   voice p50 latency) + live SSE feed + 7-day sparklines. Retires 5
   scattered system dashboards. Foundation: `os-snapshot.ts` +
   `drift-detector.ts` exist. 1 week.

**21. Wealth intelligence layer** · Munger/Buffett/Naval wisdom corpus
   (189+ entries) never applied to actual balance sheet. Add weekly
   wealth brief Telegram card · investment-decision support layer.
   Optional Plaid/Copilot integration for auto-populate. 1-2 weeks.

### 🌑 DARK HORSE · the one wild move

**22. Apple Health → statenour real-time push** · One iOS Shortcut that
   posts sleep + heart rate + workout completion to `/api/body` on phone
   unlock. Eliminates manual body-logging friction entirely. MODE
   classifier becomes objectively grounded (not inferential). Body-business
   correlation becomes statistically valid. Foundation: `PersonalDailyLog`
   schema already has all the fields. 1 new endpoint + 1 Shortcut. The
   single highest-leverage move on this list if it works.

---

## Part 3 · Cross-cutting patterns worth knowing

These are observations across multiple dimensions · not single items.

### Pattern A · The `Promise.resolve(0)` plague is not fully gone
Five brain files still contain hardcoded zero-returning placeholders
where bridge queries should be. The downstream code paths guard on
`> 0`, so entire alert branches are dead code in production. We thought
we fixed this kind of bug in Wave 49 (the unauth GETs) and Wave 52 (the
event emit gaps). It's deeper than that. **Action**: a one-pass sweep
for every `Promise.resolve(0)` and `await Promise.resolve(0)` in
`lib/brain/` · wire OR delete each one.

### Pattern B · Backend complete, frontend missing
A repeating pattern: a sophisticated backend layer is built (people-
intelligence, anticipated-questions, revenue-decision-channel, wisdom-
evolution, content publishing) and silently produces signals that
never reach the operator because no UI surface consumes them. **The
biggest leverage from here forward is NOT building new backends. It's
building surfaces (Telegram pushes · pages · cards) that expose
existing latent capability.**

### Pattern C · Feedback loops aren't closing
Skills recall fires but no signal flows back to tune the embeddings.
Judge-eval scores accumulate but never feed into prompt tuning.
Predictive-prefetch fires but never learns which prefetches got used.
Ghost Nick accuracy is computed but never feeds into its own
confidence scoring. **The brain produces telemetry but doesn't yet
USE it to self-improve.** Closing these loops is the next phase of
brain maturity.

### Pattern D · Cost levers exist but aren't pulled
`extended` cache TTL · task-typed cache keys · in-process budget cache
· deep-research result caching · structured-outputs replacing JSON-
prompt-parsing. Each is documented. None are shipped. Combined,
they likely cut AI bill 40-60% without changing capability at all.

### Pattern E · The OS knows but doesn't tell
Operator state is being CALCULATED in 5+ places (emotional-arc, drift-
detector, ghost-nick predictions, blind-spot pinner, MODE classifier).
None of it informs Nick's responses in real-time. The operator can be
high-stress with declining confidence and Nick will still suggest a new
ambitious commitment. **Closing this is the difference between an AI
assistant and a personal OS that knows you.**

---

## Part 4 · How to use this doc

This document supersedes the "what's next" question for the next 4-6
weeks. Three usage patterns:

1. **Daily**: pick one 🔴 critical or 🟠 quick-win and ship it. 60-90 min
   commits, every-day cadence. 8 items at 🟠 = 8 working days, all
   independently shippable, each with measurable impact.

2. **Weekly**: pick one 🟡 capability evolution and dedicate a full day.
   7 items = 7 weeks of focused capability work.

3. **Strategic planning**: 🟢 items are 1-2 week sprints each. Pick the
   one that aligns with the current operator priority.

When a wave ships, strike-through the item in this doc + add the commit
hash. When new gaps emerge, add to the appropriate tier. This is the
living roadmap.

Last updated: 2026-05-16 EOD · v10.0.529.106 ship-day · synthesis of
6-agent audit across cost+capability · cognition · UX · data+ops ·
tech debt · strategic capability gaps.
