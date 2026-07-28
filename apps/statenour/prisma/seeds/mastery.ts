import type { PrismaClient } from "@prisma/client";

/**
 * Exported (2026-07-27) so the prompt-budget guard is enforceable in a
 * test. `finalize-system-prompt` maps EVERY StrategicLaw row into the
 * anthropic system prompt as `[BOOK #N] shortTitle: essence`, so an
 * unbounded `essence` here is paid on every chat turn against a 65K cap.
 * See tests/brain/mastery-creative-strategies.test.ts.
 */
export const MASTERY_LAWS = [
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

    // ── Book V · the 9 creative strategies (21-29) ──────────────────
    // 2026-07-27. Numbers 13-20 live in seed-greene-expansion.ts; these
    // continue at 21 to stay clear of that range.
    //
    // These already exist in the BrainMemory Greene corpus
    // (lib/brain/greene/mastery.ts, type "creative_strategy"), but that
    // is a DIFFERENT retrieval path — BrainMemory feeds the chat matcher,
    // the reasoning engine, and the relationship sidebar. StrategicLaw
    // feeds four other consumers the corpus never reaches:
    // finalize-system-prompt (every anthropic chat turn, via
    // greeneSummary), lib/ultron/adviser.ts (cached trigger index),
    // lib/ai/tools/brain.ts (operator text search), and
    // lib/ai/tools/tasks.ts (task↔law matching). Absent here, Nick could
    // retrieve these strategies on a matched chat turn but never carried
    // them as ambient context, and no tool could surface them on request.
    //
    // BUDGET NOTE · greeneSummary maps EVERY row into the system prompt as
    // `[BOOK #N] shortTitle: essence`, so `essence` is paid on every
    // anthropic turn — keep it tight (~250-300 chars, matching the rows
    // above). shopApplication / nourApplication are NOT in that summary;
    // they surface only on an explicit tool hit, so they carry the depth.
    {
      book: "MASTERY" as const,
      number: 21,
      title: "The Authentic Voice",
      shortTitle: "Authentic Voice",
      essence:
        "Early work is inevitably an imitation of whoever you absorbed — that is the apprenticeship working. The influences must eventually be shed, and the transition is brutal: your own voice at first sounds worse than your imitation of a master. Most retreat, because imitation earns approval faster than authenticity.",
      shopApplication:
        "Nick's marketing currently reads like every other Cleveland shop's marketing — same reassurance language, same stock phrasing, same promises. That is the imitation phase, and it is invisible precisely because it is competent. The authentic version is riskier: say the thing a competitor would never say. Name the repair you talked a customer OUT of. Publish the job that went wrong and what it cost to make right. Quote the actual number instead of 'competitive pricing.' The shop with a voice cannot be comparison-shopped on price alone, because there is nothing to compare it to.",
      nourApplication:
        "This applies hardest to what Nick writes on your behalf. Fluent AI output is the purest form of the imitation trap — it is stylistically competent and completely anonymous, and it earns polite non-reaction every time. When a draft could have been produced by any shop with any tool, it has no voice. Test it directly: delete every sentence a competitor could have written and see what survives. If nothing does, the piece has not started yet. Endure the phase where your own voice reads worse than the polished template.",
      triggerPatterns: JSON.stringify([
        "voice_search",
        "generic_output",
        "sounds_like_everyone",
        "derivative_work",
        "imitation_phase",
        "brand_voice_missing",
        "ai_sounding_copy"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 22,
      title: "The Fact of Great Yield",
      shortTitle: "Fact of Great Yield",
      essence:
        "Darwin's breakthroughs came from observations that refused to fit the theory he held. Everyone else averted their eyes, because an anomaly is an accusation against the frame you have invested in. Confirming evidence tells you what you already believe; the single inconvenient fact tells you what is actually true.",
      shopApplication:
        "The most valuable data at Nick's is the outlier nobody logged. The customer who declined a quote everyone assumed would close. The month where car count rose and revenue fell. The tire line that moves in one bay and not the other. The instinct is to explain these away — 'they were just price shopping,' 'that month was weird' — and that explanation is where the yield gets buried. Rule: any result that surprises you gets a root cause before it gets a story. One phone call to the customer who left is worth more than a week of reading the dashboard that already agrees with you.",
      nourApplication:
        "Your dashboards are built to confirm the model you already have, which makes them comfortable and slightly useless at the margin. The metric that contradicts your working narrative is the one to chase — not the one to caveat. When you catch yourself writing 'that's just noise' or 'that's a data issue,' treat it as an unfinished investigation, not a closed one. Same discipline in code: the bug that only reproduces sometimes is telling you your mental model of the system is wrong, and that is worth more than the fix.",
      triggerPatterns: JSON.stringify([
        "anomaly_dismissed",
        "outlier_ignored",
        "contradicting_data",
        "unexplained_result",
        "confirmation_bias",
        "root_cause_skipped",
        "churn_reason_unlogged"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 23,
      title: "Mechanical Intelligence",
      shortTitle: "Mechanical Intelligence",
      essence:
        "The Wright brothers built and crashed gliders while Langley theorized on a bigger budget. Mechanical intelligence arrives only through physical contact with the object — how the parts resist each other, where it actually breaks, what the diagram omitted. Paper knowledge fails the moment reality diverges from the spec.",
      shopApplication:
        "This is the one strategy where Nick's is already the master and the software is the apprentice. A tech diagnoses by sound, by feel, by the color of the fluid — knowledge no manual transfers. Protect that: when a decision about shop flow gets made from a dashboard instead of from standing in the bay, it will be wrong in a way the numbers cannot show. Before changing a process, watch the process run. Before buying the equipment, borrow it for a day. The dashboard reports what was measured; the bay reports what happened.",
      nourApplication:
        "Your failure mode here is inverted from the shop's: you have the hands-on instinct for cars and the paper instinct for software. You architect NOUR OS features from the diagram down, and the design survives until it meets a real week of use. Build the crude version and run it yourself for seven days before specifying version two. The feature you were certain about will turn out to be unused, and the throwaway detail will turn out to be the whole product. Let the working object correct the spec, not the reverse.",
      triggerPatterns: JSON.stringify([
        "theory_over_practice",
        "designing_on_paper",
        "no_prototype",
        "dashboard_over_observation",
        "spec_before_build",
        "overplanning",
        "hands_off_decision"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 24,
      title: "Natural Powers",
      shortTitle: "Natural Powers",
      essence:
        "Every field pressures you toward what it already rewards, and that pressure quietly reshapes you into a competent version of someone else. Your leverage is the grain you were born with — the inclinations that predate anyone telling you what was practical. Against it you produce work no one remembers, including you.",
      shopApplication:
        "The pressure on Nick's is to become a normal shop: compete on price, advertise like the others, hire the way the others hire, measure what the others measure. Every one of those is a move toward the middle. The shop's actual grain is that its owner can build software — which no competing shop on the East Side can say. Any initiative that does not use that is an initiative a competitor could copy next quarter. Test each one: does this deepen the thing only we have, or does it make us a slightly better version of everyone else?",
      nourApplication:
        "The advice you receive most often — get the dev job, sell the shop, use an off-the-shelf tool — is uniformly advice to work against your grain, and it is sincere every time. It optimizes for a life you did not choose. Your inclination is the same one that showed up before it was practical: build the system that gives you leverage over chaos. When energy is chronically low on work that is going well by external measures, that is the grain signal, not a discipline problem. Route what you are actually drawn to onto the critical path instead of the margins.",
      triggerPatterns: JSON.stringify([
        "external_approval_path",
        "against_the_grain",
        "conventional_pressure",
        "strength_sidelined",
        "energy_low_despite_success",
        "advice_to_conform",
        "inclination_ignored"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 25,
      title: "The Open Field",
      shortTitle: "Open Field",
      essence:
        "In a saturated field you are judged on the incumbents' terms, by criteria they defined and already dominate — winning there is expensive and temporary. The open field is the adjacent space nobody has claimed, where you write the standard. This is not avoiding competition; it is refusing someone else's scoreboard.",
      shopApplication:
        "Every shop in Cleveland competes on the same three axes: price, proximity, speed. On those, Nick's can at best tie, and the tie is defended by discounting forever. The open field is the seam between auto repair and software — transparent digital inspections, a customer portal with full service history, automated follow-up that actually arrives. Not because those are trendy, but because no competitor can follow: they lack the builder. Occupy that publicly and define the standard before anyone names it, and the price comparison stops being the conversation.",
      nourApplication:
        "The same trap exists in what you build. NOUR OS competing with Notion or Linear on their axes is a fight against companies with a hundred engineers and a defined scoreboard. Its open field is the seam nobody else sits in: a personal operating system built by the operator of a real business, wired to that business's live data. Nobody is building that because almost nobody is both. Stop benchmarking against general-purpose tools and start defining what this category means.",
      triggerPatterns: JSON.stringify([
        "saturated_market",
        "price_competition",
        "commoditized_offering",
        "differentiation_search",
        "incumbent_scoreboard",
        "crowded_field",
        "race_to_bottom"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 26,
      title: "The High End",
      shortTitle: "High End",
      essence:
        "Detail without a visible high end is motion — you optimize what cannot move the outcome, and it feels like diligence the whole time. The master keeps the largest purpose in view while doing the smallest work, and lets it decide which details earn attention. Losing the high end is the most comfortable failure available.",
      shopApplication:
        "At Nick's the low end is endlessly available and always feels productive: reorganizing the parts shelf, tuning a process nobody complained about, rebuilding a spreadsheet. Meanwhile the estimates from Tuesday go unfollowed. The high end is the number the month turns on — booked jobs, average ticket, retention. Every task should trace to one of them in a single step. If it takes two steps to explain how a task moves revenue, it is low end wearing a disguise.",
      nourApplication:
        "This is your documented failure mode, not a hypothetical one. The Build-Drift-Reset cycle runs on low-end work that provides the sensation of progress — the refactor, the polish, the architecture that could be cleaner — while the thing that compounds sits untouched. The countermeasure is structural, not motivational: state the high end in one sentence before choosing the next task, and drop anything that cannot be traced to it in one step. Timebox the detail work you cannot resist rather than pretending you will resist it.",
      triggerPatterns: JSON.stringify([
        "lost_in_details",
        "rabbit_hole",
        "polish_over_revenue",
        "no_line_to_goal",
        "busywork_disguise",
        "refactor_drift",
        "big_picture_lost"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 27,
      title: "The Evolutionary Hijack",
      shortTitle: "Evolutionary Hijack",
      essence:
        "Evolution does not design from scratch — it hijacks what exists and repurposes it, turning a swim bladder into a lung. Adapting a proven structure is faster, cheaper, and more robust than inventing one, because the structure has already survived its own debugging. Greenfield is a luxury; the hijack is the leverage.",
      shopApplication:
        "Before building anything new at Nick's, inventory what already runs and is underused. The customer database is a marketing channel nobody is using as one. The SMS pipeline built for appointment reminders is a winback engine. The inspection photos already being taken are the proof content the social accounts lack. Each of those is a structure that already works, already has trust, and needs a new purpose rather than a new build. The mechanism solved in another industry — subscription maintenance, membership pricing, fleet retainers — is cheaper to adapt than to derive.",
      nourApplication:
        "This is the thesis NOUR OS is already built on, which means the discipline is to keep applying it rather than to discover it. The instinct that shows up as 'let me rebuild this properly' is almost always the expensive path. Before approving any from-scratch build, list what already runs that gets you eighty percent there. The tire shop's operational machinery being pointed at personal operations is the original hijack; the next one is probably sitting in the same repo, already deployed, doing one job when it could do two.",
      triggerPatterns: JSON.stringify([
        "build_from_scratch",
        "rebuild_instinct",
        "idle_asset",
        "greenfield_temptation",
        "reinventing_solved_problem",
        "underused_system",
        "adjacent_industry_solution"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 28,
      title: "Dimensional Thinking",
      shortTitle: "Dimensional Thinking",
      essence:
        "Leonardo studied an object from every side, in motion, across time, and in relation to its surroundings — the specialist sees a single plane and mistakes it for the whole. The block is almost never a lack of intelligence; it is a fixed vantage point. Widen the frame before working harder inside it.",
      shopApplication:
        "Most shop problems look unsolvable because they are being examined from the owner's chair only. Rotate them: what does this pricing change look like from the customer's side, the advisor's side, the tech's paycheck, the P&L, and the same question five years out? A policy that is efficient operationally and humiliating at the counter will fail, and no amount of operational analysis will reveal why. Deliberately ask the person whose vantage point you do not occupy — the advisor knows things the dashboard structurally cannot.",
      nourApplication:
        "Your rare asset is that you already hold two vantage points most people never combine — you are the technician and the operator, so you see customer psychology a pure engineer misses and technical leverage a pure owner misses. Protect that and extend it: when stuck, deliberately rotate rather than push. Restate the problem from the customer's side, then the ledger's, then the five-year side. Change the medium — say it out loud, draw it — and watch which constraint turns out to be imaginary. Do not outsource either half; the combination is the whole advantage.",
      triggerPatterns: JSON.stringify([
        "single_perspective",
        "stuck_on_problem",
        "reframe_needed",
        "blind_spot",
        "tunnel_vision",
        "cross_domain_thinking",
        "same_approach_repeated"
      ]),
    },
    {
      book: "MASTERY" as const,
      number: 29,
      title: "Alchemical Creativity and the Unconscious",
      shortTitle: "Alchemical Creativity",
      essence:
        "The alchemical move is holding two things that do not belong together until the tension produces a third. The second half is mechanical, not mystical: immersion then genuine release, because the unconscious closes what conscious effort saturated but could not finish. Forcing it yields the obvious answer.",
      shopApplication:
        "The breakthrough on a recurring shop problem will not arrive in the meeting held to solve it. Immerse the team fully — lay out the problem, argue it, gather what everyone has noticed — and then deliberately stop, because a decision forced during the tension phase defaults to what the industry already does. Set it down and revisit in two days. The fusion that produces something uncopyable is the one nobody else can hold: a shop floor and a software stack under one roof.",
      nourApplication:
        "Your best architecture decisions have always followed the same shape — intense struggle, then stepping away, then the thing resolving on its own. That is not luck, it is the mechanism, and it means constant output is the wrong optimization target. Structure the cycle deliberately: immerse, then release, then decide. The cross-move is the practical version — when the code stalls, go to the shop; when the shop stalls, go to the code. Each domain runs the unconscious on the other one, which is why the fusion keeps producing things neither would alone.",
      triggerPatterns: JSON.stringify([
        "creative_block",
        "grinding_past_returns",
        "forced_solution",
        "obvious_answer_only",
        "no_rest_cycle",
        "domain_fusion",
        "immersion_release"
      ]),
    },
];

export async function seedMastery(prisma: PrismaClient) {
  const laws = MASTERY_LAWS;

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
