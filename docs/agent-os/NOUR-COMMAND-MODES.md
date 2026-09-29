# NOUR COMMAND - operating-mode router

This is the detailed mode catalog for `NOUR-COMMAND.md`. Load only the modes relevant to the current outcome.
Modes compose; use the smallest combination that closes the real gap. Root `AGENTS.md` remains engineering-policy authority.

## Portfolio, repo, and execution modes

### 1. Full portfolio reconstruction
Rebuild the authoritative execution ledger from sessions, briefs, issues, branches, PRs, deployments, docs, and runtime evidence.
Deduplicate overlapping workstreams. Classify each item by current truth and identify dependencies, remaining work, and proof required.

### 2. Monorepo forensics and cleanup
Map apps, packages, worktrees, branches, generated files, caches, dependencies, scripts, configs, duplicate implementations, and stale experiments.
Classify KEEP / CONSOLIDATE / ARCHIVE / DELETE / INVESTIGATE. Verify imports, callers, deploy use, and runtime dependence before deletion.

### 3. Computer/development-environment de-bloat
Use for workstation storage/tooling cleanup: app sizes, caches, Docker, local models, SDKs, stale installers, temp files, duplicate repos,
node_modules, Python environments, build artifacts, and startup apps. Prefer dependency-aware cleanup and measure recovered space.

### 4. Production architecture truth audit
Reverse-engineer services, workers, schedulers, DBs, queues, models, APIs, caches, and external dependencies from production inward.
Trace critical workflows and identify hidden coupling, duplicate schedulers, retry/timeout problems, missing idempotency, and observability gaps.

### 5. Built-vs-working audit
Trace UI -> API -> logic -> queue/job -> data -> external dependency -> side effect -> receipt.
Prove code exists, is reachable, configured, executes, fails honestly, causes the intended effect, and exposes truthful telemetry.

### 6. Production incident / why is this still broken?
Start from current production symptoms and correlate deploy versions, logs, scheduler runs, data state, traces, retries, caches, and old instances.
Generate competing hypotheses, disprove them, fix the smallest durable root cause, and verify the original symptom is gone.

### 30. Open-ended repo execution from a spec
Treat any supplied audit/plan/session notes as leads. Re-check current repo/production truth, separate completed/superseded/unwired/missing work,
then execute valid remaining work in dependency order and reconcile docs after verification.

### 31. Concurrent AI session coordinator
Map current main, recent commits, active PRs, branches, worktrees, changed files, and issue ownership.
Route independent work concurrently, preserve valid sibling changes, resolve overlap by architecture/evidence, and re-check remote state before merge.

### 32. Autonomous backlog run-to-empty
Reconstruct backlog dependencies, select the highest-leverage currently actionable item, execute and verify it, then repeat.
Stop only when scoped actionable work is exhausted or a real external/protected-operation blocker remains.

### 33. Session / AI handoff reconstruction
Treat another session's notes as potentially stale, partial, local-only, or overclaimed.
Classify each claimed action VERIFIED / PLAUSIBLE-UNVERIFIED / SUPERSEDED / FALSE / IN-PROGRESS, recover valid work, then continue the objective.

### 34. Research-query generator
Convert a vague investigation into a strong research mandate: outcome, context, claims to verify, failure modes, sources, alternatives,
open-source/frontier scan, applicability, evidence standards, and anti-generic constraints. Then execute the mandate when tools allow.

### 35. Open-source / repository frontier scout
Search for libraries, repos, reference implementations, and research code that materially improve the target.
Evaluate fit, maintenance, license, maturity, dependencies, security, overlap, integration cost, production evidence, and what each candidate replaces.

### 36. Build / buy / reuse / delete decision
Compare internal reuse/repair, open source, managed service, small custom build, or eliminating the requirement.
Include engineering, maintenance, operational load, lock-in, performance, privacy, migration cost, reliability, extensibility, and opportunity cost.

### 42. Documentation truth reconciliation
Compare docs with current code and production. Detect planned-as-live claims, completed-as-TODO, obsolete architecture, wrong env vars,
stale instructions, duplicate truth sources, and historical notes presented as current. Consolidate to authoritative sources.

### 43. System boundary / responsibility audit
Determine what System A and System B each own. Find duplicated responsibility, unnecessary copied data, circular dependencies,
unclear ownership, and misplaced business logic. Prefer explicit contracts/events/identifiers across boundaries.

### 50. Delete / consolidate / simplify pass
After a major initiative, identify obsolete workarounds, duplicate paths, retired flags, old docs, unnecessary dependencies/services,
and abstractions that failed to justify themselves. Remove safely and run regressions.

## AI, memory, tool, and intelligence modes

### 7. Memory / retrieval intelligence audit
Audit embeddings, semantic/lexical/KNN retrieval, fusion, ranking, recency, confidence, follow-up handling, entity resolution,
dedupe, reinforcement, decay, pagination, provenance, and writes. Create adversarial cases, especially ambiguous short follow-ups.

### 8. Super-intelligent agent / tool system
Inventory current tools, agents, browser/computer abilities, memory, workflows, approvals, recovery, and observability.
Improve tool discovery, dynamic surfacing, multi-step execution, task state, provenance, typed receipts, recovery, and completion verification.

### 9. AI quality / fabrication control
Attack unsupported action claims, fabricated completion, hallucinated state, stale memory, false citations, tool failure as success,
outdated data, and ambiguous entity resolution. Add deterministic checks/evals without destroying useful recall or legitimate action.

### 39. Tool / MCP portfolio rationalizer
For each tool measure unique purpose, overlap, invocation, reliability, latency, permissions, token/context cost, discoverability, and failures.
Merge duplicates, improve descriptions, split/compose where useful, remove obsolete tools, and measure tool-selection quality.

### 40. Observability + proof layer
Define critical workflow trace boundaries, correlation IDs, state transitions, success criteria, failure categories, expected latency,
external outcome receipts, and replay/debug paths. Optimize for establishing truth, not dashboard count.

### 41. All-clear / health contract
Audit every healthy/success/synced/complete/all-clear claim. Define required evidence and identify false-green shapes:
missing telemetry, stale workers, skipped jobs, delayed queues, partial completion, failed dependencies, stale caches.

### 45. Local / cloud model router
Match workloads to local and hosted models based on intelligence, latency, privacy, context, multimodality, tool use,
reliability, cost, and offline capability. Verify configured models really launch and provide graceful capability-aware fallback.

### 46. Voice / TTS architecture
Inventory realtime voice, WebRTC/LiveKit, browser speech, TTS hooks, local TTS, and cloud providers.
Separate realtime conversation from read-this-message-aloud and avoid introducing a duplicate voice stack.

## Nick's Tire business and operations modes

### 10. Admin operating system
Treat admin as the operating system of the shop, not a dashboard. Center demand, customers, estimates, declined work, repair status,
payments, inventory, staff, communications, reviews, marketing, follow-up, exceptions, accountability, and actionable queues.

### 11. Business-system money-leak audit
Find unanswered leads, missed calls, abandoned estimates, unfollowed declined work, stale appointments, due-service customers,
tire inquiries without closeout, incomplete payments, review opportunities, and repeat-customer gaps. Quantify and automate responsibly.

### 12. AI phone receptionist
Evaluate latency, voice quality, interruption, naturalness, shop/service knowledge, pricing boundaries, appointment flow, escalation,
caller ID, spam resistance, summaries, disposition, CRM writeback, SMS follow-up, handoff, and QA/evals.

### 13. Post-call automation
Convert calls into structured state: caller, intent, vehicle, service, urgency, promise, appointment/quote status, objections,
sentiment, follow-up owner/deadline, and outcome. Create downstream actions without duplicate/unwanted messages.

### 14. Customer delight engine
Find small high-value moments that remove uncertainty, answer the next question, explain automotive issues,
show progress/evidence, simplify approvals, reduce phone tag, and create useful memorable interactions.

### 15. Careers / applicant flood engine
Optimize indexing, structured data, Google for Jobs, local targeting, mobile application flow, employer trust, salary clarity,
job-board distribution, referrals, retargeting, and organic content. Separate traffic problems from conversion problems.

### 16. SEO / Search Console demand audit
Segment queries/pages by impressions, clicks, CTR, position, intent, geography, conversion value, and page type.
Find high-impression weak-CTR pages, positions 4-20, cannibalization, thin/mismatched pages, missing services, and local modifiers.

### 17. Website truth / structured-data audit
Cross-check visible and hidden availability, inventory, price, review, hours, service, offer, schema.org, and product claims
against real sources. Remove fabricated precision and stale claims; degrade gracefully when truth is unavailable.

### 44. Shop camera / computer-vision intelligence
Treat cameras as an operational sensing layer. Audit acquisition, pane discovery, tracking, calibration, zones, temporal reasoning,
event detection, uncertainty, persistence, business-event correlation, privacy, false positives, and operator review.

## Content, brand, and growth modes

### 18. Faceless content factory
Design repeatable short-form franchises with hook -> escalating information -> visual payoff -> useful takeaway -> CTA when justified.
Optimize retention, rewatches, sends, shares, saves, local recognition, profile visits, and customers while avoiding AI-slop.

### 19. Content idea -> production rotation
Compare new ideas against current rotation, dedupe semantic overlaps, define required assets/generation/templates,
wire distinct ideas into actual selection, test renderability/quality, and update docs only after the path is reachable.

### 20. Creative remix for my brand
Extract the source asset's mechanism - hook, timing, framing, humor, escalation, visual grammar, payoff, CTA, share trigger -
then redesign it into an original brand-native concept rather than copying surface details.

### 49. Personal / brand social growth engine
Separate reach -> attention -> recognition -> profile conversion -> follower conversion -> real-world/business outcome.
Audit positioning, recurring series, collaborations, local network effects, social proof, shareability, and recognizable creative identity.

## Product, experience, travel, and creative modes

### 21. Professional audio restoration
Diagnose noise, clipping, room reflections, tone, muffled/harsh vocals, inconsistent level, stereo field, balance, and transient loss.
Restore the captured performance; preserve identity and avoid synthetic impersonation when source capture is insufficient.

### 22. Current product / experience research
Search official sources, specialist communities, recent reviews, specs, pricing, and independent comparisons.
Separate marketing claims from real capability and return only materially distinct options with tradeoffs.

### 23. Local best-along-my-route search
Find high-quality, locally respected options with minimal route deviation. Account for reviews, opening time, parking/access,
route efficiency, and actual detour before recommending.

### 24. Real-time road-trip optimizer
Treat arrival deadline as hard. Use current drive time, traffic, stop duration, parking, closing times, and buffer.
Build one executable itinerary rather than a giant menu.

### 25. Itinerary reconciliation
Update an existing itinerary under new constraints while preserving good choices.
Recalculate sequence and travel, flag unrealistic items, and optimize the whole day rather than one stop in isolation.

### 37. UI mechanism reverse-engineering
Study strong interfaces for hierarchy, progressive disclosure, command surfaces, navigation, exceptions, search/filtering,
temporal context, state visualization, interaction density, keyboard use, responsive behavior, feedback, and trust. Adapt principles, not skins.

### 38. Full frontend quality audit
Review major routes and shared components for hierarchy, consistency, responsiveness, accessibility, loading/error/empty states,
performance, conversion, SEO, trust, interaction clarity, stale components, duplication, and design-system drift.

## Personal systems, decisions, and strategy modes

### 26. Asset-leverage audit
Inventory hardware/software/equipment, current use, underused capabilities, integrations, automation, business uses,
productivity uses, and combinations. Recommend buying only when a genuine bottleneck remains.

### 27. Custom AI instructions optimizer
Infer desired behavior, remove redundancy/conflicts/vagueness/wasted tokens, add missing verification/tool/completion rules,
and produce concise instructions optimized for observable behavior.

### 28. Deep course-correction audit
Question the entire direction. Find sunk-cost traps, low-leverage commitments, unnecessary complexity, underused assets,
bottlenecks, compounding opportunities, and productive-looking waste. Prefer the smallest changes that alter trajectory.

### 29. Practical health symptom triage
Differentiate common explanations, medication/substance/environment effects, clinician-worthy conditions, and urgent red flags.
Identify differentiating observations, safe immediate actions, and thresholds for care; do not jump to rare diagnoses.

### 47. Personal intelligence / Life OS audit
Map capture, memory, tasks, projects, research, decisions, routines, communication, files, personal/business context,
mobile and desktop access. Remove duplicate capture and silos; optimize for the right context/action appearing with minimal upkeep.

### 48. New business opportunity engine
Evaluate opportunities against capital, skills, location, autonomy, time, and preferences using local demand, margin, labor,
owner dependency, automation, competition, learning curve, regulation, repeat revenue, defensibility, scalability, downside, and exit options.

## Meta rules that cut across all modes

- Use a task-specific Definition of Done, not a universal checklist.
- Preserve the evidence ladder: claim -> artifact -> execution receipt -> external effect -> outcome.
- Search for negative evidence before declaring success.
- Convert material failures into regression tests/evals/checks.
- Define overloaded terms with semantic contracts when ambiguity affects behavior.
- Preserve causal/correlation IDs across important cross-system journeys when feasible.
- Give temporary mechanisms sunset/removal conditions.
- Charge new subsystems against a complexity budget; ask what they replace.
- For Nick's Tire, tie automation to economic outcomes where possible.
- Treat UNKNOWN, STALE, DEGRADED, FAILED, and HEALTHY as distinct states.
