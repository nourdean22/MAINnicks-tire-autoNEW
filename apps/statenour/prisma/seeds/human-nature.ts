import type { PrismaClient } from "@prisma/client";

export async function seedHumanNature(prisma: PrismaClient) {
  const laws = [
    {
      book: "HUMAN_NATURE" as const,
      number: 1,
      title: "The Law of Irrationality",
      shortTitle: "Master Your Emotional Self",
      essence:
        "You are largely unaware of how deeply irrational you are. Emotions color your thinking far more than you realize. The first step toward rationality is recognizing this and creating strategies to counteract emotional flooding before making decisions.",
      shopApplication:
        "When a frustrated customer storms in demanding a free repair or threatens to leave a bad review, the instinct is to match their energy or fold under pressure. Instead, pause. Let the emotional wave pass before responding. At Nick's Tire & Auto, train advisors to never give a price adjustment or promise in the heat of the moment. Say 'Let me look into this and call you back in 30 minutes.' That gap kills reactive decision-making. Same applies when a competitor undercuts pricing — the urge is to slash prices impulsively, but rational analysis of margins and value positioning always wins.",
      nourApplication:
        "Late-night coding urges feel productive but are often driven by anxiety or avoidance, not strategy. Impulse decisions — buying a new tool, pivoting a feature, firing off a frustrated text — almost always look worse in the morning. Build a 24-hour rule: any decision made after 10 PM or while emotionally charged gets written down but not executed until reviewed with fresh eyes. Track which decisions were emotional versus rational in your daily log.",
      triggerPatterns: JSON.stringify([
        "emotional_reaction",
        "impulse_decision",
        "late_night_coding",
        "angry_customer",
        "price_war_panic",
        "reactive_response",
        "frustration_spiral",
        "snap_judgment"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 2,
      title: "The Law of Narcissism",
      shortTitle: "Transform Self-Love into Empathy",
      essence:
        "Everyone is a narcissist to some degree. The key is to transform self-absorption into empathy — the ability to genuinely enter another person's perspective. Deep narcissists are toxic and must be identified early. Empathy is the ultimate social power.",
      shopApplication:
        "Advisors who only talk about what they want to sell (the upsell, the premium brake pad) lose customers. Train the team to listen first, diagnose second, sell third. When a customer says 'I just need the cheapest option,' that is a signal about their financial situation, not an invitation to lecture them about quality. At Nick's, the advisor who mirrors back the customer's concern before offering a solution closes at 2x the rate.",
      nourApplication:
        "Notice when conversations become about proving you are right instead of understanding the other person. In business meetings, practice radical listening — repeat back what you heard before responding. With family, catch the moments where you are waiting to talk instead of actually hearing. Empathy is the cheat code for leadership, sales, and relationships.",
      triggerPatterns: JSON.stringify([
        "self_centered_thinking",
        "customer_not_listening",
        "employee_conflict",
        "proving_right",
        "relationship_friction",
        "ego_driven_decision"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 3,
      title: "The Law of Role-Playing",
      shortTitle: "See Through People's Masks",
      essence:
        "People wear masks in social life. They present carefully curated versions of themselves. Learn to read the micro-signals that reveal what lies behind the mask — tone shifts, body language contradictions, overcompensation, and what people do versus what they say.",
      shopApplication:
        "A customer who says 'price doesn't matter, I just want it done right' almost always cares deeply about price. Watch for the flinch when the estimate is presented. A vendor who promises 'we'll take care of you' is performing — verify with contract terms and past behavior. At Nick's, track what customers do (return visits, referrals, review behavior) rather than what they say they will do.",
      nourApplication:
        "In hiring and partnerships, watch actions over words. Someone who talks about how loyal they are is often signaling the opposite. In your own life, notice where you are performing — posting the grind on social media instead of actually grinding. Authenticity is the rarest competitive advantage.",
      triggerPatterns: JSON.stringify([
        "reading_people",
        "customer_says_vs_does",
        "hiring_interview",
        "vendor_promises",
        "social_performance",
        "mask_detection"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 4,
      title: "The Law of Compulsive Behavior",
      shortTitle: "Determine the Strength of People's Character",
      essence:
        "Character is formed in early childhood and is deeply rooted. People's past behavior is the strongest predictor of their future actions. Under stress, people revert to their core character. Learn to detect character patterns before committing to someone.",
      shopApplication:
        "Before hiring a technician or advisor, dig into their work history patterns — not just skills. Someone who has left three shops in two years will leave yours too. A tech who cuts corners on one job will cut corners on all of them when pressure hits. At Nick's, implement a 90-day character observation period for new hires. Track how they handle mistakes, slow days, and difficult customers — that is their real character.",
      nourApplication:
        "Apply this to every business relationship — partners, contractors, vendors. The person who is late to the first meeting will be late to every meeting. The friend who talks behind others' backs is talking behind yours too. In your own life, identify your compulsive patterns — the procrastination loops, the avoidance behaviors — and build systems to interrupt them rather than relying on willpower.",
      triggerPatterns: JSON.stringify([
        "hiring_decision",
        "trust_evaluation",
        "character_assessment",
        "employee_pattern",
        "partnership_risk",
        "repeated_behavior",
        "background_check",
        "reference_check"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 5,
      title: "The Law of Covetousness",
      shortTitle: "Become an Elusive Object of Desire",
      essence:
        "People want what they cannot have. Desire is intensified by absence and scarcity. If you are too available, too eager, too transparent about your offerings, desire diminishes. Learn to create strategic absence and mystery around what you offer.",
      shopApplication:
        "Stop chasing every customer with desperate follow-ups and discounts. At Nick's, position premium services as limited — 'We only do 3 full detail packages per week.' When a customer hesitates on a quote, do not call back the same day begging. Wait 48 hours, then reach out with added value, not a lower price. Exclusivity positioning: 'We only work on vehicles we can guarantee results for' creates more demand than 'We work on everything.'",
      nourApplication:
        "In brand building, scarcity creates desire. Do not over-post, over-explain, or over-sell. In personal relationships, maintain mystery — you do not need to share every thought in real time. For NOUR OS itself, the exclusive invite-only positioning creates more demand than a public launch ever would. Your time is the ultimate scarce resource — protect it fiercely.",
      triggerPatterns: JSON.stringify([
        "brand_scarcity",
        "exclusivity_positioning",
        "desperate_follow_up",
        "over_availability",
        "price_chasing",
        "premium_positioning",
        "limited_offer",
        "desire_creation"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 6,
      title: "The Law of Shortsightedness",
      shortTitle: "Elevate Your Perspective",
      essence:
        "Most people are locked into the present moment, reacting to events as they occur with no strategic foresight. Elevate your perspective to see the larger patterns, the second and third-order consequences, and the long game that others miss entirely.",
      shopApplication:
        "A shop owner who only thinks about this week's revenue is a technician, not a CEO. At Nick's, every decision should pass the 5-year test: does this discount protect a relationship worth $20K in lifetime value, or does it train the customer to expect discounts? Build quarterly strategic reviews — track not just revenue but customer retention rates, technician development, market positioning. The shop that plans 18 months ahead while competitors plan 18 days ahead dominates.",
      nourApplication:
        "You are building an empire, not just shipping features. Every coding sprint, every business decision, every relationship choice should serve the 10-year vision. When you catch yourself reacting to daily noise — a competitor's Instagram post, a bad review, a slow week — zoom out. Ask: 'Will this matter in 6 months?' If not, redirect that energy to something that will. CEO-level thinking means sacrificing short-term comfort for long-term positioning.",
      triggerPatterns: JSON.stringify([
        "ceo_level_thinking",
        "short_term_vs_long_term",
        "reactive_management",
        "strategic_planning",
        "quarterly_review",
        "five_year_vision",
        "daily_noise_distraction",
        "second_order_thinking"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 7,
      title: "The Law of Defensiveness",
      shortTitle: "Soften People's Resistance",
      essence:
        "People are naturally defensive when they feel their autonomy is threatened. Direct persuasion often backfires. Instead, make people feel like they arrived at your idea themselves. Validate first, then guide. Resistance dissolves when people feel respected and in control.",
      shopApplication:
        "Never tell a customer 'You need new brakes.' Instead, show them the worn pads, explain what they are seeing, and ask 'What would you like to do about this?' The customer who chooses the repair themselves never feels pressured and never leaves a bad review. When introducing new processes to the team, frame changes as collaborative decisions rather than top-down mandates. 'I was thinking about trying X — what do you think?' gets compliance. 'Starting Monday, we are doing X' gets resistance.",
      nourApplication:
        "In leadership, the hardest skill is getting people to move without feeling pushed. With family, direct confrontation about habits or choices triggers defensiveness. Instead, ask questions that lead them to their own conclusions. In your own internal dialogue, notice when you are resisting feedback — that defensiveness is a signal that the feedback is probably accurate.",
      triggerPatterns: JSON.stringify([
        "customer_resistance",
        "team_pushback",
        "persuasion_attempt",
        "change_management",
        "soft_sell",
        "autonomy_threat",
        "feedback_resistance"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 8,
      title: "The Law of Self-Sabotage",
      shortTitle: "Change Your Circumstances by Changing Your Attitude",
      essence:
        "Your attitude toward life — whether generally hostile, anxious, avoidant, or expansive — shapes the events that happen to you more than external circumstances. A negative attitude creates a self-fulfilling prophecy of negativity. Shift the inner lens and the outer world follows.",
      shopApplication:
        "A shop with a 'customers are always trying to screw us' attitude attracts exactly those customers and repels good ones. At Nick's, build a culture of abundance — there is enough work, enough revenue, enough good customers. When the team complains about difficult customers, reframe: 'This person is stressed and trusting us with their safety.' The energy of the shop is contagious — anxious owner creates anxious staff creates anxious customers.",
      nourApplication:
        "Catch the scarcity mindset — 'there is not enough time,' 'the market is too competitive,' 'I am behind.' These beliefs create the reality they describe. When you wake up dreading the day, that attitude will manufacture reasons to confirm the dread. Practice deliberate attitude resets: gratitude for what is working, excitement about what is being built, confidence in the trajectory even when the present feels chaotic.",
      triggerPatterns: JSON.stringify([
        "negative_mindset",
        "self_sabotage",
        "scarcity_thinking",
        "attitude_problem",
        "self_fulfilling_prophecy",
        "team_morale",
        "victim_mentality"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 9,
      title: "The Law of Repression",
      shortTitle: "Confront Your Dark Side",
      essence:
        "Every person has a shadow — impulses, desires, and traits they repress because society deems them unacceptable. The more you repress, the more these forces control you unconsciously. Integration, not denial, is the path to self-mastery.",
      shopApplication:
        "The advisor who claims they never get frustrated with customers is lying and will eventually explode. Create space for the team to vent safely — weekly check-ins where frustrations can be voiced without judgment. Acknowledge that some customers are genuinely difficult and some days are brutal. A team that admits the darkness can manage it; a team that pretends everything is fine burns out.",
      nourApplication:
        "Acknowledge the parts of yourself that do not fit the 'disciplined entrepreneur' narrative — the laziness, the doubt, the desire to quit some days. These are not weaknesses to eliminate; they are signals to understand. The coding binge at 2 AM might be escaping something you do not want to face during the day. Integrate the shadow by naming it honestly in your daily log.",
      triggerPatterns: JSON.stringify([
        "burnout_signal",
        "repressed_frustration",
        "shadow_integration",
        "team_venting",
        "hidden_motivation",
        "avoidance_behavior",
        "emotional_suppression"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 10,
      title: "The Law of Envy",
      shortTitle: "Beware the Fragile Ego",
      essence:
        "Envy is the most hidden and destructive of emotions. People rarely admit to it. Signs include passive-aggressive praise, subtle sabotage, excessive comparison, and sudden coldness after your success. Learn to detect and manage it in others — and in yourself.",
      shopApplication:
        "When you expand the shop, add a new bay, or post a big week on social media, watch for the subtle shifts in competitor behavior and even in your own team. An employee who suddenly becomes negative after you celebrate a win may be envious, not unmotivated. With customers, delivering bad news about their vehicle requires managing their ego — nobody wants to feel stupid for neglecting maintenance. Frame it as 'This is common, here is how we fix it' rather than 'You should have come in sooner.'",
      nourApplication:
        "As you build NOUR OS and grow the shop, envy from peers, competitors, and even friends will increase. Do not flaunt success publicly — it creates targets. Be generous in giving credit. When you feel envy toward someone ahead of you, convert it to strategy: study what they did right and adapt it. Managing staff egos after delivering criticism requires the same delicacy — always pair the correction with genuine recognition of what they do well.",
      triggerPatterns: JSON.stringify([
        "managing_staff_egos",
        "customer_ego_management",
        "competitor_envy",
        "success_backlash",
        "passive_aggressive_behavior",
        "bad_news_delivery",
        "ego_management",
        "fragile_ego_detection"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 11,
      title: "The Law of Grandiosity",
      shortTitle: "Know Your Limits",
      essence:
        "Success can inflate your sense of your own abilities beyond what reality supports. This grandiosity leads to overreach, poor decisions, and eventual downfall. True confidence is grounded — it knows its strengths and its boundaries with equal clarity.",
      shopApplication:
        "The shop that tries to do everything — tires, engine rebuilds, body work, detailing, fleet — does nothing exceptionally. At Nick's, know what you are best at and dominate that lane. Expanding too fast because 'business is good' is a classic grandiosity trap. Every new service line dilutes focus and quality unless the foundation is bulletproof. Let competitors chase shiny objects while you deepen your moat.",
      nourApplication:
        "After a good week of shipping features and hitting revenue targets, the temptation is to take on three more projects. Resist. Your capacity has limits, and overcommitting is the fastest path to mediocrity across the board. Know your limits with sleep, with work hours, with how many systems you can maintain. Grandiosity whispers 'You can handle it all' — wisdom says 'You can handle what matters most.'",
      triggerPatterns: JSON.stringify([
        "overreach",
        "overcommitment",
        "expansion_decision",
        "grandiosity_check",
        "scope_creep",
        "capacity_limit",
        "success_inflation",
        "focus_dilution"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 12,
      title: "The Law of Gender Rigidity",
      shortTitle: "Reconnect to the Masculine or Feminine Within You",
      essence:
        "Every person contains both masculine and feminine traits. Rigidly identifying with only one side limits your effectiveness and creativity. The most charismatic and capable leaders integrate both — assertiveness with empathy, logic with intuition, strength with vulnerability.",
      shopApplication:
        "A shop run with pure masculine energy — dominate, control, compete — alienates half the customer base and most of the staff. Integrate the feminine — listen deeply, create a welcoming environment, nurture long-term relationships. The advisor who can be both authoritative about vehicle safety and genuinely caring about the customer's budget is unbeatable. The shop that feels like a trusted partner, not just a transaction, wins lifetime loyalty.",
      nourApplication:
        "Balance the builder energy (aggressive, focused, ship-it mentality) with reflective energy (listening, feeling, connecting). The best code is written by someone who understands the user emotionally, not just technically. In leadership, alternate between decisive action and patient listening. Neither extreme works alone.",
      triggerPatterns: JSON.stringify([
        "leadership_balance",
        "customer_rapport",
        "work_life_integration",
        "empathy_vs_authority",
        "creative_thinking",
        "team_culture"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 13,
      title: "The Law of Aimlessness",
      shortTitle: "Advance with a Sense of Purpose",
      essence:
        "Without a clear sense of purpose, people drift through life reacting to events and other people's agendas. Purpose creates focus, resilience, and momentum. It is the difference between being busy and being effective. Find your calling and let it organize everything else.",
      shopApplication:
        "Nick's Tire & Auto is not just a shop — it is the foundation of financial independence, community presence, and proof that a young owner can build something real in Cleveland. Every decision — hiring, marketing, pricing — should serve this larger purpose. When purpose is clear, saying no to distractions becomes easy. The shop's purpose should be visible to the team and felt by every customer who walks in.",
      nourApplication:
        "NOUR OS is the physical manifestation of your purpose — building systems that give you leverage, clarity, and control over your life. Every feature you build should trace back to this purpose. When you feel aimless or scattered, reconnect to the why: you are building the operating system for your entire life because you refuse to live reactively. This purpose is what makes the 14-hour days sustainable — not discipline, but alignment.",
      triggerPatterns: JSON.stringify([
        "nour_os_alignment",
        "long_term_vision",
        "purpose_reconnection",
        "aimless_feeling",
        "scattered_focus",
        "mission_clarity",
        "why_reminder",
        "direction_setting"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 14,
      title: "The Law of Conformity",
      shortTitle: "Resist the Downward Pull of the Group",
      essence:
        "In groups, people unconsciously lower their intelligence, increase their emotional reactivity, and follow the loudest voice. Group dynamics can make smart people do stupid things. Maintain your individual thinking even within a team — especially within a team.",
      shopApplication:
        "When the whole shop is having a slow day and the mood is negative, it spreads like a virus. One person complaining about customers infects the whole crew. At Nick's, be the thermostat, not the thermometer. Set the energy rather than absorbing it. In industry groups and dealer networks, resist the consensus — when everyone says 'nobody can compete on price with the chains,' that is conformist thinking. Think differently and win differently.",
      nourApplication:
        "Entrepreneur communities, Twitter threads, and coding circles all have groupthink. 'Everyone is using this stack' or 'You need to be on TikTok' are conformist signals. Your path is unconventional by definition — a 25-year-old building a personal operating system while running an auto shop. Lean into the uniqueness instead of trying to fit a template. The group will pull you toward average; your purpose pulls you toward exceptional.",
      triggerPatterns: JSON.stringify([
        "groupthink_resistance",
        "team_morale_management",
        "industry_conformity",
        "independent_thinking",
        "peer_pressure",
        "trend_following",
        "contrarian_opportunity"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 15,
      title: "The Law of Fickleness",
      shortTitle: "Make Them Want to Follow You",
      essence:
        "People are inherently fickle in their loyalty. Authority is not given by title — it is earned through consistent demonstration of competence, vision, and genuine care for those you lead. True authority makes people want to follow, not feel forced to comply.",
      shopApplication:
        "Your technicians and advisors will follow you not because you sign their checks, but because they see you arrive first, leave last, handle the hardest customers, and stand behind them when things go wrong. At Nick's, authority comes from being the owner who gets under a car when the bay is full, who takes responsibility for a comeback, and who celebrates the team's wins louder than his own. The moment the team senses you are coasting, loyalty evaporates.",
      nourApplication:
        "Leadership style defines team loyalty. Be the kind of leader people brag about working for. In your personal brand, authority comes from consistently delivering value — not from claiming expertise. Show the work, share the lessons, admit the mistakes. The followers who stay through the ugly phases are the ones worth having. Authority is a daily practice, not a one-time achievement.",
      triggerPatterns: JSON.stringify([
        "leadership_style",
        "team_loyalty",
        "authority_building",
        "employee_retention",
        "leading_by_example",
        "credibility_maintenance",
        "follower_trust",
        "leadership_consistency"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 16,
      title: "The Law of Aggression",
      shortTitle: "See the Hostility Behind the Friendly Facade",
      essence:
        "Humans are inherently aggressive, but most disguise this behind friendly social masks. Learn to recognize passive aggression, subtle sabotage, and veiled hostility. Understand your own aggressive drives and channel them productively rather than letting them leak out destructively.",
      shopApplication:
        "The competitor who sends their customers to you 'as a favor' might be dumping problem jobs. The vendor who is overly friendly during the sale may ghost you on warranty claims. At Nick's, read the aggression signals: a customer who keeps 'joking' about your prices is hostile, not playful. Address it directly but diplomatically. In the team, passive-aggressive behavior — showing up late, 'forgetting' tasks, malicious compliance — is more damaging than open conflict.",
      nourApplication:
        "Channel your competitive aggression into productive outlets — building better systems, outworking competitors, shipping faster. Do not let it leak into relationships or team dynamics as irritability or impatience. Recognize when you are being passive-aggressive yourself — saying 'it is fine' when it is not, agreeing to plans you resent. Direct honesty, even when uncomfortable, prevents the slow poison of suppressed aggression.",
      triggerPatterns: JSON.stringify([
        "passive_aggression",
        "competitor_hostility",
        "hidden_agenda",
        "workplace_conflict",
        "customer_hostility",
        "aggressive_channeling",
        "direct_confrontation"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 17,
      title: "The Law of Generational Myopia",
      shortTitle: "Seize the Historical Moment",
      essence:
        "Each generation reacts against the one before it, creating predictable pendulum swings in values, aesthetics, and priorities. Understanding where your generation sits in this cycle gives you strategic advantage — you can anticipate trends rather than react to them.",
      shopApplication:
        "The auto repair industry is in the middle of a generational shift. Younger customers expect digital communication, transparent pricing, and Instagram-worthy shops. Older customers expect phone calls, handshakes, and a guy they trust. At Nick's, serve both but bet on the future. The shop that masters digital-first customer experience while maintaining human touch will dominate the next decade in Cleveland.",
      nourApplication:
        "You are Gen Z building in a landscape shaped by Millennials. Your advantage: you understand technology natively, move faster, and have less legacy baggage. The historical moment is perfect for someone building personal OS systems — the world is drowning in tools and starving for integration. Seize this window before it closes.",
      triggerPatterns: JSON.stringify([
        "generational_shift",
        "industry_trend",
        "market_timing",
        "digital_transformation",
        "customer_demographic_change",
        "future_positioning"
      ]),
    },
    {
      book: "HUMAN_NATURE" as const,
      number: 18,
      title: "The Law of Death Denial",
      shortTitle: "Meditate on Our Common Mortality",
      essence:
        "Awareness of death is the ultimate clarifier. Most people live as if they have infinite time, which breeds complacency, pettiness, and misplaced priorities. Meditating on mortality creates urgency, gratitude, and laser focus on what actually matters.",
      shopApplication:
        "In 5 years, will this bad Google review matter? Will this $200 discount argument matter? Will this difficult employee situation matter? Mortality perspective kills pettiness and elevates strategic thinking. At Nick's, build for legacy — a shop that outlasts you, systems that run without you, a reputation that compounds over decades. Every small decision either adds to or subtracts from the legacy.",
      nourApplication:
        "You are 25. You have maybe 60 productive years left if you are lucky. That is roughly 3,000 weeks. Every week spent on the wrong thing is a week that does not come back. This is not morbid — it is clarifying. The urgency is real: build NOUR OS not because it is fun but because it is your contribution. The legacy question cuts through every distraction: 'If I had 5 years left, would I spend today like this?' If the answer is no, change what today looks like.",
      triggerPatterns: JSON.stringify([
        "urgency_reminder",
        "legacy_thinking",
        "mortality_meditation",
        "priority_clarity",
        "time_scarcity",
        "what_actually_matters",
        "five_year_test",
        "pettiness_check"
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

  console.log(`Seeded ${laws.length} Laws of Human Nature`);
}
