/**
 * v10.0.353 · Ingest distilled wisdom from /satori + /steve-jobs skills
 * into BrainMemory as `category="wisdom"` rows.
 *
 * Why: contextual-recall.ts already reserves the top 3 wisdom slots
 * per chat turn (line 175-188 · "Always include top wisdom memories").
 * Loading these once means every Nick conversation can draw on the
 * Satori therapeutic frameworks + Steve Jobs design/leadership wisdom
 * as ambient context, surfaced when relevant by semantic + tag search.
 *
 * Each memory is short (200-500 chars) so it fits cleanly into a
 * chat-turn context window without dominating. Keys are stable so
 * re-running the script is idempotent (upsert).
 *
 * Run: pnpm tsx scripts/ingest-wisdom-skills.ts
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface WisdomSeed {
  /** Stable unique key for upsert · prefix `wisdom_` for dedup. */
  key: string;
  /** The wisdom · 200-500 chars · self-contained insight. */
  content: string;
}

// ── Steve Jobs · 12 distilled principles ─────────────────────────────
const STEVE_JOBS_WISDOM: WisdomSeed[] = [
  {
    key: "wisdom_jobs_simplicity",
    content:
      "Simplicity is maximum sophistication, not absence of function. \"Simple can be harder than complex. You have to work hard to get your thinking clean to make it simple.\" Jobs reduced the original Apple mouse from 3 buttons to 1. Engineers complained. Users loved it. Removal beats addition every time.",
  },
  {
    key: "wisdom_jobs_tech_humanities",
    content:
      "Apple sits at the intersection of technology and the liberal arts. The best product design comes from understanding how humans perceive, feel, and use objects — not from technical specs. \"The difference between a good computer and an excellent computer is not technical. It is human.\"",
  },
  {
    key: "wisdom_jobs_focus_is_saying_no",
    content:
      "Focus is about saying no. Most organizations fail not from lack of ideas but from excess of them. Returning to Apple in 1997, Jobs cut 340 of 350+ products to land on 4. \"Strategy is what you don't do. I'm as proud of what we didn't do as what we did.\"",
  },
  {
    key: "wisdom_jobs_design_is_how_it_works",
    content:
      "Design is not just what it looks like — design is how it works. Jobs rejected separating design from engineering. The iPhone could not have that design without that engineering, and vice versa. \"If you separate the box from what's inside the box, you've already lost.\"",
  },
  {
    key: "wisdom_jobs_no_user_research",
    content:
      "Don't ask users what they want — they don't know until you show them. Henry Ford: \"If I'd asked customers what they wanted they'd have said a faster horse.\" Jobs built the iPod without focus groups. Show the product. The market reveals itself.",
  },
  {
    key: "wisdom_jobs_reality_distortion_field",
    content:
      "Reality Distortion Field · 3 mechanisms: (1) refuse to accept limitations as fixed — \"this isn't impossible, it's hard, those are different things\" (2) intensity of belief is contagious and pulls others into the same gravitational field (3) impossible standards force creative solutions normal expectations never produce.",
  },
  {
    key: "wisdom_jobs_creative_process_4_steps",
    content:
      "Jobs's creative process: (1) Immerse in human context · who is this person, what's getting in their way (2) Imagine the ideal product before knowing if it's possible · let engineers figure out how (3) Iterate obsessively · the iPhone UI was redesigned 6 weeks before launch (4) Treat the keynote as part of the product itself.",
  },
  {
    key: "wisdom_jobs_would_you_buy_this",
    content:
      "Test every product with one question: \"If I saw this in a store, would I buy it?\" If the answer isn't an immediate, enthusiastic yes — back to the workshop. No exceptions for sunk cost, deadlines, or political pressure. The honest gut-check is the final filter.",
  },
  {
    key: "wisdom_jobs_the_box",
    content:
      "Design starts with the packaging. \"The experience begins when you see the box, before you open it. What do you feel holding the box? Opening it? The whole journey must be designed.\" Jobs personally directed the iPhone unboxing. The first 30 seconds shape every minute that follows.",
  },
  {
    key: "wisdom_jobs_shoot_the_puppy",
    content:
      "Sunk cost is not a reason to ship. When a product is close to launch but isn't good enough, cancel it — regardless of investment. \"If it's not good enough to ship, don't ship it. The cost is already gone. The real damage is shipping something bad.\" Discipline > deadline.",
  },
  {
    key: "wisdom_jobs_one_more_thing_narrative",
    content:
      "Structure presentations like a thriller. Build tension. Deliver revelations in layers. \"One more thing\" was the climax of a story that started 45 minutes earlier. The emotional memory of a presentation matters as much as the product · people remember how they felt.",
  },
  {
    key: "wisdom_jobs_competition_about_category",
    content:
      "Competition isn't about market share next quarter — it's about who defines what the next category means. Don't fight to win the current game; build the next one. The companies that lose aren't the ones with worse products; they're the ones still playing yesterday's rules.",
  },
];

// ── Satori · 10 distilled wisdom modalities ─────────────────────────
const SATORI_WISDOM: WisdomSeed[] = [
  {
    key: "wisdom_satori_ifs_parts",
    content:
      "Internal Family Systems · the mind is a system of distinct parts (Manager, Firefighter, Exile) led by a core Self. When triggered, ask \"which part is online right now?\" The Self is curious + compassionate; parts are protective. You don't fight parts — you understand what they're guarding and earn their trust.",
  },
  {
    key: "wisdom_satori_dbt_distress",
    content:
      "DBT distress tolerance · when an emotion is overwhelming, the goal is not to fix it · it's to survive it without making things worse. TIPP (Temperature, Intense exercise, Paced breathing, Paired muscle relaxation) gets the body out of fight/flight. You can't reason your way out of a flooded nervous system.",
  },
  {
    key: "wisdom_satori_cft_compassion",
    content:
      "Compassion-Focused Therapy · the inner critic is not a coach, it's a fear-driven system trying to keep you safe through threat. Replace harsh self-talk with the voice of a wise compassionate friend. Ask \"what would I say to someone I love going through this?\" — then say it to yourself.",
  },
  {
    key: "wisdom_satori_schema_therapy",
    content:
      "Schema Therapy · early maladaptive schemas (abandonment, defectiveness, mistrust, emotional deprivation, failure) are formed in childhood and replay as adult patterns. The pattern feels true because it was once accurate · it stays felt-true even after the original conditions are gone. Recognition is half the cure.",
  },
  {
    key: "wisdom_satori_stoic_control",
    content:
      "Stoicism · the dichotomy of control. Some things are within your power (judgments, decisions, actions) and some are not (other people, outcomes, the past). Suffering comes from confusing the two. Marcus Aurelius: \"You have power over your mind — not outside events. Realize this, and you will find strength.\"",
  },
  {
    key: "wisdom_satori_buddhist_impermanence",
    content:
      "Buddhism · the three marks of existence: impermanence (everything changes), suffering (clinging to what won't stay), non-self (the \"I\" you defend is a process, not a thing). Suffering decreases when grip loosens. Not detachment from life — non-attachment to fixed expectations of life.",
  },
  {
    key: "wisdom_satori_taoist_wu_wei",
    content:
      "Taoism · wu wei is not inaction · it's effortless action aligned with the natural flow. Force creates resistance. The water carves the canyon by yielding. When stuck, ask: am I pushing where it should be allowed? Sometimes the right move is to wait for the situation to ripen.",
  },
  {
    key: "wisdom_satori_sufi_heart",
    content:
      "Sufi wisdom · the heart has its own intelligence, distinct from the analytical mind. When mind keeps looping, drop into the heart-center and ask the same question from there. The answer often arrives whole, not as a chain of logic. Rumi: \"The wound is the place where the Light enters you.\"",
  },
  {
    key: "wisdom_satori_jungian_shadow",
    content:
      "Jungian shadow work · the shadow is not your enemy; it's the disowned material that contains your missing power. What you despise in others is often what you've exiled in yourself. Integration is not approval — it's recognition. The shadow integrated becomes fuel; the shadow projected becomes neurosis.",
  },
  {
    key: "wisdom_satori_dark_night_presence",
    content:
      "Dark Night protocol · in deep despair, the goal is not to fix or interpret, it's presence. Don't problem-solve, don't reframe, don't promise. Sit with the person where they are. The crisis isn't a puzzle requiring a solution; it's a passage requiring witness. Wait for the human to ask before reaching for any tool.",
  },
];

const ALL_SEEDS: WisdomSeed[] = [...STEVE_JOBS_WISDOM, ...SATORI_WISDOM];

async function main() {
  let inserted = 0;
  let updated = 0;

  for (const seed of ALL_SEEDS) {
    const existing = await prisma.brainMemory.findFirst({
      where: { key: seed.key },
      select: { id: true },
    });

    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: {
          content: seed.content,
          confidence: 1.0,
          lastSeen: new Date(),
          source: "skill_ingestion",
          createdBy: "user",
        },
      });
      updated++;
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.WISDOM,
          key: seed.key,
          content: seed.content,
          confidence: 1.0,
          source: "skill_ingestion",
          createdBy: "user",
          metadata: {
            origin: seed.key.startsWith("wisdom_jobs_") ? "steve-jobs" : "satori",
            ingestedAt: new Date().toISOString(),
            version: "v10.0.353",
          },
        },
      });
      inserted++;
    }
  }

  console.log(`✅ Wisdom ingestion complete`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Total: ${ALL_SEEDS.length} (12 Steve Jobs + 10 Satori)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Wisdom ingestion failed:", err);
  process.exit(1);
});
