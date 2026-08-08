# Power Atlas · Phase 0+1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operator-usable Power Atlas MVP — schema extensions + brain integration + hybrid search + extended /relationships UI + Greene-flavored Sunday digest + birthday cron + nuclear blow-up flow.

**Architecture:** Extend existing `PersonProfile` model with ~15 new columns + add 2 new tables (`RelationshipLedger`, `RelationshipPlay`). Auto-embed everything into the existing `VectorEmbedding` pipeline. Surface the data through the existing `/relationships` page with new bento sections. Greene corpus lives as seeded `BrainMemory(category="greene_law")` rows accessed by the digest cron via semantic match. Telegram pings ONLY from the Sunday digest + birthday cron — all other crons silent.

**Tech Stack:** Next.js 16 / React 19 / Prisma 6 / Postgres (Neon) / tRPC v11 / Tailwind / existing statenour patterns (cronHandler · tracedAiChat · sendTelegram · BrainMemory)

**Spec reference:** `apps/statenour/docs/superpowers/specs/2026-05-27-power-atlas-design.md`

---

## File map · what gets touched

**Created:**
- `prisma/migrations/20260527_power_atlas_foundation/migration.sql`
- `lib/brain/people-embed-hook.ts`
- `lib/brain/greene-corpus.ts` (constants + seed)
- `scripts/seed-greene-corpus-2026-05-27.ts` (one-shot, deleted after run)
- `scripts/verify-power-atlas-phase-0-2026-05-27.ts` (one-shot, deleted after run)
- `app/api/people/search/route.ts`
- `app/api/cron/relationship-digest/route.ts`
- `app/api/cron/relationship-birthday/route.ts`
- `components/power-atlas/dossier-editor.tsx`
- `components/power-atlas/ledger-timeline.tsx`
- `components/power-atlas/greene-law-sidebar.tsx`
- `components/power-atlas/power-balance-gauge.tsx`
- `components/power-atlas/blow-up-modal.tsx`
- `components/power-atlas/log-ledger-modal.tsx`
- `components/command-palette/relationship-log-action.tsx`

**Modified:**
- `prisma/schema.prisma` (PersonProfile + 2 new models)
- `lib/brain/categories.ts` (3 new categories)
- `lib/trpc/routers/task.ts` (extend `people.*` procedures)
- `app/(mastery)/relationships/page.tsx` (full rewrite to bento layout)
- `app/api/people/route.ts` (return new fields)
- `config/crons.ts` (register 2 new cron entries)

---

## Task 0.1: BRAIN_CATEGORIES additions

**Files:**
- Modify: `apps/statenour/lib/brain/categories.ts:272` (after `WEEKLY_REVIEW_NUDGE`)

- [ ] **Step 1: Add three new category constants**

Append after the `WEEKLY_REVIEW_NUDGE` entry in BRAIN_CATEGORIES:

```ts
  // ── Power Atlas · 2026-05-27 ──
  /** Robert Greene corpus seed · 48 Laws + Mastery + Human Nature +
   *  Seduction + 33 Strategies of War. Key shape: `law_<N>` for laws,
   *  `dark_<trait>` for dark traits, `seducer_<type>` for seducer types,
   *  `mentor_<role>` for mentorship roles, `strategy_<name>` for war
   *  strategies. Content = JSON { title, summary, fullText, sourceBook,
   *  applicabilityPrompt }. Seeded once via scripts/seed-greene-corpus. */
  GREENE_LAW: "greene_law",
  /** Power-play execution trace · written by power-plays-runner on every
   *  arc_plan / message_draft / scarcity_play execution. Key shape:
   *  `play_<personId>_<timestamp>`. Content = JSON { kind, lawApplied,
   *  inputCtx, output, outcome? }. Surfaces in /relationships per-profile
   *  "Plays history" tab. */
  POWER_PLAY: "power_play",
  /** Sunday digest idempotency marker · one row per ISO week. Key =
   *  ISO-week string `YYYY-WNN`. Content = the digest text that was sent.
   *  Prevents double-sends on cron retries (Vercel at-least-once). */
  RELATIONSHIP_DIGEST_SENT: "relationship_digest_sent",
  /** Birthday push idempotency marker · key = `<personId>:YYYY-MM-DD`.
   *  Prevents double-pings on the same calendar date. 365d TTL. */
  RELATIONSHIP_BIRTHDAY_SENT: "relationship_birthday_sent",
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/statenour && pnpm typecheck
```

Expected: `0 errors`

- [ ] **Step 3: Commit**

```bash
git add apps/statenour/lib/brain/categories.ts
git commit -m "feat · power-atlas · register 4 new BRAIN_CATEGORIES (greene_law, power_play, relationship_digest_sent, relationship_birthday_sent)"
```

---

## Task 0.2: Prisma schema migration

**Files:**
- Modify: `apps/statenour/prisma/schema.prisma` (PersonProfile model + 2 new models)
- Create: `apps/statenour/prisma/migrations/20260527_power_atlas_foundation/migration.sql`

- [ ] **Step 1: Update PersonProfile in schema.prisma**

Replace the existing PersonProfile model (lines ~2019-2038) with the extended version:

```prisma
model PersonProfile {
  id               String    @id @default(cuid())
  name             String    @unique
  role             String // employee, customer, vendor, family, competitor, advisor, friend, close_friend, mentor, mentee, ex_friend, acquaintance, network_only, romantic, ex_romantic, enemy, rival
  relationship     String    @db.Text
  patterns         Json?
  trustScore       Float     @default(0.5) @map("trust_score")
  leverageNotes    String?   @map("leverage_notes") @db.Text
  lastInteraction  DateTime? @map("last_interaction")
  interactionCount Int       @default(0) @map("interaction_count")
  metadata         Json?
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  // 2026-05-27 · Power Atlas Phase 0 ── core lifecycle ──
  status         String    @default("active") @map("status")
  blownUpAt      DateTime? @map("blown_up_at")
  blowUpReason   String?   @map("blow_up_reason") @db.Text
  birthday       String?   // ISO date "1985-03-14" · year may be 1900 placeholder if unknown
  anniversary    String?
  dossierMd      String?   @map("dossier_md") @db.Text
  dossierUpdatedAt DateTime? @map("dossier_updated_at")
  cadenceDays    Int?      @map("cadence_days")
  deletedAt      DateTime? @map("deleted_at")

  // 2026-05-27 · Power Atlas Phase 0 ── Greene corpus ──
  greeneType        String?  @map("greene_type")
  applicableLaws    Int[]    @map("applicable_laws") @default([])
  darkTraits        String[] @map("dark_traits") @default([])
  seducerType       String?  @map("seducer_type")
  mentorshipRole    String?  @map("mentorship_role")
  currentStrategy   String?  @map("current_strategy")

  // 2026-05-27 · Power Atlas Phase 0 ── power dynamics ──
  powerBalance      Float    @default(0.0) @map("power_balance")

  // 2026-05-27 · Power Atlas Phase 2 (columns added now to avoid Phase 2 migration) ──
  behavioralFingerprint Json? @map("behavioral_fingerprint")
  psychographicLadder   Json? @map("psychographic_ladder")
  lastArcPlan           Json? @map("last_arc_plan")
  powerPlaysHistory     Json? @map("power_plays_history")

  ledger RelationshipLedger[]
  plays  RelationshipPlay[]

  @@index([role])
  @@index([trustScore])
  @@index([status])
  @@index([role, status])
  @@index([birthday])
  @@index([cadenceDays])
  @@index([greeneType])
  @@index([powerBalance])
  @@index([deletedAt])
  @@index([createdAt])
  @@index([updatedAt])
  @@map("person_profiles")
}
```

- [ ] **Step 2: Add RelationshipLedger model**

Append after PersonProfile:

```prisma
/// 2026-05-27 · Power Atlas Phase 0 · per-person event log.
/// Each row = one deposit/withdrawal/blow-up/etc. Signed `amount` ·
/// no kind enum (sign tells the story). `source` distinguishes auto
/// (gmail/calendar/chat) from manual (operator typed it).
model RelationshipLedger {
  id        String   @id @default(cuid())
  personId  String   @map("person_id")
  person    PersonProfile @relation(fields: [personId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now()) @map("created_at")
  amount    Int
  note      String   @db.Text
  source    String // gmail | calendar | chat | telegram | manual | auto | greene_play

  metadata  Json?

  @@index([personId, createdAt])
  @@index([source])
  @@index([createdAt])
  @@map("relationship_ledger")
}
```

- [ ] **Step 3: Add RelationshipPlay model**

Append after RelationshipLedger:

```prisma
/// 2026-05-27 · Power Atlas Phase 2 (table added in Phase 0 migration
/// to avoid Phase 2 schema work) · log of power-plays operator executed.
/// kind enum: arc_plan | message_draft | scarcity_play | reciprocity_assess
model RelationshipPlay {
  id          String   @id @default(cuid())
  personId    String   @map("person_id")
  person      PersonProfile @relation(fields: [personId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now()) @map("created_at")
  kind        String
  inputCtx    Json     @map("input_ctx")
  output      Json
  outcome     String?
  outcomeNote String?  @map("outcome_note") @db.Text

  @@index([personId, createdAt])
  @@index([kind])
  @@map("relationship_plays")
}
```

- [ ] **Step 4: Write the migration SQL**

Create `apps/statenour/prisma/migrations/20260527_power_atlas_foundation/migration.sql`:

```sql
-- 2026-05-27 · Power Atlas Phase 0 · foundation migration
-- Spec: docs/superpowers/specs/2026-05-27-power-atlas-design.md
--
-- ADDITIVE · safe to re-run via IF NOT EXISTS guards · no data movement.
-- Adds 15 columns to person_profiles + creates 2 new tables.
--
-- HOW TO APPLY
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260527_power_atlas_foundation/migration.sql
--   pnpm exec prisma migrate resolve --applied 20260527_power_atlas_foundation
--
-- ROLLBACK
--   DROP TABLE relationship_plays;
--   DROP TABLE relationship_ledger;
--   ALTER TABLE person_profiles
--     DROP COLUMN status, DROP COLUMN blown_up_at, DROP COLUMN blow_up_reason,
--     DROP COLUMN birthday, DROP COLUMN anniversary, DROP COLUMN dossier_md,
--     DROP COLUMN dossier_updated_at, DROP COLUMN cadence_days, DROP COLUMN deleted_at,
--     DROP COLUMN greene_type, DROP COLUMN applicable_laws, DROP COLUMN dark_traits,
--     DROP COLUMN seducer_type, DROP COLUMN mentorship_role, DROP COLUMN current_strategy,
--     DROP COLUMN power_balance, DROP COLUMN behavioral_fingerprint,
--     DROP COLUMN psychographic_ladder, DROP COLUMN last_arc_plan,
--     DROP COLUMN power_plays_history;

BEGIN;

ALTER TABLE person_profiles
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS blown_up_at         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS blow_up_reason      TEXT,
  ADD COLUMN IF NOT EXISTS birthday            TEXT,
  ADD COLUMN IF NOT EXISTS anniversary         TEXT,
  ADD COLUMN IF NOT EXISTS dossier_md          TEXT,
  ADD COLUMN IF NOT EXISTS dossier_updated_at  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS cadence_days        INTEGER,
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS greene_type         TEXT,
  ADD COLUMN IF NOT EXISTS applicable_laws     INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dark_traits         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seducer_type        TEXT,
  ADD COLUMN IF NOT EXISTS mentorship_role     TEXT,
  ADD COLUMN IF NOT EXISTS current_strategy    TEXT,
  ADD COLUMN IF NOT EXISTS power_balance       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS behavioral_fingerprint JSONB,
  ADD COLUMN IF NOT EXISTS psychographic_ladder  JSONB,
  ADD COLUMN IF NOT EXISTS last_arc_plan         JSONB,
  ADD COLUMN IF NOT EXISTS power_plays_history   JSONB;

CREATE INDEX IF NOT EXISTS person_profiles_status_idx              ON person_profiles (status);
CREATE INDEX IF NOT EXISTS person_profiles_role_status_idx         ON person_profiles (role, status);
CREATE INDEX IF NOT EXISTS person_profiles_birthday_idx            ON person_profiles (birthday);
CREATE INDEX IF NOT EXISTS person_profiles_cadence_days_idx        ON person_profiles (cadence_days);
CREATE INDEX IF NOT EXISTS person_profiles_greene_type_idx         ON person_profiles (greene_type);
CREATE INDEX IF NOT EXISTS person_profiles_power_balance_idx       ON person_profiles (power_balance);
CREATE INDEX IF NOT EXISTS person_profiles_deleted_at_idx          ON person_profiles (deleted_at);

CREATE TABLE IF NOT EXISTS relationship_ledger (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES person_profiles(id) ON DELETE RESTRICT,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount      INTEGER NOT NULL,
  note        TEXT NOT NULL,
  source      TEXT NOT NULL,
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS relationship_ledger_person_id_created_at_idx ON relationship_ledger (person_id, created_at);
CREATE INDEX IF NOT EXISTS relationship_ledger_source_idx               ON relationship_ledger (source);
CREATE INDEX IF NOT EXISTS relationship_ledger_created_at_idx           ON relationship_ledger (created_at);

CREATE TABLE IF NOT EXISTS relationship_plays (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES person_profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind         TEXT NOT NULL,
  input_ctx    JSONB NOT NULL,
  output       JSONB NOT NULL,
  outcome      TEXT,
  outcome_note TEXT
);

CREATE INDEX IF NOT EXISTS relationship_plays_person_id_created_at_idx ON relationship_plays (person_id, created_at);
CREATE INDEX IF NOT EXISTS relationship_plays_kind_idx                 ON relationship_plays (kind);

COMMIT;
```

- [ ] **Step 5: Regenerate Prisma client**

```bash
cd apps/statenour && pnpm exec prisma generate
```

Expected: `Generated Prisma Client (v7.8.0) to ./node_modules/@prisma/client`

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck
```

Expected: `0 errors`

- [ ] **Step 7: Commit**

```bash
git add apps/statenour/prisma/schema.prisma apps/statenour/prisma/migrations/20260527_power_atlas_foundation/
git commit -m "feat · power-atlas · prisma schema + migration · PersonProfile +15 columns + RelationshipLedger + RelationshipPlay"
```

---

## Task 0.3: Brain people-embed-hook

**Files:**
- Create: `apps/statenour/lib/brain/people-embed-hook.ts`

- [ ] **Step 1: Write the hook module**

```ts
/**
 * 2026-05-27 · Power Atlas Phase 0 · auto-embed hook.
 *
 * On any PersonProfile.update that touches dossierMd OR
 * psychographicLadder OR behavioralFingerprint, enqueue a
 * VectorEmbedding write so /api/people/search hybrid query can
 * cosine-rank against the dossier text.
 *
 * On any RelationshipLedger.create where note.length >= 20, enqueue
 * the same.
 *
 * Reuses the existing embed-backfill cron's enqueue pattern via
 * direct VectorEmbedding upsert (no separate queue needed — the
 * embed-backfill cron picks up unembedded rows on its next tick).
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/people-embed-hook");

/**
 * Mark a PersonProfile row as needing re-embedding. Called from
 * the tRPC people procedures + any cron that mutates the dossier.
 * Idempotent · upsert is the safe default.
 */
export async function enqueuePersonEmbed(personId: string): Promise<void> {
  await prisma.vectorEmbedding
    .upsert({
      where: {
        sourceType_sourceId: { sourceType: "person_profile", sourceId: personId },
      },
      create: {
        sourceType: "person_profile",
        sourceId: personId,
        textHash: "", // empty hash forces re-embed on next backfill
        dim: 0,
      },
      update: {
        textHash: "", // force re-embed
        updatedAt: new Date(),
      },
    })
    .catch((err) => {
      log.warn("person_embed_enqueue_failed", {
        personId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Same for ledger entries. Skips short notes (<20 chars · no signal).
 */
export async function enqueueLedgerEmbed(ledgerId: string, note: string): Promise<void> {
  if (note.length < 20) return;
  await prisma.vectorEmbedding
    .upsert({
      where: {
        sourceType_sourceId: { sourceType: "relationship_ledger", sourceId: ledgerId },
      },
      create: {
        sourceType: "relationship_ledger",
        sourceId: ledgerId,
        textHash: "",
        dim: 0,
      },
      update: {
        textHash: "",
        updatedAt: new Date(),
      },
    })
    .catch((err) => {
      log.warn("ledger_embed_enqueue_failed", {
        ledgerId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/statenour && pnpm typecheck
```

Expected: `0 errors`

- [ ] **Step 3: Commit**

```bash
git add apps/statenour/lib/brain/people-embed-hook.ts
git commit -m "feat · power-atlas · brain embed hooks for PersonProfile + RelationshipLedger"
```

---

## Task 0.4: Greene corpus seeded knowledge base

**Files:**
- Create: `apps/statenour/lib/brain/greene-corpus.ts`
- Create: `apps/statenour/scripts/seed-greene-corpus-2026-05-27.ts` (one-shot)

- [ ] **Step 1: Write the corpus constants**

Create `apps/statenour/lib/brain/greene-corpus.ts`:

```ts
/**
 * 2026-05-27 · Power Atlas · Robert Greene corpus.
 *
 * The 48 Laws of Power · 9 Seducer types from The Art of Seduction ·
 * top 12 Dark Traits from The Laws of Human Nature · 5 mentorship
 * roles from Mastery · 8 strategies from 33 Strategies of War.
 *
 * Seeded into BrainMemory(category="greene_law") via
 * scripts/seed-greene-corpus-2026-05-27.ts.
 *
 * Each entry's `applicabilityPrompt` is the AI instruction the
 * Sunday digest cron uses to decide whether this law applies to a
 * given person's current state.
 */

export interface GreeneEntry {
  key: string;            // brain memory key · "law_10", "seducer_siren", etc.
  category: "law" | "seducer" | "dark_trait" | "mentorship" | "strategy";
  number?: number;        // 1-48 for laws
  title: string;
  summary: string;        // 1-sentence
  fullText: string;       // 3-5 sentence Greene-flavored explanation
  sourceBook: string;
  applicabilityPrompt: string; // AI prompt fragment
}

// ─── 48 Laws of Power ────────────────────────────────────────────
export const LAWS_OF_POWER: GreeneEntry[] = [
  {
    key: "law_1", category: "law", number: 1,
    title: "Never outshine the master",
    summary: "Make those above you feel comfortably superior.",
    fullText: "Always make those above you feel comfortably superior. In your desire to please and impress them, do not go too far in displaying your talents or you might accomplish the opposite — inspire fear and insecurity. Make your masters appear more brilliant than they are and you will attain the heights of power.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Does this person hold positional or earned power over the operator (boss, senior peer, established expert in operator's domain)? If yes, Law 1 applies to outward-facing interactions.",
  },
  {
    key: "law_3", category: "law", number: 3,
    title: "Conceal your intentions",
    summary: "Keep people off-balance and in the dark by never revealing the purpose behind your actions.",
    fullText: "If they have no clue what you are up to, they cannot prepare a defense. Guide them far enough down the wrong path, envelop them in enough smoke, and by the time they realize your intentions, it will be too late.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Is the operator preparing a strategic move (negotiation, ask, pivot) involving this person? Law 3 applies — restrain over-sharing of intent.",
  },
  {
    key: "law_5", category: "law", number: 5,
    title: "Guard your reputation with your life",
    summary: "Reputation is the cornerstone of power.",
    fullText: "Through reputation alone you can intimidate and win; once it slips, however, you are vulnerable and will be attacked on all sides. Make your reputation unassailable. Always be alert to potential attacks and thwart them before they happen.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Does this person have ability or pattern of damaging the operator's reputation in shared social/professional circles? If yes, Law 5 applies — invest defensively.",
  },
  {
    key: "law_10", category: "law", number: 10,
    title: "Infection: Avoid the unhappy and unlucky",
    summary: "Misery and misfortune are infectious.",
    fullText: "You can die from someone else's misery — emotional states are as infectious as diseases. You may feel you are helping the drowning man but you are only precipitating your own disaster. The unfortunate sometimes draw misfortune on themselves; they will also draw it on you. Associate with the happy and fortunate instead.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Has this person's ledger trended net-negative for 90+ days AND does their cross-reference with operator's mastery score show drag (>0.5 drop on days they were chat-mentioned)? If yes, Law 10 is the central law for this profile.",
  },
  {
    key: "law_13", category: "law", number: 13,
    title: "Appeal to self-interest, never to mercy or gratitude",
    summary: "If you need to ask, find what they want.",
    fullText: "When asking for help, do not bother to remind others of your past assistance and good deeds. They will find a way to ignore you. Instead, uncover something in your request, or in your alliance with them, that will benefit them, and emphasize it out of all proportion. They will respond enthusiastically when they see something to be gained for themselves.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Is the operator about to ask this person for help? Law 13 applies — frame the ask around their self-interest, not your need.",
  },
  {
    key: "law_14", category: "law", number: 14,
    title: "Pose as a friend, work as a spy",
    summary: "Knowing about your rivals is critical.",
    fullText: "Use spies to gather valuable information that will keep you a step ahead. Better still, play the spy yourself. In polite social encounters, learn to probe. Ask indirect questions to get people to reveal their weaknesses and intentions.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Is this person a `rival` or `competitor` role with high power-balance positive (operator weaker)? Law 14 applies — gather intelligence patiently.",
  },
  {
    key: "law_16", category: "law", number: 16,
    title: "Use absence to increase respect and honor",
    summary: "Too much circulation makes the price go down.",
    fullText: "The more you are seen and heard from, the more common you appear. If you are already established in a group, temporary withdrawal from it will make you more talked about, even more admired. You must learn when to leave. Create value through scarcity.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Has the operator initiated 80%+ of recent interactions AND interactionCount > 20? If yes, Law 16 applies — strategic absence is the next move.",
  },
  {
    key: "law_20", category: "law", number: 20,
    title: "Do not commit to anyone",
    summary: "Keep yourself free, fluid, available.",
    fullText: "It is the fool who always rushes to take sides. Do not commit to any side or cause but yourself. By maintaining your independence, you become the master of others — playing people against one another, making them pursue you.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Is the operator being pressured into a faction or alliance by this person? Law 20 applies — preserve optionality.",
  },
  {
    key: "law_27", category: "law", number: 27,
    title: "Play on people's need to believe",
    summary: "People have an overwhelming desire to believe in something.",
    fullText: "Become the focal point of such desire by offering them a cause, a new faith to follow. Promise the moon but be vague; surround yourself with the trappings of mystery and certainty. Be careful with this one — Greene warns that using it dishonestly creates real backlash.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Does this person actively follow the operator or look to operator for direction? Law 27 applies — meet the need for belief with intentional framing.",
  },
  {
    key: "law_38", category: "law", number: 38,
    title: "Think as you like but behave like others",
    summary: "Read the room. Conform outwardly when the cost of nonconformity exceeds the value.",
    fullText: "If you make a show of going against the times, flaunting unconventional ideas and unorthodox ways, people will think you only want attention and look down on you. They will find a way to punish you. It is far safer to blend in and nurture the common touch. Share your originality only with tolerant friends.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Is this a `business` or `network_only` relationship where operator's idiosyncratic views could cost rapport? Law 38 applies — calibrate display.",
  },
  {
    key: "law_43", category: "law", number: 43,
    title: "Work on the hearts and minds of others",
    summary: "Coercion creates a reaction that will eventually work against you.",
    fullText: "You must seduce others into wanting to move in your direction. A person whom you have seduced becomes your loyal pawn. Work on emotions and individual psychology to bring people into your orbit.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Is this a `mentor`, `mentee`, `friend`, or `close_friend` role where coercion would damage long-term value? Law 43 always applies — focus on persuasion-through-emotion.",
  },
  {
    key: "law_47", category: "law", number: 47,
    title: "In victory, learn when to stop",
    summary: "Don't go past the mark you aimed for.",
    fullText: "The moment of victory is often the moment of greatest peril. In the heat of victory, arrogance and overconfidence can push you past the goal you had aimed for, and by going too far, you make more enemies than you defeat. Do not allow success to go to your head.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt: "Has the operator recently 'won' an interaction with this person (favor granted, argument resolved in operator's favor)? Law 47 applies — restrain the urge to press further.",
  },
];

// ─── 9 Seducer types (Art of Seduction) ──────────────────────────
export const SEDUCER_TYPES: GreeneEntry[] = [
  { key: "seducer_siren", category: "seducer", title: "Siren", summary: "Magnetic sexual presence + theater of imperfection.", fullText: "The Siren projects a sexual presence that promises pleasure and adventure. Her power lies in being slightly inaccessible and dramatic. The Siren operates by creating a public spectacle around herself.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person command attention through dramatic presence + sexual magnetism? Tag as Siren." },
  { key: "seducer_rake", category: "seducer", title: "Rake", summary: "Promises uncompromising desire + extravagant attention.", fullText: "The Rake worships at the altar of romance. Like a Don Juan, he focuses all his attention and desire on the target, making her feel uniquely chosen.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person specialize in dedicated romantic pursuit + verbal worship? Tag as Rake." },
  { key: "seducer_ideal_lover", category: "seducer", title: "Ideal Lover", summary: "Becomes whatever you most need.", fullText: "The Ideal Lover senses what the target is missing and becomes that. They are chameleons of unmet need.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person mirror back the operator's unstated needs? Tag as Ideal Lover." },
  { key: "seducer_dandy", category: "seducer", title: "Dandy", summary: "Androgynous, fluid, refuses to commit to a single type.", fullText: "The Dandy refuses to be pinned down. They display traits across gender + role, signaling unattainable freedom.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person resist being categorized? Tag as Dandy." },
  { key: "seducer_natural", category: "seducer", title: "Natural", summary: "Disarming, unstudied, childlike.", fullText: "The Natural seems incapable of artifice. Their power comes from triggering protective instinct in others.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person disarm with apparent un-self-conscious naturalness? Tag as Natural." },
  { key: "seducer_coquette", category: "seducer", title: "Coquette", summary: "Hot/cold, advance/retreat tempo.", fullText: "The Coquette controls through alternating heat and cold — granting attention then withdrawing it.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person operate on intermittent reinforcement / hot-cold cycles? Tag as Coquette." },
  { key: "seducer_charmer", category: "seducer", title: "Charmer", summary: "Soothes, flatters, makes you feel uniquely seen.", fullText: "The Charmer focuses entirely on you — your concerns, your ambitions, your worries. They draw out and reflect back.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person make the operator feel uniquely listened-to + understood? Tag as Charmer." },
  { key: "seducer_charismatic", category: "seducer", title: "Charismatic", summary: "Conveys an inner conviction or mission others want to follow.", fullText: "The Charismatic radiates conviction about a higher purpose. People follow them because they make the followers' lives feel meaningful.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person operate from visible mission + conviction? Tag as Charismatic." },
  { key: "seducer_star", category: "seducer", title: "Star", summary: "Ethereal, slightly removed, projects a screen for projection.", fullText: "The Star is luminous but slightly distant — close enough to be magnetic, far enough to remain an object of projection. Like a film star, they let others fill in the gaps.", sourceBook: "The Art of Seduction", applicabilityPrompt: "Does this person maintain glamour + slight distance? Tag as Star." },
];

// ─── 12 Dark Traits (Laws of Human Nature) ───────────────────────
export const DARK_TRAITS: GreeneEntry[] = [
  { key: "dark_narcissist", category: "dark_trait", title: "Narcissist (Deep)", summary: "Cannot tolerate criticism + drains others' attention.", fullText: "Deep narcissists need constant attention + cannot tolerate criticism. They drain energy from any interaction.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Has this person responded defensively + aggressively to mild critique 3+ times? Tag dark_narcissist." },
  { key: "dark_envious", category: "dark_trait", title: "Envious", summary: "Resents the operator's successes; subtly undermines.", fullText: "The envious type cannot bear to see others rise. They will quietly undermine while professing support.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Has this person responded coldly or critically to operator's recent wins? Tag dark_envious." },
  { key: "dark_grandiose", category: "dark_trait", title: "Grandiose", summary: "Self-image vastly exceeds actual contribution.", fullText: "Grandiose types live in a self-image far above reality. Their stories grow with each retelling.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Do this person's stated achievements drift inconsistent or inflated over time? Tag dark_grandiose." },
  { key: "dark_defensive", category: "dark_trait", title: "Defensive", summary: "Cannot accept feedback; every input becomes attack.", fullText: "Defensive types treat all input as attack. They cannot accept feedback or differing perspectives.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Has this person interpreted neutral input as personal attack 3+ times? Tag dark_defensive." },
  { key: "dark_manipulator", category: "dark_trait", title: "Manipulator", summary: "Uses guilt, obligation, false intimacy as levers.", fullText: "Manipulators read what you need and use it as a control lever. Guilt and obligation are their favorite tools.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Has this person used guilt or obligation 2+ times to extract effort? Tag dark_manipulator." },
  { key: "dark_passive_aggressive", category: "dark_trait", title: "Passive-aggressive", summary: "Hostility expressed indirectly through 'forgetting', delay, hint.", fullText: "Hostility never expressed openly. Always through forgetting, lateness, subtle digs, plausibly-deniable jabs.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Does this person express dissatisfaction through delay + forgetting rather than direct conversation? Tag dark_passive_aggressive." },
  { key: "dark_drainer", category: "dark_trait", title: "Drainer", summary: "Every interaction leaves operator with less energy than before.", fullText: "Drainers monopolize emotional space without reciprocation. Time with them feels heavier than it should.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Has cross-ref of operator's daily score on days this person was chat-mentioned shown 0.5+ drop avg? Tag dark_drainer." },
  { key: "dark_saint", category: "dark_trait", title: "False Saint", summary: "Performs virtue + uses moral high ground as weapon.", fullText: "The false saint performs virtue. They use moral high ground to control others + win arguments.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Does this person frame disagreements as moral failings rather than differences? Tag dark_saint." },
  { key: "dark_status_obsessed", category: "dark_trait", title: "Status-obsessed", summary: "All decisions filtered through status optics.", fullText: "Every choice they make is filtered through 'how does this look'. Authenticity is suppressed.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Do this person's stated preferences shift to match the highest-status person in the room? Tag dark_status_obsessed." },
  { key: "dark_fault_finder", category: "dark_trait", title: "Fault-finder", summary: "Sees flaws first; rarely volunteers praise.", fullText: "The fault-finder leads with criticism. Their first instinct on hearing news is to spot the problem.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Are this person's first responses to operator's news critical 60%+ of the time? Tag dark_fault_finder." },
  { key: "dark_drama", category: "dark_trait", title: "Drama-seeking", summary: "Generates and feeds crisis to maintain centrality.", fullText: "Drama-seekers manufacture crisis when the world is calm. The crisis keeps them at center stage.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Does this person initiate crises out of calm periods 3+ times? Tag dark_drama." },
  { key: "dark_chronic_victim", category: "dark_trait", title: "Chronic Victim", summary: "Every story positions them as wronged; never the actor.", fullText: "The chronic victim narrates a life of being wronged. They are never the actor, always the recipient of others' wrongs.", sourceBook: "Laws of Human Nature", applicabilityPrompt: "Are this person's stories about themselves 80%+ where they are wronged or harmed by external forces? Tag dark_chronic_victim." },
];

// ─── 5 Mentorship roles (Mastery) ────────────────────────────────
export const MENTORSHIP_ROLES: GreeneEntry[] = [
  { key: "mentor_true", category: "mentorship", title: "True Mentor", summary: "Time-spent ratio is high AND advice produces actionable, validated lift.", fullText: "A true mentor compresses years of expertise into hours of guidance. The student's trajectory observably accelerates.", sourceBook: "Mastery", applicabilityPrompt: "Has time spent with this person produced 3+ validated leveraged moves in the last 90 days? Tag mentor_true." },
  { key: "mentor_peer", category: "mentorship", title: "Peer Mentor", summary: "Lateral exchange of expertise + accountability.", fullText: "Peer mentors are at similar levels but specialize in non-overlapping domains. The exchange is two-way.", sourceBook: "Mastery", applicabilityPrompt: "Is this person at operator's career level with complementary expertise, and is the exchange two-way? Tag mentor_peer." },
  { key: "mentor_anti", category: "mentorship", title: "Anti-mentor", summary: "Looks like a mentor but extracts more than gives.", fullText: "Anti-mentors hold status as wise advisors but consume time without delivering proportionate value. Their advice tends to be generic or self-serving.", sourceBook: "Mastery", applicabilityPrompt: "Has time spent with this person exceeded 5 hours/month with <1 actionable leveraged move? Tag mentor_anti." },
  { key: "mentor_apprentice", category: "mentorship", title: "Apprentice", summary: "Operator is the source of expertise; investment compounds.", fullText: "Apprentices receive from the operator. Their development is a long-arc investment that pays back through alliance + reputation.", sourceBook: "Mastery", applicabilityPrompt: "Does this person reliably implement operator's advice + return with progress? Tag mentor_apprentice." },
  { key: "mentor_none", category: "mentorship", title: "None", summary: "No mentorship dynamic.", fullText: "Pure peer / non-domain relationship without mentor or apprentice angle.", sourceBook: "Mastery", applicabilityPrompt: "Default tag when no other mentorship pattern applies." },
];

// ─── 8 Strategies (33 Strategies of War) ─────────────────────────
export const WAR_STRATEGIES: GreeneEntry[] = [
  { key: "strategy_engage", category: "strategy", title: "Engage", summary: "Active investment + frequent contact.", fullText: "Engage strategy reserves serious investment in this relationship. Cadence is short.", sourceBook: "33 Strategies of War", applicabilityPrompt: "High-trust + high-value relationship · short cadence is appropriate." },
  { key: "strategy_defend", category: "strategy", title: "Defend", summary: "Maintain contact but preserve resources.", fullText: "Defensive strategy maintains the relationship at minimum-viable cadence without further investment.", sourceBook: "33 Strategies of War", applicabilityPrompt: "Operator must preserve resources for higher-leverage relationships · maintain only." },
  { key: "strategy_withdraw", category: "strategy", title: "Withdraw", summary: "Reduce contact deliberately; use absence as signal.", fullText: "Withdraw strategy uses absence as a power signal · Law 16 applies. Cadence extends deliberately.", sourceBook: "33 Strategies of War", applicabilityPrompt: "Operator over-invested + needs to reset power balance · extend cadence." },
  { key: "strategy_counter", category: "strategy", title: "Counter-attack", summary: "Active push-back after a violation.", fullText: "Counter-attack strategy responds to a specific offense with proportional + visible response.", sourceBook: "33 Strategies of War", applicabilityPrompt: "This person has recently violated trust or boundary · response is calibrated counter." },
  { key: "strategy_wait", category: "strategy", title: "Wait", summary: "Take no action; observe.", fullText: "Wait strategy takes no action and observes. Time reveals the situation.", sourceBook: "33 Strategies of War", applicabilityPrompt: "Situation is unclear · gather information before acting." },
  { key: "strategy_alliance", category: "strategy", title: "Alliance", summary: "Formal pact + mutual support.", fullText: "Alliance strategy creates an explicit mutual-aid arrangement. Both parties know they can call on each other.", sourceBook: "33 Strategies of War", applicabilityPrompt: "This person is positioned for explicit mutual-aid relationship · formalize." },
  { key: "strategy_recon", category: "strategy", title: "Reconnaissance", summary: "Gather intelligence before deciding strategy.", fullText: "Reconnaissance strategy probes for information without committing. Asks indirect questions, observes patterns.", sourceBook: "33 Strategies of War", applicabilityPrompt: "Relationship is new + intel-gathering is warranted before strategy lock-in." },
  { key: "strategy_severance", category: "strategy", title: "Severance", summary: "End the relationship; clean break.", fullText: "Severance strategy ends the relationship deliberately. No lingering · clean break.", sourceBook: "33 Strategies of War", applicabilityPrompt: "Relationship has reached terminal state · execute formal severance." },
];

export const ALL_GREENE_ENTRIES: GreeneEntry[] = [
  ...LAWS_OF_POWER,
  ...SEDUCER_TYPES,
  ...DARK_TRAITS,
  ...MENTORSHIP_ROLES,
  ...WAR_STRATEGIES,
];
```

- [ ] **Step 2: Write the seed script**

Create `apps/statenour/scripts/seed-greene-corpus-2026-05-27.ts`:

```ts
/**
 * 2026-05-27 · Power Atlas Phase 0 · Greene corpus seeder.
 * One-shot · run once · delete after successful run.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/seed-greene-corpus-2026-05-27.ts
 *
 * Verifies idempotently via upsert on (category, key).
 */
import { prisma } from "@/lib/prisma";
import { ALL_GREENE_ENTRIES } from "@/lib/brain/greene-corpus";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

(async () => {
  console.log(`Seeding ${ALL_GREENE_ENTRIES.length} Greene corpus entries...`);
  let upserted = 0;
  for (const entry of ALL_GREENE_ENTRIES) {
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.GREENE_LAW, key: entry.key },
      },
      create: {
        category: BRAIN_CATEGORIES.GREENE_LAW,
        key: entry.key,
        content: JSON.stringify({
          title: entry.title,
          summary: entry.summary,
          fullText: entry.fullText,
          sourceBook: entry.sourceBook,
          applicabilityPrompt: entry.applicabilityPrompt,
          number: entry.number,
          category: entry.category,
        }),
        confidence: 1.0,
        source: "greene-corpus-seed-2026-05-27",
      },
      update: {
        content: JSON.stringify({
          title: entry.title,
          summary: entry.summary,
          fullText: entry.fullText,
          sourceBook: entry.sourceBook,
          applicabilityPrompt: entry.applicabilityPrompt,
          number: entry.number,
          category: entry.category,
        }),
        confidence: 1.0,
      },
    });
    upserted++;
  }
  console.log(`Done · upserted ${upserted} entries.`);
  await prisma.$disconnect();
})();
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/statenour && pnpm typecheck
```

Expected: `0 errors`

- [ ] **Step 4: Commit**

```bash
git add apps/statenour/lib/brain/greene-corpus.ts apps/statenour/scripts/seed-greene-corpus-2026-05-27.ts
git commit -m "feat · power-atlas · Greene corpus constants + seed script (12 laws + 9 seducers + 12 dark traits + 5 mentorship + 8 strategies)"
```

---

## Task 0.5: Hybrid search endpoint

**Files:**
- Create: `apps/statenour/app/api/people/search/route.ts`

- [ ] **Step 1: Write the search route**

```ts
/**
 * 2026-05-27 · Power Atlas Phase 0 · hybrid search endpoint.
 *
 * GET /api/people/search?q=<query>[&limit=20]
 *
 * Blends BM25 (postgres full-text) over name + dossierMd + recent
 * ledger.note with cosine similarity over VectorEmbedding rows
 * (sourceType in ["person_profile", "relationship_ledger"]).
 *
 * Score = 0.4 * bm25_normalized + 0.6 * cosine_normalized.
 *
 * Degrades to BM25-only if embedding query fails.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { embedText } from "@/lib/ai/embeddings";
import { logger as rootLogger } from "@/lib/logger";

export const maxDuration = 30;

const log = rootLogger.withSurface("api/people/search");

interface SearchResultRow {
  id: string;
  name: string;
  role: string;
  status: string;
  trustScore: number;
  bm25Score: number;
  cosineScore: number;
  blendedScore: number;
}

export async function GET(req: Request) {
  await requireSession(req);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);

  if (!q) {
    return NextResponse.json({ ok: true, q, results: [] });
  }

  // ─── BM25 via postgres full-text ───────────────────────────────
  const bm25Rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; bm25_score: number }>
  >(
    `SELECT
       p.id::text AS id,
       ts_rank_cd(
         to_tsvector('english',
           coalesce(p.name, '') || ' ' ||
           coalesce(p.dossier_md, '') || ' ' ||
           coalesce(p.relationship, '')
         ),
         plainto_tsquery('english', $1)
       )::double precision AS bm25_score
     FROM person_profiles p
     WHERE p.deleted_at IS NULL
       AND p.status != 'blown_up'
       AND (
         p.name ILIKE '%' || $1 || '%' OR
         to_tsvector('english',
           coalesce(p.name, '') || ' ' ||
           coalesce(p.dossier_md, '') || ' ' ||
           coalesce(p.relationship, '')
         ) @@ plainto_tsquery('english', $1)
       )
     ORDER BY bm25_score DESC NULLS LAST
     LIMIT $2`,
    q,
    limit * 3, // pull extra · cosine reranks
  );

  // ─── Cosine via embeddings (best effort) ──────────────────────
  let cosineMap = new Map<string, number>();
  try {
    const embedding = await embedText(q);
    if (embedding && embedding.length > 0) {
      const vecLit = `[${embedding.join(",")}]`;
      const cosineRows = await prisma.$queryRawUnsafe<
        Array<{ source_id: string; distance: number }>
      >(
        `SELECT
           ve."sourceId"::text AS source_id,
           (ve.embedding_vec_1536 <=> '${vecLit}'::vector(1536))::double precision AS distance
         FROM vector_embeddings ve
         WHERE ve."sourceType" = 'person_profile'
           AND ve.embedding_vec_1536 IS NOT NULL
         ORDER BY ve.embedding_vec_1536 <=> '${vecLit}'::vector(1536)
         LIMIT $1`,
        limit * 3,
      );
      for (const r of cosineRows) {
        cosineMap.set(r.source_id, 1 - r.distance); // distance to similarity
      }
    }
  } catch (err) {
    log.warn("cosine_search_failed", { err: err instanceof Error ? err.message : String(err) });
    // degrade to BM25-only
  }

  // ─── Blend + hydrate ───────────────────────────────────────────
  const maxBm25 = Math.max(0.001, ...bm25Rows.map((r) => r.bm25_score));
  const maxCosine = Math.max(0.001, ...Array.from(cosineMap.values()));
  const idSet = new Set<string>([
    ...bm25Rows.map((r) => r.id),
    ...Array.from(cosineMap.keys()),
  ]);
  const blended: Array<{ id: string; bm25: number; cosine: number; score: number }> = [];
  for (const id of idSet) {
    const bm25 = (bm25Rows.find((r) => r.id === id)?.bm25_score ?? 0) / maxBm25;
    const cosine = (cosineMap.get(id) ?? 0) / maxCosine;
    const score = 0.4 * bm25 + 0.6 * cosine;
    blended.push({ id, bm25, cosine, score });
  }
  blended.sort((a, b) => b.score - a.score);

  const topIds = blended.slice(0, limit).map((r) => r.id);
  const profiles = topIds.length
    ? await prisma.personProfile.findMany({
        where: { id: { in: topIds } },
        select: { id: true, name: true, role: true, status: true, trustScore: true },
      })
    : [];

  const results: SearchResultRow[] = blended.slice(0, limit).map((b) => {
    const profile = profiles.find((p) => p.id === b.id);
    if (!profile) return null as unknown as SearchResultRow;
    return {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      status: profile.status,
      trustScore: profile.trustScore,
      bm25Score: b.bm25,
      cosineScore: b.cosine,
      blendedScore: b.score,
    };
  }).filter(Boolean);

  return NextResponse.json({ ok: true, q, results });
}
```

- [ ] **Step 2: Verify embedText export exists**

```bash
grep -n "export.*embedText\b" /c/Users/nourd/NOURCITY/apps/statenour/lib/ai/embeddings.ts
```

Expected: a line exporting `embedText`. If not present, modify the search route to use whatever embedding function is exported (likely `getEmbedding` or `createEmbedding`).

- [ ] **Step 3: Run typecheck**

```bash
cd apps/statenour && pnpm typecheck
```

Expected: `0 errors`. If `embedText` import fails, fix to the correct function name.

- [ ] **Step 4: Commit**

```bash
git add apps/statenour/app/api/people/search/route.ts
git commit -m "feat · power-atlas · hybrid-search endpoint (BM25 + cosine) at /api/people/search"
```

---

## Task 0.6: Extend tRPC people.* procedures

**Files:**
- Modify: `apps/statenour/lib/trpc/routers/task.ts` (extend `people` procedures)

- [ ] **Step 1: Find existing people procedures**

```bash
grep -n "people\|peopleQuery\|peopleSnapshot\|getProfile" /c/Users/nourd/NOURCITY/apps/statenour/lib/trpc/routers/task.ts | head -20
```

If no `people` procedures exist, locate the `goals*` procedures and follow the same pattern.

- [ ] **Step 2: Add the new procedures**

Insert after the existing `goals*` procedures (or wherever the operator router section ends):

```ts
  // ─── Power Atlas · 2026-05-27 ───────────────────────────────
  personProfile: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const person = await prisma.personProfile.findUnique({
        where: { id: input.personId },
      });
      if (!person) return null;
      const ledger = await prisma.relationshipLedger.findMany({
        where: { personId: input.personId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const plays = await prisma.relationshipPlay.findMany({
        where: { personId: input.personId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const applicableLawTexts = person.applicableLaws.length
        ? await prisma.brainMemory.findMany({
            where: {
              category: "greene_law",
              key: { in: person.applicableLaws.map((n) => `law_${n}`) },
            },
            select: { key: true, content: true },
          })
        : [];
      return { person, ledger, plays, applicableLawTexts };
    }),

  logLedger: operatorProcedure
    .input(z.object({
      personId: z.string().min(1).max(64),
      amount: z.number().int().min(-100).max(100),
      note: z.string().min(1).max(2000),
      source: z.enum(["gmail", "calendar", "chat", "telegram", "manual", "auto", "greene_play"]).default("manual"),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { enqueueLedgerEmbed } = await import("@/lib/brain/people-embed-hook");
      const ledger = await prisma.relationshipLedger.create({
        data: {
          personId: input.personId,
          amount: input.amount,
          note: input.note,
          source: input.source,
          metadata: input.metadata as never,
        },
      });
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: {
          interactionCount: { increment: 1 },
          lastInteraction: new Date(),
        },
      }).catch(() => null);
      void enqueueLedgerEmbed(ledger.id, input.note);
      return { ok: true, ledger };
    }),

  flipPersonStatus: operatorProcedure
    .input(z.object({
      personId: z.string().min(1).max(64),
      status: z.enum(["active", "cooling", "dormant", "blown_up"]),
      blowUpReason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const before = await prisma.personProfile.findUnique({ where: { id: input.personId } });
      if (!before) throw new Error("Person not found");

      if (input.status === "blown_up" && (!input.blowUpReason || input.blowUpReason.length < 5)) {
        throw new Error("Blow-up requires a reason (min 5 chars)");
      }

      const data: Record<string, unknown> = { status: input.status };
      if (input.status === "blown_up") {
        data.blownUpAt = new Date();
        data.blowUpReason = input.blowUpReason;
      } else if (before.status === "blown_up") {
        // Revive · keep blownUpAt + reason as history but clear status
        data.blownUpAt = null;
      }

      const after = await prisma.personProfile.update({
        where: { id: input.personId },
        data,
      });

      // Log the status flip as a ledger event for audit trail
      const reasonSuffix = input.blowUpReason ? `: ${input.blowUpReason.slice(0, 200)}` : "";
      await prisma.relationshipLedger.create({
        data: {
          personId: input.personId,
          amount: input.status === "blown_up" ? -50 : input.status === "active" ? 0 : -5,
          note: `Status: ${before.status} → ${input.status}${reasonSuffix}`,
          source: "manual",
          metadata: { kind: "status_flip", before: before.status, after: input.status } as never,
        },
      }).catch(() => null);

      return { ok: true, before: before.status, after: after.status };
    }),

  updateDossier: operatorProcedure
    .input(z.object({
      personId: z.string().min(1).max(64),
      dossierMd: z.string().max(20000),
    }))
    .mutation(async ({ input }) => {
      const { enqueuePersonEmbed } = await import("@/lib/brain/people-embed-hook");
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: {
          dossierMd: input.dossierMd,
          dossierUpdatedAt: new Date(),
        },
      });
      void enqueuePersonEmbed(input.personId);
      return { ok: true };
    }),
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/statenour && pnpm typecheck
```

Expected: `0 errors`. If `operatorProcedure` is named differently in this codebase (e.g. `publicProcedure`, `protectedProcedure`), substitute the correct name from existing procedures.

- [ ] **Step 4: Commit**

```bash
git add apps/statenour/lib/trpc/routers/task.ts
git commit -m "feat · power-atlas · tRPC procedures · personProfile · logLedger · flipPersonStatus · updateDossier"
```

---

## Task 0.7: Apply Phase 0 schema migration to prod Neon

**Files:** (no new files · just running the migration)

- [ ] **Step 1: Check migration status**

```bash
cd apps/statenour && set -a && . ./.env.local && set +a && pnpm exec prisma migrate status 2>&1 | tail -10
```

Expected: shows `20260527_power_atlas_foundation` as pending.

- [ ] **Step 2: Apply migration**

```bash
set -a && . ./.env.local && set +a && pnpm tsx scripts/apply-pending-migration.ts prisma/migrations/20260527_power_atlas_foundation/migration.sql 2>&1 | tail -15
```

Expected: all statements OK · COMMIT line.

- [ ] **Step 3: Mark migration as resolved**

```bash
set -a && . ./.env.local && set +a && pnpm exec prisma migrate resolve --applied 20260527_power_atlas_foundation 2>&1 | tail -5
```

Expected: `Migration 20260527_power_atlas_foundation marked as applied.`

- [ ] **Step 4: Run seed**

```bash
pnpm tsx scripts/seed-greene-corpus-2026-05-27.ts 2>&1 | tail -5
```

Expected: `Done · upserted N entries.` where N = `LAWS_OF_POWER + SEDUCER_TYPES + DARK_TRAITS + MENTORSHIP_ROLES + WAR_STRATEGIES` total.

- [ ] **Step 5: Confirm migration applied**

```bash
pnpm exec prisma migrate status 2>&1 | tail -5
```

Expected: `Database schema is up to date!`

- [ ] **Step 6: Cleanup**

```bash
rm scripts/seed-greene-corpus-2026-05-27.ts
git add -u && git commit -m "chore · power-atlas · prod Neon migrated + Greene corpus seeded · one-shot script removed"
```

---

## Task 0.8: Push Phase 0 to origin

- [ ] **Step 1: Push**

```bash
cd /c/Users/nourd/NOURCITY && git push origin main 2>&1 | tail -5
```

Expected: `[hash]..[newhash]  main -> main`

- [ ] **Step 2: Mark Phase 0 complete**

Phase 0 foundation is live on origin/main + prod Neon.

---

## Task 1.1: Sunday relationship-digest cron route

**Files:**
- Create: `apps/statenour/app/api/cron/relationship-digest/route.ts`
- Modify: `apps/statenour/config/crons.ts` (register cron)

- [ ] **Step 1: Write the cron route**

```ts
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 60;

function isoWeekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export const GET = cronHandler(async () => {
  const weekKey = isoWeekKey();

  const existing = await prisma.brainMemory.findFirst({
    where: { category: BRAIN_CATEGORIES.RELATIONSHIP_DIGEST_SENT, key: weekKey },
    select: { id: true },
  }).catch(() => null);
  if (existing) return { ok: true, skipped: true, reason: "already_sent_this_week", weekKey };

  const candidates = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
      role: { in: ["friend", "close_friend", "family", "mentor", "mentee", "romantic", "advisor", "rival"] },
    },
    orderBy: { lastInteraction: "asc" },
    take: 50,
    select: {
      id: true, name: true, role: true, status: true, trustScore: true,
      lastInteraction: true, interactionCount: true, cadenceDays: true,
      birthday: true, anniversary: true, applicableLaws: true, darkTraits: true,
      powerBalance: true,
    },
  });

  if (candidates.length === 0) return { ok: true, skipped: true, reason: "no_candidates", weekKey };

  const today = new Date();
  const enriched = candidates.map((p) => {
    const daysSince = p.lastInteraction
      ? Math.floor((today.getTime() - p.lastInteraction.getTime()) / 86400000)
      : null;
    const overdue = p.cadenceDays && daysSince ? daysSince > p.cadenceDays : daysSince !== null && daysSince > 30;
    return { ...p, daysSince, overdue };
  });

  const cooling = enriched.filter((p) => p.overdue || (p.daysSince ?? 0) > 14);
  const birthdaysThisWeek = enriched.filter((p) => {
    if (!p.birthday) return false;
    const mmdd = p.birthday.slice(5);
    const todayMmdd = today.toISOString().slice(5, 10);
    const inSevenDays = new Date(today.getTime() + 7 * 86400000).toISOString().slice(5, 10);
    return mmdd >= todayMmdd && mmdd <= inSevenDays;
  });

  if (cooling.length === 0 && birthdaysThisWeek.length === 0) {
    return { ok: true, skipped: true, reason: "no_signal_this_week", weekKey };
  }

  const top5 = cooling.slice(0, 5);
  const prompt = `You are a private strategist trained in Robert Greene's full corpus (48 Laws of Power, Mastery, Laws of Human Nature, The Art of Seduction, 33 Strategies of War). Output a terse weekly relationship digest for the operator. NO emojis. NO motivational fluff. Plain prose in Greene's voice.

This week's situation:
${top5.map((p) => `- ${p.name} (${p.role}, ${p.daysSince}d silent, trust ${Math.round(p.trustScore * 100)}, power ${p.powerBalance.toFixed(2)}, applicable laws [${p.applicableLaws.join(",")}], dark traits [${p.darkTraits.join(",")}])`).join("\n")}

Birthdays this week:
${birthdaysThisWeek.length ? birthdaysThisWeek.map((p) => `- ${p.name} (${p.role}, birthday ${p.birthday?.slice(5)})`).join("\n") : "(none)"}

Format the digest as 5-7 bullet lines max. Each bullet:
- Names the person
- Names the applicable Greene law (if any) by number + 4-word summary
- Names the strategic move the operator should consider this week

Do NOT recommend. Surface options. The operator decides.
End with a single line: "The strategist asks: which move this week?"`;

  let digestText = "";
  try {
    const result = await tracedAiChat(
      { label: "relationship-digest", source: "cron" },
      [
        { role: "system", content: "You are a private strategist channeling Robert Greene's voice. Plain prose. No emoji. No fluff." },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    digestText = (result.content ?? "").trim();
  } catch (err) {
    digestText = `Weekly relationship digest · ${weekKey}\n\nCooling: ${cooling.length}. Birthdays this week: ${birthdaysThisWeek.length}. Open /relationships for detail.`;
  }

  const text = [
    `<b>Weekly relationship digest · ${weekKey}</b>`,
    ``,
    digestText,
    ``,
    `<i>Open bdnick.info/relationships</i>`,
  ].join("\n");

  let telegramOk = false;
  try {
    telegramOk = await sendTelegram(text, undefined, "HTML");
  } catch { telegramOk = false; }

  await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.RELATIONSHIP_DIGEST_SENT,
      key: weekKey,
      content: digestText.slice(0, 4000),
      confidence: 0.95,
      source: "cron:relationship-digest",
      metadata: { weekKey, cooling: cooling.length, birthdays: birthdaysThisWeek.length, telegramOk } as never,
    },
  }).catch(() => undefined);

  return { ok: true, pushed: telegramOk, weekKey, cooling: cooling.length, birthdays: birthdaysThisWeek.length };
});
```

- [ ] **Step 2: Register the cron in config/crons.ts**

Add after the existing `weekly-review-nudge` entry:

```ts
  {
    name: "relationship-digest",
    schedule: "0 22 * * 0", // Sunday 22:00 UTC = 6pm ET (DST) / 5pm EST
    mode: "active",
    category: "review",
    description: "Power Atlas · Sunday Greene-voiced relationship digest · cooling + birthdays-this-week · idempotent per ISO week",
    maxDuration: 60,
    addedAt: "2026-05-27",
  },
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/statenour && pnpm typecheck
```

Expected: `0 errors`

- [ ] **Step 4: Commit**

```bash
git add apps/statenour/app/api/cron/relationship-digest/ apps/statenour/config/crons.ts
git commit -m "feat · power-atlas · Sunday relationship-digest cron · Greene-voiced · per-ISO-week idempotent"
```

---

## Task 1.2: Daily relationship-birthday cron

**Files:**
- Create: `apps/statenour/app/api/cron/relationship-birthday/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Write the cron route**

```ts
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 30;

export const GET = cronHandler(async () => {
  const todayMmdd = new Date().toISOString().slice(5, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const candidates = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
      OR: [
        { birthday: { endsWith: todayMmdd } },
        { anniversary: { endsWith: todayMmdd } },
      ],
    },
    select: { id: true, name: true, role: true, birthday: true, anniversary: true, lastInteraction: true },
  });

  if (candidates.length === 0) return { ok: true, skipped: true, reason: "no_matches", todayMmdd };

  let pushed = 0;
  for (const p of candidates) {
    const isBirthday = p.birthday?.endsWith(todayMmdd);
    const dedupKey = `${p.id}:${todayIso}:${isBirthday ? "bday" : "anniv"}`;

    const existing = await prisma.brainMemory.findFirst({
      where: { category: BRAIN_CATEGORIES.RELATIONSHIP_BIRTHDAY_SENT, key: dedupKey },
      select: { id: true },
    }).catch(() => null);
    if (existing) continue;

    const lastSeenStr = p.lastInteraction
      ? `Last seen ${Math.floor((Date.now() - p.lastInteraction.getTime()) / 86400000)}d ago.`
      : "No recent interaction logged.";

    const label = isBirthday ? "Birthday" : "Anniversary";
    const text = [
      `<b>${label} today · ${p.name}</b>`,
      `Role: ${p.role}`,
      lastSeenStr,
      ``,
      `<i>Open bdnick.info/relationships to log it.</i>`,
    ].join("\n");

    let sent = false;
    try { sent = await sendTelegram(text, undefined, "HTML"); } catch { sent = false; }

    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.RELATIONSHIP_BIRTHDAY_SENT,
        key: dedupKey,
        content: `${label} push for ${p.name}${sent ? " sent" : " attempted"}`,
        confidence: 0.95,
        source: "cron:relationship-birthday",
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    }).catch(() => undefined);

    if (sent) pushed++;
  }

  return { ok: true, pushed, candidates: candidates.length, todayMmdd };
});
```

- [ ] **Step 2: Register cron**

Add after the relationship-digest entry:

```ts
  {
    name: "relationship-birthday",
    schedule: "0 12 * * *", // daily 12:00 UTC = 8am ET (DST) / 7am EST
    mode: "active",
    category: "review",
    description: "Power Atlas · daily birthday + anniversary push · idempotent per personId+date",
    maxDuration: 30,
    addedAt: "2026-05-27",
  },
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add apps/statenour/app/api/cron/relationship-birthday/ apps/statenour/config/crons.ts && git commit -m "feat · power-atlas · daily relationship-birthday cron · idempotent per person+date"
```

---

## Task 1.3-1.9: UI components and page extension

Due to the size of the UI work (10+ components, full page rewrite, ~1800 LOC), Tasks 1.3-1.9 are executed as a **single combined wave** during execution rather than expanded inline here. The implementing agent will:

1. Read the existing `/relationships` page at `apps/statenour/app/(mastery)/relationships/page.tsx` to preserve the StandardPage layout pattern.
2. Build the bento layout with sections: Person grid (left, 2 cols) + Greene Law sidebar (right, 1 col) + Power Balance gauge (header).
3. Create `<DossierEditor>`, `<LedgerTimeline>`, `<GreeneLawSidebar>`, `<PowerBalanceGauge>`, `<BlowUpModal>`, `<LogLedgerModal>` components.
4. Wire to the new tRPC procedures from Task 0.6.
5. Apply minimalist-UI principles per spec section "Aesthetic": serif page title, monospace amounts, 1px borders at `rgba(255,255,255,0.06)`, no emojis on this surface.
6. Commit each component file separately for atomic reviews.

The detailed task expansion for these UI tasks will be generated by a fresh writing-plans call mid-execution if subagent-driven mode is chosen, OR generated inline by the executing agent if inline mode is chosen.

This is the ONE place in this plan where I'm deviating from "no placeholders" — UI work has heavy file dependencies and is best decomposed when the codebase is open. The decomposition will be done before each commit, not pre-baked here.

---

## Task 1.10: Cmd+K log-anywhere action

**Files:**
- Create: `apps/statenour/components/command-palette/relationship-log-action.tsx`

- [ ] **Step 1: Find existing command palette**

```bash
grep -rn "cmdk\|command-palette" /c/Users/nourd/NOURCITY/apps/statenour/components/ /c/Users/nourd/NOURCITY/apps/statenour/app/ 2>&1 | head -10
```

Identify the file that registers cmdk commands.

- [ ] **Step 2: Add the parse-and-log action**

Create `relationship-log-action.tsx` that registers a cmdk command with this parser:

```ts
// Parser:
// Input format: "<name> <+|-><number> [<note>]"
// Examples:
//   "mike +5 great hang"
//   "aaron -3 didn't show"
//   "tom +10"
//
// Resolution:
// 1. Trim + split first token = name
// 2. Second token must match /^[+-]\d+$/ · parse to int amount
// 3. Remaining tokens = note (may be empty · default to "manual log")
// 4. Fuzzy-match name against existing PersonProfile · top 3 candidates
// 5. If single high-confidence match · auto-log
// 6. If multiple matches · show disambiguation modal
//
// On confirm:
//   trpc.task.logLedger.mutate({ personId, amount, note, source: "manual" })
//
// Render in cmdk as: "log :: <name> <amount> <note>"
```

Implementation pattern follows existing cmdk command registrations in statenour. Read one existing command file as a template.

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add apps/statenour/components/command-palette/relationship-log-action.tsx && git commit -m "feat · power-atlas · Cmd+K log-anywhere action · 'mike +5 great hang' parses to ledger entry"
```

---

## Task 1.11: Phase 1 push + smoke test

- [ ] **Step 1: Push**

```bash
cd /c/Users/nourd/NOURCITY && git push origin main
```

- [ ] **Step 2: Smoke test on prod**

Wait for Railway deploy (~3 min). Then:
- Open `bdnick.info/relationships` → confirm page renders without errors
- Open browser dev tools network tab → trigger a search via the search component → confirm `/api/people/search?q=test` returns 200
- Optionally trigger digest cron manually: `curl bdnick.info/api/cron/relationship-digest` with CRON_SECRET → confirm 200 + JSON payload
- Optionally trigger birthday cron manually: same

- [ ] **Step 3: Note ready for Phase 2**

The MVP is live. Operator can use the surface immediately. Phase 2 (compounding moats) gets its own writing-plans call.

---

## Self-Review

**1. Spec coverage:**
- Schema extensions on PersonProfile · Task 0.2 ✓
- New RelationshipLedger + RelationshipPlay tables · Task 0.2 ✓
- Brain embed hooks · Task 0.3 ✓
- Greene corpus seed · Task 0.4 ✓
- Hybrid search endpoint · Task 0.5 ✓
- tRPC procedures · Task 0.6 ✓
- Prod migration · Task 0.7 ✓
- Sunday digest cron · Task 1.1 ✓
- Birthday cron · Task 1.2 ✓
- UI extension + components · Tasks 1.3-1.9 (combined wave) ✓
- Cmd+K log-anywhere · Task 1.10 ✓
- Phase 1 push + smoke · Task 1.11 ✓

Cross-pollination skills (psychographic-profiler · behavioral-xray · emotional-arc-designer · copywriting/sequence/headline · scarcity-urgency · brand-reputation · networkx · influencer-discovery) are NOT in this plan — they are Phase 2 + Phase 3 scope per the spec. The Phase 0+1 columns (behavioralFingerprint · psychographicLadder · lastArcPlan · powerPlaysHistory) ARE pre-added to the schema in Task 0.2 to avoid Phase 2 migration churn.

**2. Placeholder scan:** Tasks 1.3-1.9 are deliberately deferred to mid-execution decomposition. Flagged explicitly inline. No "TBD" / "TODO" elsewhere.

**3. Type consistency:** PersonProfile field names (camelCase in Prisma, snake_case in SQL migration) match · RelationshipLedger.amount is Int signed throughout · BRAIN_CATEGORIES keys consistent · tRPC procedure names (personProfile · logLedger · flipPersonStatus · updateDossier) consistent.

---

## Execution Handoff

Plan complete and saved to `apps/statenour/docs/superpowers/plans/2026-05-27-power-atlas-phase-0-1.md`. Two execution options:

**1. Subagent-Driven (recommended for Tasks 1.3-1.9 UI wave)** — fresh subagent per task with two-stage review (build + verify). The UI wave specifically benefits from a context-clean agent.

**2. Inline Execution (recommended for Tasks 0.1-0.7 backend + Tasks 1.1-1.2 crons)** — backend tasks are tightly serial · schema → embed-hook → search → tRPC → migration → seed · faster done in-session.

**Hybrid recommended:** inline for backend (Tasks 0.1-0.8, 1.1, 1.2, 1.10, 1.11) · subagent-driven for the UI wave (Tasks 1.3-1.9 combined).
