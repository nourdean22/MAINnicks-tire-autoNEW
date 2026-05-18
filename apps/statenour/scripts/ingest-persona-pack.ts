/**
 * v10.0.365 · Persona pack · Buffett + Gates + Musk
 *
 * Three more wisdom intelligences to layer alongside the existing
 * Steve Jobs (12) + Satori (10) wisdoms (v10.0.353). Each persona
 * brings a distinct mental model · together they form Munger's
 * "latticework of mental models" · diverse perspectives Nick can
 * channel by question type.
 *
 * - Warren Buffett · capital allocation, value investing, long-term thinking
 * - Bill Gates    · strategy at scale, systems thinking, distribution
 * - Elon Musk     · first-principles physics, deletion-first design
 *
 * Same shape as the v10.0.353 ingestion · idempotent via stable keys.
 *
 * Run: pnpm tsx scripts/ingest-persona-pack.ts
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface WisdomSeed {
  key: string;
  content: string;
  origin: string;
}

// ── Warren Buffett · 10 principles ──────────────────────────────────
const BUFFETT_WISDOM: WisdomSeed[] = [
  {
    key: "wisdom_buffett_circle_of_competence",
    origin: "warren-buffett",
    content:
      "Stay inside your circle of competence. The size of the circle isn't important · what matters is knowing exactly where the edge is. \"Risk comes from not knowing what you're doing.\" When a question is outside your edge, the only smart move is to skip it · not to guess.",
  },
  {
    key: "wisdom_buffett_margin_of_safety",
    origin: "warren-buffett",
    content:
      "Always demand a margin of safety. Don't buy at the price you think it's worth · buy at the price where you'd still win if half your assumptions are wrong. Applies beyond stocks: hire with margin, commit with margin, plan with margin. The future never matches the spreadsheet.",
  },
  {
    key: "wisdom_buffett_compound_relentlessly",
    origin: "warren-buffett",
    content:
      "Compound interest is the most powerful force on the planet because most people live in the noise of weeks instead of the rhythm of decades. \"My wealth has come from a combination of living in America, some lucky genes, and compound interest.\" The first $100k is the hardest. After that, the snowball does the work.",
  },
  {
    key: "wisdom_buffett_be_fearful_when_greedy",
    origin: "warren-buffett",
    content:
      "Be fearful when others are greedy and greedy when others are fearful. Crowds get the trend right but the timing wrong · they buy at the top because everyone else is, sell at the bottom because everyone is. Independent thinking compounds. \"You can't get rich agreeing with the consensus.\"",
  },
  {
    key: "wisdom_buffett_no_called_strikes",
    origin: "warren-buffett",
    content:
      "In life, no one calls strikes on you. You can stand at the plate all day waiting for the perfect pitch and the umpire never says \"strike one\". The error is swinging at every pitch · not waiting too long. \"The trick is to wait for the right opportunity to swing\" · for businesses, hires, and bets alike.",
  },
  {
    key: "wisdom_buffett_economic_moats",
    origin: "warren-buffett",
    content:
      "The best businesses have economic moats · structural advantages competitors can't replicate cheaply. Brand (Coca-Cola), network effect (Visa), low-cost operator (GEICO), regulatory (utilities). Without a moat, every margin gets competed away. Build a moat or be a tourist.",
  },
  {
    key: "wisdom_buffett_owners_manual",
    origin: "warren-buffett",
    content:
      "Treat every business decision like you're writing the owner's manual. \"What would I want to know if I were buying this whole company?\" Forces honesty about: what does it actually earn, what's the moat, who runs it, what could kill it. Read your own businesses through this lens monthly.",
  },
  {
    key: "wisdom_buffett_long_term_holding",
    origin: "warren-buffett",
    content:
      "Our favorite holding period is forever. If you wouldn't hold a position for 10 years, don't hold it for 10 minutes. Frequent trading is just paying the brokerage and tax man to interrupt your compounding. Decisions made on quarterly horizons rot decisions meant for decades.",
  },
  {
    key: "wisdom_buffett_simplicity_over_complexity",
    origin: "warren-buffett",
    content:
      "We've never invested in a business we couldn't explain to a 12-year-old. If the model needs a 100-page deck and an MBA to grasp, the people running it probably don't grasp it either. Complexity is often a hiding place for risk. \"There's seldom just one cockroach in the kitchen.\"",
  },
  {
    key: "wisdom_buffett_reputation_takes_decades",
    origin: "warren-buffett",
    content:
      "It takes 20 years to build a reputation and 5 minutes to ruin it. Behave as if every action you take will be reported on the front page of the local paper, written by an unfriendly but smart reporter. The asymmetry between earning trust and losing it should govern every decision involving customers, employees, or partners.",
  },
];

// ── Bill Gates · 10 principles ──────────────────────────────────────
const GATES_WISDOM: WisdomSeed[] = [
  {
    key: "wisdom_gates_overestimate_year_underestimate_decade",
    origin: "bill-gates",
    content:
      "We always overestimate the change that will occur in the next two years and underestimate the change that will occur in the next ten. Don't let yourself be lulled into inaction by short-term lack of progress. Decades are where the compound effects show up · your job is to keep the input rate steady so the output rate eventually does too.",
  },
  {
    key: "wisdom_gates_software_takes_over",
    origin: "bill-gates",
    content:
      "Software-defined systems eat industries one at a time. The pattern: a thing that was hardware becomes a service, a service becomes an app, an app becomes an API, an API becomes a default. The shop's CRM, scheduling, inventory, communications · each is on a march toward becoming software-mediated. Build with that direction in mind.",
  },
  {
    key: "wisdom_gates_unhappy_customers",
    origin: "bill-gates",
    content:
      "Your most unhappy customers are your greatest source of learning. Complaints concentrate signal · the systems you spent years building have a hole the customer just pointed at. Treat the loudest unhappy voice as a free user-research session, not a problem to make go away.",
  },
  {
    key: "wisdom_gates_distribution_eats_innovation",
    origin: "bill-gates",
    content:
      "Distribution beats innovation more often than innovators want to admit. Microsoft didn't invent most of what made it · IBM did, Xerox PARC did, Netscape did. What Microsoft had was reach. Operator translation: the second-best product with the best distribution wins. Build the channel before you optimize the product.",
  },
  {
    key: "wisdom_gates_systems_thinking",
    origin: "bill-gates",
    content:
      "Solve at the system level, not the symptom level. Malaria isn't a sick-people problem, it's a mosquito-and-stagnant-water problem. Tire-shop slow-day isn't a marketing problem, it's a customer-flow-and-conversion problem. Find the upstream lever; pulling it changes 10 symptoms at once.",
  },
  {
    key: "wisdom_gates_smart_smart_lazy_smart_lazy",
    origin: "bill-gates",
    content:
      "I'll always choose a lazy person to do a hard job · because a lazy person will find an easy way to do it. The right hire for a repetitive task is the person who will be most annoyed by having to do it manually · they'll automate it within a week.",
  },
  {
    key: "wisdom_gates_data_over_intuition_at_scale",
    origin: "bill-gates",
    content:
      "Intuition scales until it doesn't. At 10 customers you can hold the truth in your head; at 1,000 you need data. The transition kills most operators · they keep trusting their gut after the gut has lost its information edge. Set up the dashboards BEFORE you need them, because you only realize you needed them after you missed the signal.",
  },
  {
    key: "wisdom_gates_treat_every_year_as_chapter",
    origin: "bill-gates",
    content:
      "Treat each year as a chapter, not a continuation. Sit down at the start, ask: what's the one thing that, if true at the end, would make this year a success? Most years end with a vague sense of busy · a chapter with a thesis ends with something specific you either did or didn't.",
  },
  {
    key: "wisdom_gates_two_pillars_of_adoption",
    origin: "bill-gates",
    content:
      "Adoption requires two pillars: VALUE > effort, AND inertia broken. People don't switch from broken-but-familiar to better-but-new without an explicit nudge. Your customer keeps going to the wrong tire shop because switching is friction. Your job isn't to be 10% better · it's to be obviously better AND to remove the friction of changing.",
  },
  {
    key: "wisdom_gates_meeting_with_oneself",
    origin: "bill-gates",
    content:
      "I take a 'think week' twice a year · alone, no calls, just reading and writing strategy notes. The decisions made in that week shape the next 6 months more than the meetings in those 6 months. Reserve the time on the calendar before you reserve anything else · everything else is reactive.",
  },
];

// ── Elon Musk · 10 principles ───────────────────────────────────────
const MUSK_WISDOM: WisdomSeed[] = [
  {
    key: "wisdom_musk_first_principles",
    origin: "elon-musk",
    content:
      "Reason from first principles, not by analogy. Boil the problem down to its fundamental physical/economic constraints · what does the law of physics say has to be true? What does the cost of materials say has to be true? Then build up from there. Most people reason by analogy: 'this is how it's always been done.' First-principles users beat analogy users on hard problems every time.",
  },
  {
    key: "wisdom_musk_question_every_requirement",
    origin: "elon-musk",
    content:
      "Make your requirements less dumb. Every requirement someone hands you came from a person, and that person was wrong about something. The most common error is keeping requirements that no longer apply. Step 1 of every engineering process: question the requirement. If you don't end up adding 10% of removed requirements back later, you didn't delete enough.",
  },
  {
    key: "wisdom_musk_delete_the_part",
    origin: "elon-musk",
    content:
      "The best part is no part. The best process is no process. Every part you delete eliminates a failure mode, a cost line, a manufacturing step, a place for a defect to hide. If you're not occasionally adding parts back, you're not deleting aggressively enough · it's a sign of optimization done right.",
  },
  {
    key: "wisdom_musk_simplify_then_optimize",
    origin: "elon-musk",
    content:
      "The 5-step engineering process: (1) Make your requirements less dumb (2) Delete the part or process (3) Simplify or optimize · only AFTER deleting (4) Accelerate cycle time (5) Automate. The most common error is doing steps 3-5 first · you end up with a beautifully optimized version of the wrong system.",
  },
  {
    key: "wisdom_musk_idiot_index",
    origin: "elon-musk",
    content:
      "Calculate the idiot index for every part: cost of finished part / cost of raw materials. If the index is high (10x+) it's a giant signal · either the manufacturing process is wrong or the supplier is gouging. Apply to every line item: tire prices, labor rates, software subscriptions. High index = leverage point hidden in plain sight.",
  },
  {
    key: "wisdom_musk_signal_through_noise",
    origin: "elon-musk",
    content:
      "The signal-to-noise ratio in any communication channel decays over time as humans optimize the channel for status games. Email: 90% noise. Most meetings: 95% noise. Your job is to find the few channels with high signal density (technical reviews, prototype demos, hard-data dashboards) and prune the rest brutally.",
  },
  {
    key: "wisdom_musk_iterate_in_public",
    origin: "elon-musk",
    content:
      "Ship the v0 ugly version. The market will tell you what's wrong faster than any internal review. Tesla shipped a roadster that broke down. SpaceX shipped rockets that exploded. The exposure to real conditions is the only test that matters. The cost of a bad-but-shipped product is much smaller than the cost of a perfect-but-unshipped one.",
  },
  {
    key: "wisdom_musk_work_compounds_when_aimed",
    origin: "elon-musk",
    content:
      "If you're working 80 hours a week on the wrong thing, you're worse off than someone working 30 on the right thing. Aim before effort. The most expensive form of work is work spent on the wrong target · because it FEELS like progress. Audit the target before audit the hours.",
  },
  {
    key: "wisdom_musk_stack_rank_problems",
    origin: "elon-musk",
    content:
      "On any team there are exactly two important questions: what's the biggest problem we face right now, and what are we doing about it? Everything else is theater. Answer both questions out loud, every day, in writing. If the answer to (1) keeps changing, you're chasing fires; if it stays the same for weeks, you're avoiding it.",
  },
  {
    key: "wisdom_musk_failure_is_an_option",
    origin: "elon-musk",
    content:
      "Failure is an option here. If things are not failing, you're not innovating enough. Every failure-free month means you're playing inside known territory · the second-best place to be after \"failing on the way to a real frontier\". The aim is intelligent failure with low blast radius, not zero failure.",
  },
];

const ALL_SEEDS: WisdomSeed[] = [
  ...BUFFETT_WISDOM,
  ...GATES_WISDOM,
  ...MUSK_WISDOM,
];

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
            origin: seed.origin,
            ingestedAt: new Date().toISOString(),
            version: "v10.0.365",
          },
        },
      });
      inserted++;
    }
  }

  console.log(`✅ Persona pack ingestion complete`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Total: ${ALL_SEEDS.length} (10 Buffett + 10 Gates + 10 Musk)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Persona pack ingestion failed:", err);
  process.exit(1);
});
