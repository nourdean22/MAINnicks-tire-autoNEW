# Power Atlas · Design Spec

**Date** · 2026-05-27
**Status** · approved · ready for writing-plans
**Owner** · Nour (operator)
**Surface** · `/relationships` (extended)
**Author** · Claude (Opus 4.7 · 1M context)

---

## Executive summary

The Power Atlas is statenour's relationship-intelligence surface. It extends the existing `/relationships` page from a passive trust-and-neglect view into an active **power-acquisition tool** — a Robert-Greene-flavored, ADHD-adapted dossier-and-ledger system that handles ALL relationships (friends, family, romantic, business, mentors, enemies) through three composed lenses (Elon · Sam · Niche-intelligence) plus eight cross-pollinated skills from the catalog.

The user-visible promise · open a person, see their full dossier auto-drafted from chat + email history with Greene archetype tags · plan a conversation · draft a message · log effort like a bank account · blow them up nuclear when needed. Sunday digest reads in Greene's voice. Phone vibrates only on birthdays + Sunday.

The architectural promise · single schema extension on existing `PersonProfile` + one new `RelationshipLedger` table · zero migration churn for downstream phases · brain layer auto-embeds everything · hybrid search across profiles + ledger notes.

## Locked scope decisions

| Decision | Value |
|---|---|
| Surface | Extend `/relationships` in place (NOT a separate `/friends` page) |
| Ledger model | Hybrid auto + manual · signed integer `amount` · no `kind` enum (sign tells you everything) |
| Blow-up semantics | Nuclear · auto-feeders STOP (specifically: ingest-gmail · ingest-calendar · chat-mention-tracker · kept-word-scan all add a `WHERE personProfile.status != "blown_up"` filter to their write path) · hidden from default views · ledger frozen · row preserved for history · revive requires confirmation modal showing original blow-up reason |
| Status state machine | `active` → `cooling` (14d silent) → `dormant` (90d silent) → `blown_up` (operator pressed button) |
| Alert cadence | Sunday digest + birthday/anniversary same-day · NOTHING else |
| Nick activity | Passive · coaches via STRUCTURE not pings · only proactive surfaces are the digest + birthday cron |
| Dossier depth | One `dossierMd` blob (markdown) · AI auto-drafts weekly from chat + email history · operator edits |
| Greene corpus | All 5 books baked in (48 Laws · Mastery · Human Nature · Seduction · 33 Strategies of War) |
| Brain integration | Required · every profile write + ledger note ≥20 chars embedded into VectorEmbedding · hybrid search endpoint |
| ADHD adaptations | Auto-draft dossier · max 10 visible · Cmd+K log-anywhere · visible reward animations · blow-up reason logged forever |
| Aesthetic | Minimalist-UI principles INSIDE statenour dark/gold canvas · no emoji on this surface · serif headings (Newsreader/Lyon) · monospace ledger amounts · bento layout · 1px borders #EAEAEA-equivalent on dark = `rgba(255,255,255,0.06)` |
| Phases | 0 Foundation · 1 Daily-driver · 2 Compounding moats · 3 High-res intelligence |
| Lens governance | Elon owns Phase 0+1 (lean, ship fast) · Sam owns Phase 2 (compounding moats) · Niche owns Phase 3 (high-res signals) · operator (president) approves each phase before next launches |

## Schema · final

### Extensions to existing `PersonProfile`

```prisma
model PersonProfile {
  // EXISTING (do not touch) ────────────────────────────────────
  id               String    @id @default(cuid())
  name             String    @unique
  role             String    // see role enum extension below
  relationship     String    @db.Text
  patterns         Json?
  trustScore       Float     @default(0.5) @map("trust_score")
  leverageNotes    String?   @map("leverage_notes") @db.Text
  lastInteraction  DateTime? @map("last_interaction")
  interactionCount Int       @default(0) @map("interaction_count")
  metadata         Json?
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  // NEW · Phase 0 (Elon-lean core) ─────────────────────────────
  status         String   @default("active") // active | cooling | dormant | blown_up
  blownUpAt      DateTime?
  blowUpReason   String?  @db.Text          // required when status flips to blown_up
  birthday       String?                     // ISO date · "1985-03-14" · year may be invented when unknown
  anniversary    String?                     // optional · separate from birthday
  dossierMd      String?  @db.Text          // ONE markdown blob · AI auto-drafts · operator edits
  cadenceDays    Int?                        // null = no target · raw days · defaults from observed median
  dossierUpdatedAt DateTime?                 // when the AI last redrafted

  // NEW · Phase 0 (Greene corpus integration) ──────────────────
  greeneType        String?                  // mentor | anti_mentor | apprentice | drainer | rival | ally | unknown
  applicableLaws    Int[]                    // 48 Laws of Power numbers (array of 1-48 ints)
  darkTraits        String[]                 // narcissist | envious | defensive | grandiose | manipulator | none-detected
  seducerType       String?                  // Siren | Rake | Charmer | Charismatic | Star | Natural | Coquette | Ideal | Dandy | none
  mentorshipRole    String?                  // true_mentor | peer_mentor | anti_mentor | apprentice | none
  currentStrategy   String?                  // engage | defend | withdraw | counter | wait

  // NEW · Phase 0 (power dynamics, auto-derived later) ─────────
  powerBalance      Float    @default(0.0)   // -1.0 (they have leverage over you) to 1.0 (you over them)

  // NEW · Phase 2 (cross-pollination · auto-populated Json) ────
  // behavioralFingerprint shape (bdistill-behavioral-xray adapted):
  //   { decisionStyle, refusalPatterns[], conflictTriggers[], toneDefaults,
  //     communicationCadence, refreshedAt }
  behavioralFingerprint Json?

  // psychographicLadder shape (customer-psychographic-profiler adapted):
  //   { identity[], needs[], fears[], statusConcerns[], valuesSnapshot,
  //     refreshedAt }
  psychographicLadder   Json?

  // lastArcPlan shape (emotional-arc-designer output):
  //   { goal, currentState, desiredState, phases[{order, label, prompt}],
  //     generatedAt }
  lastArcPlan           Json?

  // powerPlaysHistory shape: array of {at, playKind, lawApplied, outcome}
  // truncated to last 50 entries (server-side trim on write).
  powerPlaysHistory     Json?

  // INDEXES ────────────────────────────────────────────────────
  @@index([status])
  @@index([role, status])
  @@index([birthday])                        // for the birthday-this-week cron
  @@index([cadenceDays])
  @@index([greeneType])
  @@index([powerBalance])
  @@index([deletedAt])
  @@map("person_profiles")
}
```

Role enum is the existing String column. Allowed values extended to:
`employee, customer, vendor, family, competitor, advisor, friend, close_friend, mentor, mentee, ex_friend, acquaintance, network_only, romantic, ex_romantic, enemy, rival`.

### New `RelationshipLedger` table

```prisma
model RelationshipLedger {
  id        String   @id @default(cuid())
  personId  String
  person    PersonProfile @relation(fields: [personId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now()) @map("created_at")
  amount    Int                       // signed · +5 deposit · -3 withdraw · sign + magnitude tell the story
  note      String   @db.Text         // operator's text · or auto-feeder summary
  source    String                    // gmail | calendar | chat | telegram | manual | auto | greene_play

  metadata  Json?                     // optional · for source-specific extras
                                      //   gmail: { messageId, threadId, subject }
                                      //   calendar: { eventId, eventTitle, attendedFlag }
                                      //   chat: { conversationId, mentionContext }
                                      //   greene_play: { playKind, lawApplied, beforeBalance, afterBalance }

  @@index([personId, createdAt])
  @@index([source])
  @@index([createdAt])
  @@map("relationship_ledger")
}
```

Back-reference added to `PersonProfile`:
```prisma
ledger RelationshipLedger[]
```

### New `RelationshipPlay` table (Phase 2)

```prisma
model RelationshipPlay {
  id          String   @id @default(cuid())
  personId    String
  person      PersonProfile @relation(fields: [personId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now()) @map("created_at")
  kind        String                  // arc_plan | message_draft | scarcity_play | reciprocity_assess
  inputCtx    Json                    // what context the play received (operator's goal + person state)
  output      Json                    // the AI's output (the arc, the draft, the recommendation)
  outcome     String?                 // operator-logged outcome later · win | partial | loss | not_executed
  outcomeNote String?  @db.Text

  @@index([personId, createdAt])
  @@index([kind])
  @@map("relationship_plays")
}
```

Back-reference added to `PersonProfile`:
```prisma
plays RelationshipPlay[]
```

## Cross-pollination map · 8 skills → 8 features

| # | Source skill (in `~/.claude/skills/`) | Feature in Power Atlas | Phase |
|---|---|---|---|
| 1 | `customer-psychographic-profiler` | `psychographicLadder` auto-populated · ladder = identity → needs → fears → status concerns | 2 |
| 2 | `bdistill-behavioral-xray` | `behavioralFingerprint` auto-populated · decision style + refusal patterns + tone defaults · re-runs monthly | 2 |
| 3 | `emotional-arc-designer` | "Plan a conversation" power-play · outputs `RelationshipPlay(kind=arc_plan)` · 3-5 phase script | 2 |
| 4 | `copywriting-psychologist` + `sequence-psychologist` + `headline-psychologist` | "Draft a message" power-play · outputs `RelationshipPlay(kind=message_draft)` · operator edits + sends | 2 |
| 5 | `scarcity-urgency-psychologist` | "Scarcity playbook" per profile · outputs `RelationshipPlay(kind=scarcity_play)` | 3 |
| 6 | `apify-brand-reputation-monitoring` (adapted) | Cross-reference chat mentions of person X by OTHER people in network · social-proof intel | 3 |
| 7 | `networkx` algorithms | Centrality + bridge-node detection on relational graph · "who bridges your business + friend networks" | 3 |
| 8 | `apify-influencer-discovery` (adapted) | "Wanted relationships" tab · auto-discovers people you'd like to know via topic-match against your goals | 3 |

For #1-#5, the skills are used as **frameworks** to write the AI prompts in statenour. They're not literal HTTP integrations · statenour calls `tracedAiChat` with a system prompt that follows the skill's framework.

For #6-#8, real integration is required (Apify keys for #6/#8, networkx via Python sidecar or pure JS reimplementation for #7).

## Greene corpus integration · how each book shows up

| Book | Schema fields | Surfaced where |
|---|---|---|
| **48 Laws of Power** (1998) | `applicableLaws: Int[]` | Sidebar on every profile shows the 2-3 most applicable laws with one-line summary · click expands to Greene's full text excerpt (seeded as BrainMemory(category=greene_law, key=law_N)) |
| **Laws of Human Nature** (2018) | `darkTraits: String[]` · `psychographicLadder` (Phase 2) | "Dark patterns" chip on profile · auto-detected from chat sentiment + linguistic markers |
| **The Art of Seduction** (2001) | `seducerType: String?` | Single chip on profile · classifies people with social power · helps you read their game |
| **Mastery** (2012) | `mentorshipRole: String?` | "Mentor watch" view filters by mentorshipRole=true_mentor · "Anti-mentor watch" filters by anti_mentor · time-spent vs actionable-advice ratio surfaced |
| **33 Strategies of War** (2006) | `currentStrategy: String?` | Per-profile strategy chip · informs cadenceDays default · "withdraw" status maps to extended cadence · "engage" maps to short cadence |

Seeded knowledge base · `BrainMemory(category="greene_law", key="law_<N>")` · one row per law · `content` field contains the law text + Greene's commentary · accessed by Sunday digest cron via semantic match.

## Brain layer integration · required

1. Every `PersonProfile.update` where `dossierMd` or `psychographicLadder` or `behavioralFingerprint` changes → fires a write to `VectorEmbedding(sourceType="person_profile", sourceId=person.id)`.
2. Every `RelationshipLedger.create` where `note.length >= 20` → fires `VectorEmbedding(sourceType="relationship_ledger", sourceId=ledger.id)`.
3. Hybrid search endpoint · `GET /api/people/search?q=<query>` → returns blended ranking of:
   - BM25 (postgres full-text) over `name + dossierMd + ledger.note`
   - Cosine over the embeddings
   - Blended score = `0.4 * bm25_normalized + 0.6 * cosine`
4. Chat with Nick auto-pulls person context · when operator mentions a person by name in chat, Nick's recall layer pulls the top 5 person rows by name match + their last 10 ledger entries.
5. Brain memory categories used: existing `RELATIONSHIPS` + new `GREENE_LAW` + new `POWER_PLAY` (for play execution traces).

## Data flow · canonical example

**Operator opens /relationships → views Mike's profile:**

1. Page request → tRPC `task.people.getProfile(personId)` → returns `{person, recentLedger(20), recentPlays(10), applicableLawTexts}`.
2. UI renders bento grid:
   - Left column · dossierMd (rendered markdown) · status chip · power balance bar · cadence indicator · last interaction
   - Right column · applicable laws sidebar (top 2-3 expanded) · Greene archetype chips · dark traits chips · current strategy
   - Bottom bento · ledger timeline (last 20) · `+effort` / `-effort` / `blow up` quick actions · "Plan conversation" + "Draft message" power-play buttons
3. Operator taps "+effort" with note "great hang at coffee" amount=10 → tRPC `task.people.logLedger({personId, amount: 10, note, source: "manual"})` → DB write → embedding queued → return updated profile.
4. Reward animation · the trust score number ticks up with soft glow over 600ms (`will-change: transform`).

**Sunday digest cron fires at 22:00 UTC (Sunday 6pm ET):**

1. Query: all `PersonProfile` where status != "blown_up" AND deletedAt is null.
2. For each, compute: is overdue (lastInteraction > cadenceDays ago) · is cooling/dormant transition this week · has birthday this week · ledger trend last 30d.
3. Greene law match · semantic search applicableLaws against current state · pull relevant law texts.
4. Compose a Greene-voiced digest via `tracedAiChat` · 5-7 bullet max · markdown.
5. Send via `sendTelegram` · idempotent per ISO week (BrainMemory marker pattern from ingest-gmail).

**Birthday cron fires every morning at 12:00 UTC (8am ET):**

1. Query: PersonProfile where MM-DD of birthday matches today AND status != "blown_up".
2. For each match, send Telegram: "Mike turns N today · [last interaction context] · suggested message · open profile."
3. Idempotent per (personId, ISO date).

## ADHD-adaptation specifics

1. **Auto-draft dossier** · weekly cron scans chat history + Gmail mentions of the person + calendar attendance · drafts a 5-bullet dossier paragraph · operator hits ✓ approve or edits inline. **Manual fill drops to ~0.**
2. **Predictive cadence** · `cadenceDays` defaults to observed median interval from ledger · system learns the rhythm, operator doesn't declare it.
3. **Max-10 visible** · /relationships page never shows more than 10 cards above the fold · "show more" expansion only · prevents overwhelm.
4. **Cmd+K log-anywhere** · global keyboard shortcut opens a single-input field · "mike +5 great hang" syntax parses to `{name, amount, note}` · zero navigation required.
5. **Reward animation** · trust score number ticks up with soft glow on every positive ledger entry · ADHD dopamine compatibility.
6. **Blow-up reason mandatory** · cannot flip status to `blown_up` without writing a one-sentence reason · stored in `blowUpReason` forever · revealed in the confirmation modal if operator later tries to revive.
7. **Three facts visible** · each card surfaces the THREE MOST IMPORTANT FACTS from the dossier blob · AI extracts them weekly · always visible on the card · no scrolling required to remember why this person matters.
8. **Greene laws as chips** · applicable laws surface as one-sentence chips · no reading required mid-decision.

## Aesthetic · minimalist-UI inside statenour dark/gold

Apply the following minimalist-UI principles within statenour's existing dark canvas:

- Typography · serif (Newsreader or Instrument Serif) for the page title + person names · geometric sans (current stack) for body · monospace (Geist Mono) for ledger amounts + cadence days
- Color · canvas stays `#0A0A0A` · primary amber accent `#FDB913` for power-balance gauge · zinc-500 for body text · pastel desaturated tags ONLY for semantic meaning (Greene law chips · status chips)
- Borders · `rgba(255,255,255,0.06)` (the dark-mode equivalent of `#EAEAEA` on light) · 1px · 8-12px radius max
- Shadows · none on cards · subtle `0 2px 8px rgba(0,0,0,0.3)` only on the active modal
- Motion · fade + translate(12px → 0) over 600ms with `cubic-bezier(0.16, 1, 0.3, 1)` · IntersectionObserver-driven · staggered with `calc(var(--index) * 80ms)`
- No emojis on this surface · ledger entries use `+5` / `-3` / `blown up` text labels not emoji
- Bento grid · 3-column on desktop, 1-column on mobile · asymmetric (dossier blob takes 2 cols, sidebar takes 1)
- Phosphor or Radix icons · NOT Lucide (statenour's existing default) · this is a deliberate aesthetic break for the Power Atlas surface as a "highest-craft section" signal

## Phases · what ships when

### Phase 0 · Foundation (Wave PA-0)

| Deliverable | LOC est. | File |
|---|---|---|
| Schema migration · PersonProfile extensions + RelationshipLedger + RelationshipPlay | ~150 SQL | `prisma/migrations/20260527_power_atlas_foundation/migration.sql` |
| Prisma schema updates | ~80 | `prisma/schema.prisma` |
| BRAIN_CATEGORIES additions · GREENE_LAW · POWER_PLAY · RELATIONSHIP_DIGEST | ~15 | `lib/brain/categories.ts` |
| Greene law seed script · seeds 48 BrainMemory rows + 18 dark-trait rows + 9 seducer-type rows | ~200 | `scripts/seed-greene-corpus-2026-05-27.ts` (one-shot) |
| Brain embedding hook · auto-queues embeddings on PersonProfile/Ledger writes | ~80 | `lib/brain/people-embed-hook.ts` (new) + edits in `lib/services/goals.ts` style |
| Hybrid search endpoint · BM25 + cosine blend | ~200 | `app/api/people/search/route.ts` (new) |
| Extended tRPC procedures · people.getProfile + people.logLedger + people.flipStatus | ~150 | `lib/trpc/routers/task.ts` |
| Verification script · checks migration applied + 48 law rows + 1 sample PersonProfile re-embed | ~50 | `scripts/verify-power-atlas-foundation-2026-05-27.ts` (one-shot, deleted after run) |

Apply migration to prod Neon via the existing migration flow.

### Phase 1 · Daily-driver UI (Wave PA-1)

| Deliverable | LOC est. | File |
|---|---|---|
| Extend `/relationships` page · 4-status state machine UI · per-row deposit/withdraw/blow-up · dossier blob editor | ~600 | `app/(mastery)/relationships/page.tsx` |
| New components · `<DossierEditor>` · `<LedgerTimeline>` · `<GreeneLawSidebar>` · `<PowerBalanceGauge>` | ~500 | `components/power-atlas/*.tsx` |
| Cmd+K log-anywhere · extends existing cmdk command palette | ~100 | `components/command-palette/relationship-log-action.tsx` |
| Sunday digest cron · Greene-voiced output | ~250 | `app/api/cron/relationship-digest/route.ts` (new) + `config/crons.ts` registration |
| Birthday/anniversary cron · same-day morning push | ~150 | `app/api/cron/relationship-birthday/route.ts` (new) |
| Nuclear blow-up flow · confirmation modal · auto-feeder suspension | ~120 | `components/power-atlas/blow-up-modal.tsx` + cron-level filter in ingest-gmail/calendar |

### Phase 2 · Compounding moats (Wave PA-2)

| Deliverable | LOC est. | File |
|---|---|---|
| Kept-word tracker · auto-extract promises from chat/email · derive trust score | ~300 | `lib/brain/kept-word-tracker.ts` (new) + cron entry |
| Alpha moments archive · operator-flagged + AI-suggested alpha moments | ~200 | `components/power-atlas/alpha-moments.tsx` + ledger.metadata.alphaFlag |
| 5-year arc projection · AI projection of relationship trajectory | ~150 | `lib/brain/relationship-arc-projection.ts` (new) |
| Behavioral X-ray adaptation · `behavioralFingerprint` auto-populator · monthly cron | ~250 | `lib/brain/behavioral-xray-adapter.ts` (new) |
| Psychographic ladder profiler · `psychographicLadder` auto-populator · weekly cron | ~250 | `lib/brain/psychographic-ladder-adapter.ts` (new) |
| Power plays runner · executes arc_plan + message_draft + scarcity_play | ~300 | `lib/brain/power-plays-runner.ts` + UI action buttons |
| Dossier auto-drafter · weekly cron · scans + drafts dossierMd · operator approves | ~200 | `app/api/cron/dossier-autodraft/route.ts` (new) |

### Phase 3 · High-res intelligence (Wave PA-3)

| Deliverable | LOC est. | File |
|---|---|---|
| Reciprocity gradient · derive from Gmail/chat direction · 90d window | ~150 | `lib/brain/reciprocity-tracker.ts` (new) |
| Tone shift detection · trailing-3 vs trailing-30 sentiment delta | ~200 | `lib/brain/tone-shift-detector.ts` (new) |
| Topic graph × goal overlap · TF-IDF over chat topics with each person · cross-ref with LifeGoals | ~250 | `lib/brain/topic-goal-overlap.ts` (new) |
| Power balance dashboard · auto-computed `powerBalance` updates | ~150 | `lib/brain/power-balance-engine.ts` + UI gauge |
| Greene law auto-tagging · semantic match person patterns → applicable laws | ~200 | `lib/brain/greene-law-tagger.ts` (new) |
| Network graph view · centrality + bridge-node detection via networkx-equivalent JS | ~300 | `app/(mastery)/relationships/network/page.tsx` (new) |
| Brand-reputation cross-ref · what others say about each person | ~200 | `lib/brain/social-proof-aggregator.ts` (new) |
| Influencer / wanted-relationships discovery · Apify integration | ~200 | `lib/integrations/apify-people-discovery.ts` (new) |

## Error handling

- Every cron uses `cronHandler` (existing pattern) · returns structured payload with success metrics.
- All `sendTelegram` calls log via `console.warn` on failure (per the 2026-05-27 silent-failure observability fixes earlier today).
- All AI calls use `tracedAiChat` with appropriate label · failure returns safe fallback (e.g. empty arc, empty ladder) · never blocks the capture.
- Blow-up flow has explicit error path · if revive fails (stale state), shows operator-friendly error · row remains in blown_up state.
- Hybrid search degrades to BM25-only if embedding query fails.
- Auto-draft dossier failures log + skip · operator's dossier blob is never overwritten by a failed draft.

## Testing approach

- Unit tests for the AI prompt-building functions (verifies system prompt construction).
- Schema migration tested locally before prod apply.
- E2E test scenarios:
  1. Create person → log 5 ledger entries → verify trust score derives correctly
  2. Flip status to blown_up → verify auto-feeders skip · verify revive works with confirmation
  3. Birthday cron fires on simulated date → verify Telegram payload + idempotency
  4. Hybrid search returns expected ordering on seeded fixtures
  5. Cmd+K log-anywhere parses `mike +5 great hang` correctly
- Greene law seed verified via row count check after script run.
- Manual smoke test post-deploy on each phase before next phase starts.

## Open items (deliberately deferred)

- Mobile-specific layout polish · v1 ships with responsive but not iOS-PWA-tuned.
- iCal integration for birthday extraction from contacts · v1 birthdays are operator-entered or extracted from Gmail signature scans.
- Calendar attendance accuracy · v1 assumes attendance from event response · doesn't ping-out check actual attendance.
- Network-graph 3D view · Phase 3 ships 2D · 3D deferred.
- "Wanted relationships" tab (Apify-influencer) needs Apify account · pending operator action.

## Cron cadence summary

| Cron | Schedule (UTC) | What it does |
|---|---|---|
| `relationship-digest` | `0 22 * * 0` (Sunday 6pm ET) | Greene-voiced weekly digest · idempotent per ISO week |
| `relationship-birthday` | `0 12 * * *` (daily 8am ET) | Today's birthdays + anniversaries · idempotent per person+date |
| `dossier-autodraft` | `0 4 * * 1` (Monday 11pm ET prev night) | Re-drafts 20 highest-priority dossiers · operator approves Monday morning |
| `behavioral-xray-refresh` | `0 5 * * 1` (Monday midnight ET) | Re-runs behavioral X-ray on profiles with >5 ledger events since last run |
| `psychographic-ladder-refresh` | `0 6 * * 1` (Monday 1am ET) | Re-runs psychographic profiler · same trigger |
| `kept-word-scan` | `0 2 * * *` (daily 9pm ET prev night) | Scans last 24h chat for promises made TO operator · tracks follow-through |
| `reciprocity-tracker-update` | `0 3 * * 0` (Sunday 10pm ET prev night) | Computes 90d reciprocity gradient per person |
| `tone-shift-detect` | `0 1 * * *` (daily 8pm ET prev night) | Detects tone shifts on profiles with new chat data |

All have idempotency markers via `BrainMemory(category=proactive_push_sent | dossier_drafted | ...)` per the cleanup wave earlier today.

**Telegram alert policy reconfirmed.** Of the crons above, ONLY `relationship-digest` (Sunday) and `relationship-birthday` (daily morning) fire `sendTelegram`. All others are silent background workers that compute data into the DB — operator sees the results on /relationships, not on the phone. This honors the "minimal alerts, no burnout" mandate from the cleanup wave earlier today.

## Lens governance · who owns what

- **Elon (Phase 0+1)** · keeps the schema lean · 5 new columns + 2 new tables · no enum garbage · ledger is signed integer + note · ships in 2 waves
- **Sam (Phase 2)** · the compounding moats · kept-word tracker · alpha moments · 5-year arc · dossier auto-drafter · the data that gets more valuable over time
- **Niche-intelligence (Phase 3)** · high-resolution signals · reciprocity + tone shift + topic/goal overlap + power balance · only meaningful with Phase 0-2 data
- **Operator (president)** · approves each phase before next launches · holds the blow-up button · sets the "minimal alerts, no burnout" mandate

## Approval

This spec is approved as of 2026-05-27 per operator's "bake them all in, full auto mode" instruction.

Next steps:
1. Self-review the spec (next inline action)
2. Commit the spec
3. Invoke writing-plans skill for Phase 0+1 implementation plan (combined MVP plan)
4. Execute Phase 0 wave (foundation: schema + brain hooks + hybrid search + seed)
5. Apply prod migration
6. Smoke test
7. Execute Phase 1 wave (UI + digest cron + birthday cron + blow-up flow)
8. Natural pause for operator visual check on /relationships before Phase 2
9. Invoke writing-plans for Phase 2 implementation plan
10. Execute Phase 2 (compounding moats)
11. Invoke writing-plans for Phase 3 implementation plan
12. Execute Phase 3 (high-res intelligence)

Operator approval gates between phases are **natural pause points** in auto-mode — the build continues unless the operator interrupts to review or redirect. The HARD GATE only applies BEFORE the spec is written; after the spec exists, the implementation-plan + execute loop runs continuously.
