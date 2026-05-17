import type { PrismaClient } from "@prisma/client";

export async function seedMastery(prisma: PrismaClient) {
  const laws = [
    {
      book: "MASTERY" as const,
      number: 1,
      title: "Discover Your Calling",
      shortTitle: "Life's Task",
      essence:
        "Everyone has a unique inclination — a deep calling that emerges in childhood and persists throughout life. Mastery begins with identifying this calling and structuring your entire life around it. Ignoring it leads to chronic dissatisfaction; following it creates limitless energy and focus.",
      shopApplication:
        "Nick's Tire & Auto is not a random business — it is the vehicle for building something from scratch, mastering operations, and proving self-reliance. If the shop ever feels like 'just a job,' reconnect to why it was chosen: financial sovereignty, community impact, and the challenge of building a business in your twenties. Every task at the shop — from tire rotations to marketing campaigns — serves the larger calling of entrepreneurial mastery.",
      nourApplication:
        "Your calling sits at the intersection of technology, business, and systems thinking. NOUR OS is not a side project — it is the purest expression of your life's task: building integrated systems that give you leverage over chaos. When motivation dips, do not search for a new calling. You already found it. Dig deeper into the one you have. The resistance you feel is not a sign to pivot — it is the friction that precedes breakthrough.",
      triggerPatterns: JSON.stringify([
        "purpose_search",
        "motivation_loss",
        "career_doubt",
        "calling_alignment",
        "life_task_clarity",
        "passion_reconnection"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 2,
      title: "Submit to Reality",
      shortTitle: "The Ideal Apprenticeship",
      essence:
        "The apprenticeship phase requires humility. Submit to the reality of what you do not know. Absorb skills through deep practice, not shortcuts. The discomfort of being a beginner is temporary; the skills gained are permanent. Resist the urge to skip stages.",
      shopApplication:
        "Even as the owner, there are domains at the shop where you are still the apprentice — advanced diagnostics, fleet management logistics, scaling operations beyond one location. At Nick's, submit to learning these domains properly. Shadow the best technicians, study the financials line by line, learn the parts supply chain inside out. The owner who understands every level of the operation can never be fooled by employees, vendors, or competitors.",
      nourApplication:
        "In coding, resist the temptation to use tools you do not understand. Every framework, every database pattern, every deployment system — learn the fundamentals before abstracting. The apprenticeship phase for NOUR OS means building things the hard way first, then optimizing. Do not skip the ugly, manual work of understanding Prisma schemas, API routes, and state management at a deep level. That foundation makes everything else possible.",
      triggerPatterns: JSON.stringify([
        "learning_humility",
        "skill_gap",
        "shortcut_temptation",
        "apprenticeship_phase",
        "submit_to_reality",
        "deep_practice",
        "fundamentals_first"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 3,
      title: "Absorb the Master's Power",
      shortTitle: "The Mentor Dynamic",
      essence:
        "Find mentors who have already walked the path you are on. Absorb their knowledge, methods, and frameworks — but adapt them to your own style. The mentor relationship accelerates your development by years. Eventually, you must surpass the mentor and find your own voice.",
      shopApplication:
        "Identify the shop owners in Cleveland — or nationally — who have built what you want to build. Study their operations, pricing, marketing, and customer retention. At Nick's, this could mean joining a mastermind group, attending industry conferences with intention (not just attendance), or cold-calling a successful multi-location owner and offering to buy them lunch. Extract their 20 years of experience in 20 conversations.",
      nourApplication:
        "In tech, your mentors are the builders you study — their codebases, their architecture decisions, their writing about what worked and failed. Follow indie hackers who built solo products, study how Levels.fyi or Pieter Levels approached one-person businesses. But do not copy — adapt. Your unique combination of auto shop operations + personal OS + technical skills has no exact mentor. You are building the playbook.",
      triggerPatterns: JSON.stringify([
        "mentor_search",
        "knowledge_absorption",
        "industry_networking",
        "mastermind_group",
        "learning_from_others",
        "mentor_dynamic",
        "surpassing_teacher"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 4,
      title: "See People as They Are",
      shortTitle: "Social Intelligence",
      essence:
        "Social intelligence — the ability to read people, navigate politics, and manage relationships — is just as important as technical skill. Many brilliant people fail because they lack social awareness. Study human behavior with the same rigor you apply to your craft.",
      shopApplication:
        "The best technician in the shop is useless if they alienate customers and create drama with the team. At Nick's, social intelligence means reading the room — knowing when a customer needs reassurance versus information, when an employee needs praise versus a push, when a vendor is bluffing about pricing. Train advisors in micro-expression reading: crossed arms mean resistance, leaning in means interest, looking at the phone means you have lost them.",
      nourApplication:
        "Your technical skills are already strong. The multiplier is social intelligence — reading investors, managing contractors, navigating family expectations about your career path, and building genuine relationships in the tech community. Every person you interact with has needs, insecurities, and motivations. Understanding these gives you leverage that pure technical skill never will.",
      triggerPatterns: JSON.stringify([
        "social_intelligence",
        "reading_people",
        "team_dynamics",
        "customer_psychology",
        "relationship_navigation",
        "political_awareness",
        "emotional_intelligence"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 5,
      title: "Awaken the Dimensional Mind",
      shortTitle: "The Creative-Active",
      essence:
        "After mastering the fundamentals through deep practice, you enter the creative phase. Here, you combine disparate ideas, break conventional patterns, and produce original work. The dimensional mind sees connections that specialists miss. Creativity is not inspiration — it is the product of deep knowledge combined with openness.",
      shopApplication:
        "The creative phase at Nick's means innovating the customer experience in ways no other Cleveland shop does. Combine what you know about tech with auto repair: automated follow-ups, transparent digital inspections, customer portals showing service history. The shop that operates like a tech company while delivering hands-on mechanical excellence is uncopyable. Competitors cannot follow because they lack the dimensional thinking.",
      nourApplication:
        "NOUR OS is the creative-active phase personified — combining personal productivity, business operations, strategic thinking, and AI into a single system that nobody else has built. This only works because you have deep knowledge in multiple domains: coding, auto repair operations, personal development, and business strategy. Keep feeding the dimensional mind with inputs from unrelated fields — architecture, psychology, game design, military strategy.",
      triggerPatterns: JSON.stringify([
        "creative_breakthrough",
        "cross_domain_thinking",
        "innovation_opportunity",
        "dimensional_mind",
        "unconventional_approach",
        "creative_combination",
        "pattern_breaking"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 6,
      title: "Fuse the Intuitive with the Rational",
      shortTitle: "Mastery",
      essence:
        "True mastery is reached when rational knowledge becomes so deeply internalized that it transforms into intuition. The master does not think through every step — they feel the right move. This state requires 10,000+ hours of deliberate practice and comes with a sense of effortless flow.",
      shopApplication:
        "The master mechanic diagnoses by sound, by feel, by a glance at the exhaust color. That intuition is not magic — it is deeply internalized knowledge. At Nick's, the goal is to develop this mastery across the entire business: knowing which customers will convert from a single phone call, sensing when a tech is about to quit, feeling the rhythm of a profitable week versus a losing one. This intuition guides decisions faster than any dashboard.",
      nourApplication:
        "In coding, mastery feels like the code writing itself — you see the architecture before you type. In business, it feels like knowing the right decision before analyzing the spreadsheet. You are on this path but not there yet. The 10,000 hours require patience. Do not mistake competence for mastery. Keep showing up, keep practicing deliberately, and the intuitive layer will emerge.",
      triggerPatterns: JSON.stringify([
        "intuition_development",
        "mastery_pursuit",
        "deliberate_practice",
        "flow_state",
        "deep_expertise",
        "rational_intuition_fusion",
        "ten_thousand_hours"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 7,
      title: "The Three Steps of Apprenticeship",
      shortTitle: "Deep Observation, Skills Acquisition, Experimentation",
      essence:
        "Every apprenticeship follows three phases: passive observation (watching how things really work), skills acquisition (drilling fundamentals until they are automatic), and experimentation (testing your own approaches). Skipping or rushing any phase creates fragile competence.",
      shopApplication:
        "New hires at Nick's should follow this exact sequence: Week 1-2 observe — watch how the shop flows, how customers interact, how techs prioritize. Week 3-6 acquire skills — practice the specific tasks under supervision. Week 7+ experiment — try their own approaches to customer service, workflow, and problem-solving. This structure prevents the chaos of throwing someone into the deep end and hoping they swim.",
      nourApplication:
        "Apply this to every new domain you enter. Before building a new NOUR OS module, observe how others solve the problem. Before implementing a marketing strategy, study what actually works in your market. Before experimenting with a new tech stack, acquire the fundamentals. The temptation to skip to experimentation is strong when you are smart — resist it.",
      triggerPatterns: JSON.stringify([
        "new_skill_learning",
        "onboarding_process",
        "observation_phase",
        "skill_drilling",
        "experimentation_phase",
        "learning_structure"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 8,
      title: "The False Path",
      shortTitle: "Avoiding Distractions from Your Life's Task",
      essence:
        "The false path looks attractive — it offers quicker results, more social approval, or less resistance. But it leads away from your true calling. Money, status, and comfort can seduce you into abandoning the harder but more fulfilling path. Recognize false paths early and have the courage to return to yours.",
      shopApplication:
        "The false path for Nick's could be chasing trendy services that do not fit the core competency — EV conversions, detailing, custom wraps — just because they seem profitable. Or it could be selling the shop early for a quick payout instead of building long-term equity. Every shiny opportunity should be tested against the core mission: does this deepen the moat or distract from it?",
      nourApplication:
        "The false path for you could be taking a comfortable tech job with a salary, abandoning the shop for a 'cleaner' business, or pivoting NOUR OS into a SaaS product for others before it works perfectly for you. Every time someone suggests 'you should just' — just get a dev job, just sell the shop, just use Notion instead — they are pointing at a false path. Stay on yours.",
      triggerPatterns: JSON.stringify([
        "false_path_detection",
        "shiny_object_syndrome",
        "distraction_from_calling",
        "comfort_trap",
        "quick_money_temptation",
        "peer_pressure_pivot",
        "mission_drift"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 9,
      title: "The Emotional Pitfalls",
      shortTitle: "Complacency, Conservatism, Dependency, Impatience, Grandiosity",
      essence:
        "Five emotional pitfalls derail the path to mastery: complacency (coasting on early success), conservatism (fear of new approaches), dependency (needing external validation), impatience (wanting results before putting in the work), and grandiosity (inflated self-image after initial success).",
      shopApplication:
        "At Nick's, complacency looks like 'we have always done it this way.' Conservatism is refusing to adopt digital inspections because the clipboard works. Dependency is needing customer praise to feel good about the work. Impatience is expecting a marketing campaign to pay off in a week. Grandiosity is assuming one good month means you have it figured out. Train yourself and the team to recognize each pitfall by name.",
      nourApplication:
        "You are most vulnerable to impatience (wanting NOUR OS to be complete now) and grandiosity (feeling invincible after a good sprint). Complacency will creep in if the shop is running smoothly — the urge to coast is strong when there is no crisis. Fight each pitfall with its antidote: humility for grandiosity, urgency for complacency, experimentation for conservatism, self-validation for dependency, patience for impatience.",
      triggerPatterns: JSON.stringify([
        "complacency_check",
        "conservatism_trap",
        "dependency_on_validation",
        "impatience_spiral",
        "grandiosity_warning",
        "emotional_pitfall",
        "coasting_alert"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 10,
      title: "The Seven Deadly Realities of the Workplace",
      shortTitle: "Envy, Conformism, Rigidity, Self-Obsession, Laziness, Flightiness, Passive Aggression",
      essence:
        "Every workplace contains seven destructive dynamics: envy among colleagues, conformist pressure, rigid thinking, self-obsessed individuals, laziness disguised as busyness, flighty people who never commit, and passive-aggressive behavior. Recognize these patterns and navigate them strategically.",
      shopApplication:
        "At Nick's, each of these shows up daily. Envy: a tech resents another getting the better jobs. Conformism: 'That is not how we do things here.' Rigidity: refusing to learn new diagnostic tools. Self-obsession: an advisor who only cares about their commission. Laziness: stretching a 2-hour job into 4. Flightiness: a hire who quits after a month. Passive aggression: doing the job technically right but making the customer feel unwelcome. Name these patterns when you see them.",
      nourApplication:
        "As a solo builder, you face internalized versions of these: envy of other builders' progress, conformism to popular tech stacks, rigidity in your own workflows, self-obsession that ignores user needs, laziness disguised as 'research,' flightiness between projects, and passive aggression toward tasks you resent doing. Self-awareness is the antidote.",
      triggerPatterns: JSON.stringify([
        "workplace_dynamics",
        "team_toxic_pattern",
        "envy_at_work",
        "conformist_pressure",
        "lazy_employee",
        "passive_aggressive_staff",
        "self_obsessed_coworker"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 11,
      title: "The Creative Breakthrough",
      shortTitle: "Tension and Release",
      essence:
        "Creative breakthroughs follow a pattern: intense immersion in a problem, mounting frustration and tension, then a sudden release where the solution appears — often when you stop actively thinking about it. This cycle cannot be forced, but it can be set up through deep engagement followed by strategic rest.",
      shopApplication:
        "The breakthrough idea for improving shop efficiency, solving a recurring customer complaint, or cracking a marketing challenge will not come during a meeting. It will come in the shower, during a drive, or at 6 AM before the shop opens. At Nick's, create the conditions: immerse deeply in the problem, discuss it with the team, sleep on it, then let the solution emerge. The worst thing is forcing a decision during the tension phase.",
      nourApplication:
        "Your best code — the architecture decisions that make everything click — comes after periods of intense struggle followed by stepping away. Do not optimize for constant output. Optimize for the cycle: deep immersion, frustration, rest, breakthrough. When you are stuck on a NOUR OS problem, go to the shop. When you are stuck at the shop, go code. The cross-pollination between domains is where your best ideas live.",
      triggerPatterns: JSON.stringify([
        "creative_block",
        "stuck_on_problem",
        "breakthrough_moment",
        "tension_and_release",
        "strategic_rest",
        "cross_pollination",
        "forced_solution"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 12,
      title: "The Fingertip Feel",
      shortTitle: "Mastery in Practice",
      essence:
        "The final stage of mastery manifests as 'fingertip feel' — an almost supernatural ability to sense what is happening in your domain without conscious analysis. This comes from thousands of hours of practice creating neural pathways so deep that perception and action become one fluid motion.",
      shopApplication:
        "The master shop owner walks into the bay and knows — from the sound of the air tools, the body language of the techs, the pace of the phone — whether it is a good day or a problem day. This fingertip feel for the business only comes from years of daily engagement. At Nick's, develop it by being present, paying attention to the micro-signals, and trusting your gut when it screams that something is off even if the numbers look fine.",
      nourApplication:
        "In coding, fingertip feel is knowing a bug exists before you can explain why. In business, it is sensing a deal is going south before the customer says anything. You are building toward this in both domains simultaneously — which is rare and powerful. Do not rush it. Every day of deliberate attention adds another layer to the intuition. In 5 years, you will walk into any situation in your domains and know immediately what to do.",
      triggerPatterns: JSON.stringify([
        "intuition_signal",
        "gut_feeling",
        "fingertip_feel",
        "pattern_recognition",
        "mastery_practice",
        "deep_engagement",
        "unconscious_competence"
      ]),
    },
  ];

  for (const law of laws) {
    await prisma.strategicLaw.upsert({
      where: {
        book_number: { book: law.book, number: law.number },
      },
      update: {
        title: law.title,
        shortTitle: law.shortTitle,
        essence: law.essence,
        shopApplication: law.shopApplication,
        nourApplication: law.nourApplication,
        triggerPatterns: JSON.parse(law.triggerPatterns as string),
      },
      create: {
        book: law.book,
        number: law.number,
        title: law.title,
        shortTitle: law.shortTitle,
        essence: law.essence,
        shopApplication: law.shopApplication,
        nourApplication: law.nourApplication,
        triggerPatterns: JSON.parse(law.triggerPatterns as string),
      },
    });
  }

  console.log(`Seeded ${laws.length} Mastery principles`);
}
