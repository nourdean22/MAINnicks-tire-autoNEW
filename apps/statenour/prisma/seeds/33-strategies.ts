import type { PrismaClient } from "@prisma/client";

const strategies = [
  {
    number: 1,
    title: "Declare War on Your Enemies (Polarity)",
    shortTitle: "Polarity",
    essence:
      "Life is endless battle. Know exactly who opposes you and what internal weakness threatens you—complacency, comfort, drift. Clarity of enemy creates clarity of purpose.",
    shopApplication:
      "Map every competing shop within 5 miles of Nick's Tire & Auto in Cleveland—Tire Kingdom on Pearl, the Midas on Brookpark, the independent on State Rd. Know their pricing, hours, Google reviews. But the real enemy is internal: the drift pattern where slow weeks make the crew coast, callbacks creep up, and the shop bleeds margin without anyone noticing.",
    nourApplication:
      "Nour's true enemies are complacency after a good revenue month and shiny-object syndrome pulling him away from finishing NOUR OS. Name them explicitly: the urge to start a new side project when the current sprint is 70% done, and the comfort of letting the shop run on autopilot instead of pushing growth.",
    triggerPatterns: [
      "competitor_identified",
      "complacency_detected",
      "drift_pattern",
      "unclear_opponent",
      "motivation_drop",
    ],
  },
  {
    number: 2,
    title: "Do Not Fight the Last War (Guerrilla-War-of-the-Mind)",
    shortTitle: "Mental Guerrilla",
    essence:
      "What worked before will not work again. Strategies must evolve with circumstances. The greatest danger is fighting with yesterday's assumptions in today's battlefield.",
    shopApplication:
      "The 2015 auto repair playbook—Yellow Pages ads, waiting for walk-ins, markup on cheap parts—is dead in 2026. Customers check Google reviews before they call, EV brake jobs are replacing pad slaps, and ADAS recalibration is the new alignment. Nick's Tire needs to price for the 2026 Cleveland market, not the one from ten years ago.",
    nourApplication:
      "Nour can't build NOUR OS like it's 2020—monolith SaaS with a React SPA. The 2026 stack is edge-first, AI-native, agent-driven. Every architecture decision should ask: 'Am I building for what's coming or what I already know?' Stop defaulting to patterns from old tutorials.",
    triggerPatterns: [
      "outdated_strategy",
      "market_shift",
      "old_playbook",
      "refusing_to_adapt",
      "nostalgia_bias",
    ],
  },
  {
    number: 3,
    title: "Amidst the Turmoil, Do Not Lose Your Presence of Mind",
    shortTitle: "Presence of Mind",
    essence:
      "In the heat of battle, emotions are your greatest enemy. The ability to stay calm, detach, and think clearly under pressure is the ultimate tactical advantage.",
    shopApplication:
      "A customer is screaming at the counter because his car has been in the bay for three days waiting on a back-ordered part. Two techs called off. The parts delivery is late. In that moment, panicking or snapping back loses the customer forever. Step back, speak slowly, offer a loaner or ride, and triage the day's schedule with a clear head.",
    nourApplication:
      "A production deploy breaks at 11pm, the shop had a $2K comeback, and a key feature deadline is tomorrow. Nour's instinct is to rage-code a fix or spiral. Instead: close the laptop for 5 minutes, write down the three problems in order of severity, and attack them sequentially. Calm is a competitive advantage.",
    triggerPatterns: [
      "emotional_reaction",
      "crisis_mode",
      "panic_detected",
      "anger_spike",
      "overwhelm",
    ],
  },
  {
    number: 4,
    title: "Create a Sense of Urgency and Desperation (Death Ground)",
    shortTitle: "Death Ground",
    essence:
      "Place yourself in situations where retreat is impossible and you must fight with everything you have. Comfort breeds mediocrity; desperation breeds greatness.",
    shopApplication:
      "Announce the shop's grand re-opening date publicly before the renovation is done. Tell 50 customers the new waiting lounge opens March 15th. Now there's no option to let the project slide. Book the tire sale radio ad before inventory arrives—the pressure to execute makes the team move.",
    nourApplication:
      "Nour should announce NOUR OS launch dates to real users, commit to a demo for a potential investor, or sign a client for a feature that isn't built yet. Burn the boats. The $800/month server bill with no revenue is death ground—use it as fuel, not anxiety.",
    triggerPatterns: [
      "comfort_zone",
      "procrastination",
      "no_deadline",
      "low_urgency",
      "stalling",
    ],
  },
  {
    number: 5,
    title: "Avoid the Snares of Groupthink (Command and Control)",
    shortTitle: "Command & Control",
    essence:
      "A clear chain of command with one unified vision beats democratic chaos. Lead decisively. Delegate authority but never abdicate strategic direction.",
    shopApplication:
      "When three techs argue about whether to upsell the brake flush or just do pads, the shop floor grinds to a halt. Nick's needs a clear protocol: service advisor makes the recommendation, tech executes, manager reviews callbacks weekly. Morning huddle sets the day's priorities—one voice, one plan, then everyone executes.",
    nourApplication:
      "Nour is the sole architect of NOUR OS. When he crowd-sources architecture decisions in Discord or lets every suggestion reshape the roadmap, the project drifts. Set the vision, decide the stack, write the spec, then execute. Feedback is input, not command.",
    triggerPatterns: [
      "decision_paralysis",
      "too_many_opinions",
      "unclear_authority",
      "staff_conflict",
      "leadership_vacuum",
    ],
  },
  {
    number: 6,
    title: "Segment Your Forces (Controlled Chaos)",
    shortTitle: "Controlled Chaos",
    essence:
      "Divide your forces into semi-independent units that can operate on their own while coordinating toward the larger objective. Flexibility and speed come from decentralization.",
    shopApplication:
      "Split the shop into autonomous pods: Bay 1-2 handle tires and alignments, Bay 3-4 handle brakes and suspension, Bay 5 is diagnostics and electrical. Each pod has a lead tech who owns throughput. They don't wait for the service advisor to micromanage every job—they self-direct within their zone.",
    nourApplication:
      "Segment NOUR OS development into independent modules: the agent layer, the dashboard, the Prisma data layer, the integration hub. Each can be developed, tested, and shipped independently. Don't let a bug in the Ring integration block progress on the Tuya dashboard.",
    triggerPatterns: [
      "bottleneck_detected",
      "single_point_failure",
      "over_centralized",
      "scaling_needed",
      "team_too_coupled",
    ],
  },
  {
    number: 7,
    title: "Transform Your War into a Crusade (Morale)",
    shortTitle: "Morale Crusade",
    essence:
      "People fight hardest when they believe in a cause larger than themselves. Give your team a mission, a shared identity, and something worth fighting for beyond a paycheck.",
    shopApplication:
      "Nick's Tire isn't just changing oil—it's keeping Cleveland families safe on the road. Morning huddles should celebrate wins: 'We caught a ball joint about to fail on a minivan with three car seats yesterday.' Put customer thank-you notes on the wall. Create the identity: 'We're the shop that gives a damn.'",
    nourApplication:
      "NOUR OS isn't just a home automation dashboard—it's Nour proving that a 25-year-old from Cleveland can build enterprise-grade software while running a physical business. The mission is sovereignty: owning your own data, your own tools, your own future. That story fuels the late nights.",
    triggerPatterns: [
      "team_morale_low",
      "motivation_drop",
      "purpose_unclear",
      "burnout_risk",
      "celebrating_wins",
    ],
  },
  {
    number: 8,
    title: "Pick Your Battles Carefully",
    shortTitle: "Pick Battles",
    essence:
      "Not every fight is worth fighting. Conserve energy and resources for battles you can win and that matter strategically. Walk away from traps and distractions.",
    shopApplication:
      "The customer who wants a full engine rebuild on a 2004 Cavalier for $500 is not your battle. The fleet manager with 12 vans who needs a reliable maintenance partner—that's the fight worth winning. Stop chasing Craigslist cheapskates and start courting commercial accounts and dealership overflow work.",
    nourApplication:
      "Don't fight Twitter arguments about framework choices. Don't rebuild the auth system for the third time. Don't chase every feature request. Pick the three things that move NOUR OS toward its first paying user and ignore everything else this sprint.",
    triggerPatterns: [
      "distraction_detected",
      "low_value_fight",
      "resource_waste",
      "scope_creep",
      "wrong_customer",
    ],
  },
  {
    number: 9,
    title: "Turn the Tables (Counterattack)",
    shortTitle: "Counterattack",
    essence:
      "Let your opponent make the first move, absorb it, then strike back with decisive force. The counterattack carries psychological power—turning their aggression into your advantage.",
    shopApplication:
      "A competitor starts running '$19.99 oil change' ads on Google targeting Nick's Tire keywords. Don't race to the bottom. Let them attract the price shoppers, then counterattack with a '$49.99 Full Inspection + Oil Change' bundle that positions Nick's as the premium choice. Their cheap ad becomes your quality contrast.",
    nourApplication:
      "When a competing dashboard tool launches a flashy feature Nour was planning, don't panic-ship a half-built version. Wait, study their implementation, note the gaps and complaints in reviews, then build the version that actually works. Second-mover advantage with better execution.",
    triggerPatterns: [
      "competitor_attack",
      "market_aggression",
      "price_war",
      "reactive_pressure",
      "timing_opportunity",
    ],
  },
  {
    number: 10,
    title: "Create a Threatening Presence (Deterrence)",
    shortTitle: "Deterrence",
    essence:
      "The best way to win a war is to make your enemy afraid to start one. Build a reputation so strong that competitors think twice before challenging you.",
    shopApplication:
      "Stack 500+ five-star Google reviews. Put ASE certifications on the wall where every customer sees them. Post before/after repair photos on social media weekly. When a new quick-lube opens nearby, they see Nick's Tire's dominance online and think twice about competing on quality.",
    nourApplication:
      "Build in public. Ship features weekly and post about them. Make NOUR OS's GitHub activity, blog posts, and demo videos so prolific that anyone thinking about building a competing smart-home OS for small business owners sees a project that's already miles ahead.",
    triggerPatterns: [
      "reputation_building",
      "new_competitor",
      "market_positioning",
      "brand_strength",
      "intimidation_needed",
    ],
  },
  {
    number: 11,
    title: "Trade Space for Time",
    shortTitle: "Space for Time",
    essence:
      "When you cannot win now, retreat strategically. Give up territory to buy time, regroup, and come back stronger. Patience and survival matter more than pride.",
    shopApplication:
      "If a national chain undercuts tire pricing by 30% with a loss-leader campaign, don't try to match it and bleed cash. Temporarily concede tire-only customers, focus the shop on higher-margin services like diagnostics, ADAS calibration, and suspension work. When the chain's promo ends, the quality customers come back.",
    nourApplication:
      "If NOUR OS can't compete with Home Assistant's plugin ecosystem right now, don't try. Focus on the narrow vertical—auto shop + smart home integration—that nobody else is building. Concede the general market to buy time to dominate the niche.",
    triggerPatterns: [
      "overextended",
      "losing_battle",
      "need_retreat",
      "buying_time",
      "strategic_patience",
    ],
  },
  {
    number: 12,
    title: "Lose Battles but Win the War (Grand Strategy)",
    shortTitle: "Grand Strategy",
    essence:
      "Keep your eyes on the long-term objective. Individual losses are acceptable if they serve the larger victory. Never sacrifice the war to win a battle.",
    shopApplication:
      "Eat the cost of a $400 comeback repair without arguing, even when the tech did it right and the part failed. That customer tells five friends Nick's Tire stands behind their work. The $400 loss buys $4,000 in lifetime value. Grand strategy: build a reputation that compounds over years.",
    nourApplication:
      "Spending three months refactoring NOUR OS's data layer feels like losing—no new features, no visible progress. But the grand strategy is a system that scales to 100 agents without breaking. Accept the short-term pain for the long-term architecture win.",
    triggerPatterns: [
      "short_term_loss",
      "long_term_thinking",
      "strategic_sacrifice",
      "big_picture",
      "patience_required",
    ],
  },
  {
    number: 13,
    title: "Know Your Enemy",
    shortTitle: "Know Enemy",
    essence:
      "Intelligence wins wars. Study your opponents obsessively—their strengths, weaknesses, habits, and blind spots. The more you know, the less you guess.",
    shopApplication:
      "Secret-shop every competitor within 10 miles. Call for quotes on a brake job, time their response, note their phone manner, check their waiting room. Read every one-star review they have on Google. Know that the Midas on Brookpark has a 2-hour wait on Saturdays and their alignment machine is always down—that's where Nick's Tire wins.",
    nourApplication:
      "Study every competing smart-home platform deeply: Home Assistant's architecture, Hubitat's offline-first approach, Apple HomeKit's UX. Read their GitHub issues, subreddit complaints, and Discord pain points. Build NOUR OS to solve the problems they ignore.",
    triggerPatterns: [
      "competitor_intelligence",
      "market_research",
      "blind_spot",
      "unknown_threat",
      "strategic_reconnaissance",
    ],
  },
  {
    number: 14,
    title: "Overwhelm Resistance with Speed and Suddenness (Blitzkrieg)",
    shortTitle: "Blitzkrieg",
    essence:
      "Strike fast, strike hard, before the enemy can react. Speed creates shock, overwhelms defenses, and seizes the initiative before resistance can organize.",
    shopApplication:
      "When October hits Cleveland, launch the winter tire campaign in one explosive week: email blast to the entire customer list Monday, Google Ads live Tuesday, sidewalk signs Wednesday, radio spot Thursday. Don't trickle it out over a month—hit hard before Discount Tire runs their seasonal ad. First-mover on the season wins.",
    nourApplication:
      "When a key feature is ready, don't soft-launch over two weeks. Ship it Friday night, post the demo Saturday morning, email the waitlist Saturday afternoon, push the Product Hunt launch Monday. Compressed execution creates momentum and buzz that a slow rollout never achieves.",
    triggerPatterns: [
      "speed_opportunity",
      "seasonal_campaign",
      "launch_window",
      "first_mover",
      "marketing_blitz",
    ],
  },
  {
    number: 15,
    title: "Control the Dynamic",
    shortTitle: "Control Dynamic",
    essence:
      "Force your opponent to react to you, never the reverse. Set the tempo, choose the terrain, and make the enemy play your game instead of theirs.",
    shopApplication:
      "Don't wait for customers to call when something breaks. Send proactive maintenance reminders at 3K-mile intervals. Run a 'Pre-Winter Inspection' campaign before the first freeze. Nick's Tire sets the schedule—customers respond to the shop's rhythm, not the other way around.",
    nourApplication:
      "Set the development cadence: two-week sprints with a demo every other Friday. Don't let user requests or bug reports dictate the roadmap reactively. Nour decides what ships when, publishes the roadmap, and lets users follow the plan—not chase fires.",
    triggerPatterns: [
      "losing_initiative",
      "reactive_mode",
      "opponent_leading",
      "tempo_control",
      "agenda_setting",
    ],
  },
  {
    number: 16,
    title: "Hit Them Where It Hurts (Center-of-Gravity)",
    shortTitle: "Center of Gravity",
    essence:
      "Identify the one thing that holds your enemy together—their center of gravity—and strike it. Collapse the support structure and the whole operation falls.",
    shopApplication:
      "The competitor's center of gravity is their one good mechanic. If he leaves, their Google reviews tank and customers flee. Nick's Tire doesn't poach—but it makes sure its own center of gravity (reputation + skilled techs) is unassailable. Pay top techs above market, treat them well, and watch competitors struggle to staff.",
    nourApplication:
      "For a competing product, the center of gravity might be their cloud dependency. Build NOUR OS to run fully offline/local-first, and every time the competitor has an outage, Nour's pitch gets stronger. Attack the architectural weakness they can't easily fix.",
    triggerPatterns: [
      "critical_vulnerability",
      "leverage_point",
      "structural_weakness",
      "key_dependency",
      "strategic_target",
    ],
  },
  {
    number: 17,
    title: "Defeat Them in Detail (Divide and Conquer)",
    shortTitle: "Divide & Conquer",
    essence:
      "Never fight the whole enemy at once. Separate them into smaller, manageable pieces and defeat each one individually before they can reunite.",
    shopApplication:
      "Don't try to win the entire Cleveland auto repair market at once. Dominate one zip code first—own 44109 with door hangers, local sponsorships, and neighborhood Facebook groups. Once that's locked down, expand to 44102, then 44111. Conquer block by block.",
    nourApplication:
      "Don't build NOUR OS as one massive monolithic launch. Ship the Tuya integration first and get it perfect. Then Ring. Then Eufy. Then the unified dashboard. Each module is a small victory that builds toward the complete platform.",
    triggerPatterns: [
      "overwhelming_scope",
      "too_many_fronts",
      "need_focus",
      "market_segmentation",
      "incremental_conquest",
    ],
  },
  {
    number: 18,
    title: "Expose and Attack Your Opponent's Soft Flank",
    shortTitle: "Soft Flank",
    essence:
      "Every opponent has an unprotected side—a weakness they don't even realize is exposed. Find it and strike there instead of attacking their strengths head-on.",
    shopApplication:
      "The big chain shops have great prices but terrible customer experience—long waits, upsell pressure, impersonal service. That's their soft flank. Nick's Tire attacks with same-day callbacks, first-name greetings, and a clean waiting room with real coffee. Don't compete on price; compete where they're weakest.",
    nourApplication:
      "Home Assistant's soft flank is its brutal setup complexity—YAML files, breaking changes, intimidating for non-devs. NOUR OS can attack by making the onboarding experience dead simple: plug in, scan devices, dashboard auto-generates. Win where the incumbent can't easily improve.",
    triggerPatterns: [
      "competitor_weakness",
      "indirect_approach",
      "flanking_opportunity",
      "undefended_area",
      "asymmetric_advantage",
    ],
  },
  {
    number: 19,
    title: "Envelop the Enemy (Annihilation)",
    shortTitle: "Envelopment",
    essence:
      "Attack from multiple directions simultaneously so the enemy cannot defend any single point effectively. Surround them with overwhelming pressure from all angles.",
    shopApplication:
      "Win the customer from every angle: Google reviews dominate local search, the website answers every FAQ, the shop texts appointment reminders, the waiting room has WiFi and snacks, the invoice includes a handwritten thank-you. Every touchpoint reinforces the choice. The customer is enveloped in quality—they'll never try another shop.",
    nourApplication:
      "Make NOUR OS indispensable from every angle: it controls the lights, monitors the cameras, tracks shop metrics, sends alerts, and generates reports. Once a user relies on it for five different things, switching cost is too high. Envelop them in utility.",
    triggerPatterns: [
      "multi_front_attack",
      "total_coverage",
      "customer_retention",
      "ecosystem_lock",
      "comprehensive_strategy",
    ],
  },
  {
    number: 20,
    title: "Maneuver Them into Weakness (Ripening for the Sickle)",
    shortTitle: "Ripen for Sickle",
    essence:
      "Before striking, maneuver your opponent into a position of weakness through subtle moves. Make them overextend, overreact, or commit to a bad position before you attack.",
    shopApplication:
      "When a competitor starts offering deep discounts to steal customers, don't react. Let them burn cash for two months. Meanwhile, quietly sign up their best techs who are tired of the chaos. When they've overextended on marketing spend and lost their talent, their quality drops and the customers come to Nick's on their own.",
    nourApplication:
      "If a competing platform tries to match NOUR OS's features by rushing half-baked releases, let them. Their bugs and instability ripen them for the sickle. Nour stays disciplined, ships stable code, and waits for the wave of frustrated users looking for something that actually works.",
    triggerPatterns: [
      "patience_strategy",
      "opponent_overextending",
      "positioning_advantage",
      "setup_move",
      "letting_them_fail",
    ],
  },
  {
    number: 21,
    title: "Negotiate While Advancing (Diplomatic War)",
    shortTitle: "Diplomatic War",
    essence:
      "Never stop moving forward just because you're in negotiations. Keep building leverage even as you talk. The stronger your position grows, the better your terms.",
    shopApplication:
      "While negotiating a parts supply deal with a vendor, simultaneously get quotes from two other suppliers and let the vendor know. While discussing a lease renewal with the landlord, have a backup location scouted. Never negotiate from a standstill—always have forward momentum and alternatives.",
    nourApplication:
      "While talking to a potential investor or partner about NOUR OS, keep shipping features. Every week the conversation continues, the product gets stronger and Nour's leverage improves. Never pause development to 'wait for the deal'—advance on all fronts simultaneously.",
    triggerPatterns: [
      "negotiation_active",
      "deal_in_progress",
      "leverage_building",
      "partnership_talks",
      "never_stop_advancing",
    ],
  },
  {
    number: 22,
    title: "Know How to End Things (Exit Strategy)",
    shortTitle: "Exit Strategy",
    essence:
      "Every engagement must have a clear endpoint. Know when to stop, how to disengage, and what victory looks like before you start. Wars without exit strategies become quagmires.",
    shopApplication:
      "Before taking on a problem customer's car with a known electrical gremlin, define the exit: 'We'll spend 2 hours on diagnostics max. If we can't isolate it, we refer to the dealer and charge the diag fee.' Without that boundary, the car sits in the bay for three days eating labor hours with no resolution.",
    nourApplication:
      "Before starting any NOUR OS feature, define 'done.' If a feature takes more than two sprints with no clear path to completion, kill it or shelve it. The graveyard of half-built features is worse than never starting them. Set exit criteria before writing line one.",
    triggerPatterns: [
      "no_exit_plan",
      "endless_project",
      "sunk_cost",
      "need_boundaries",
      "quagmire_risk",
    ],
  },
  {
    number: 23,
    title: "Weave a Seamless Blend of Fact and Fiction (Misperception)",
    shortTitle: "Misperception",
    essence:
      "Control what others see and believe. Shape perceptions through selective revelation. Make your strengths seem greater and your weaknesses invisible.",
    shopApplication:
      "The shop has three bays and five employees, but the website, branding, and customer experience should feel like a 10-bay operation. Professional photos, a polished online booking system, branded uniforms, and a clean facility create the perception of scale. Customers don't count bays—they feel professionalism.",
    nourApplication:
      "NOUR OS is built by one developer, but the landing page, documentation, and demo videos should feel like a well-funded team built it. Professional design, consistent branding, and a polished onboarding flow create the perception of a mature product. Ship perception alongside substance.",
    triggerPatterns: [
      "perception_management",
      "brand_image",
      "appearing_larger",
      "strategic_communication",
      "narrative_control",
    ],
  },
  {
    number: 24,
    title: "Take the Line of Least Expectation",
    shortTitle: "Least Expectation",
    essence:
      "Attack where your opponent least expects it. The unconventional approach succeeds because defenses are built against the obvious. Surprise is a force multiplier.",
    shopApplication:
      "Every shop markets on price and speed. Nick's Tire surprises by marketing on education—free YouTube videos explaining what brake wear looks like, Instagram reels showing how to check tire tread depth. Customers don't expect a repair shop to teach them, and that unexpected value builds massive trust and loyalty.",
    nourApplication:
      "Every smart-home platform competes on device count and integrations. NOUR OS takes the unexpected line: AI-powered anomaly detection that tells you your HVAC is failing before it breaks. Nobody expects a home automation tool to be predictive. That surprise factor becomes the differentiator.",
    triggerPatterns: [
      "unconventional_approach",
      "surprise_strategy",
      "breaking_pattern",
      "creative_disruption",
      "unexpected_angle",
    ],
  },
  {
    number: 25,
    title: "Occupy the Moral High Ground",
    shortTitle: "Moral High Ground",
    essence:
      "Position yourself as the righteous party. When you hold the moral high ground, opponents who attack you look petty and your cause gains supporters naturally.",
    shopApplication:
      "Nick's Tire's brand is radical honesty: 'We'll tell you what you actually need, not what makes us the most money.' Post the diagnostic findings with photos before recommending work. If the brakes have 40% life left, say so—don't upsell. When competitors oversell, customers hear about it and come to the shop that told them the truth.",
    nourApplication:
      "Position NOUR OS on the moral high ground of data sovereignty: 'Your home data stays on your hardware, not our cloud.' In an era of smart-home privacy scandals, this isn't just a feature—it's a moral position that makes competitors look exploitative by comparison.",
    triggerPatterns: [
      "brand_positioning",
      "honesty_policy",
      "trust_building",
      "ethical_advantage",
      "reputation_defense",
    ],
  },
  {
    number: 26,
    title: "Deny Them Targets (Strategy of the Void)",
    shortTitle: "Strategy of Void",
    essence:
      "When attacked, become formless and elusive. Give the enemy nothing to strike. Frustrate them by refusing to engage on their terms until they exhaust themselves.",
    shopApplication:
      "When a customer leaves a nasty Google review full of lies, don't get into a public argument. Respond once with calm professionalism, offer to resolve it offline, and move on. The angry reviewer punches at void—there's nothing to fight. Meanwhile, the professional response makes Nick's Tire look better to everyone reading.",
    nourApplication:
      "When online critics attack NOUR OS's tech stack choices or architecture decisions, don't engage in flame wars. Let the work speak. Keep shipping, keep improving, and let critics exhaust themselves arguing with silence while the product gets better every week.",
    triggerPatterns: [
      "under_attack",
      "negative_review",
      "online_criticism",
      "public_conflict",
      "refusing_engagement",
    ],
  },
  {
    number: 27,
    title: "Seem to Work for the Interests of Others (Alliance)",
    shortTitle: "Alliance Strategy",
    essence:
      "Build alliances by making others believe you serve their interests. The best partnerships feel mutually beneficial even when they strategically favor you.",
    shopApplication:
      "Partner with local car dealerships: 'We'll handle your overflow warranty work and send customers back to you for new car sales.' The dealer thinks they're getting free overflow capacity. Nick's Tire gets a steady stream of paying warranty jobs and builds relationships with dealer customers who eventually bring their personal cars too.",
    nourApplication:
      "Contribute to open-source projects that NOUR OS depends on. It looks altruistic, but every upstream contribution makes NOUR OS's dependencies more stable. Partner with device manufacturers for 'certified compatible' status—they get wider adoption, Nour gets credibility and early API access.",
    triggerPatterns: [
      "partnership_opportunity",
      "alliance_building",
      "mutual_benefit",
      "strategic_relationship",
      "win_win_framing",
    ],
  },
  {
    number: 28,
    title: "Give Your Rivals Enough Rope to Hang Themselves",
    shortTitle: "Enough Rope",
    essence:
      "Sometimes the best strategy is to step back and let your opponents defeat themselves through their own overconfidence, greed, or poor decisions.",
    shopApplication:
      "A new shop opens on the same block offering insanely cheap prices to steal customers. Don't panic. Give it six months—they'll burn through cash, cut corners on parts, get bad reviews, and either raise prices or close. Nick's Tire stays steady, keeps quality high, and picks up the disillusioned customers afterward.",
    nourApplication:
      "A competitor raises $5M and promises to build everything NOUR OS does but bigger. Let them. Venture-funded smart-home startups have a 90% failure rate. They'll over-hire, over-promise, and pivot three times. Nour stays lean, profitable from day one, and outlasts them by not needing permission to exist.",
    triggerPatterns: [
      "competitor_overreach",
      "rival_mistakes",
      "patience_pays",
      "self_destruction",
      "watching_and_waiting",
    ],
  },
  {
    number: 29,
    title: "Take Small Bites (Fait Accompli)",
    shortTitle: "Small Bites",
    essence:
      "Advance in small, incremental steps that are each too minor to provoke a strong response but collectively achieve a massive objective. Fait accompli—by the time anyone notices, it's done.",
    shopApplication:
      "Don't announce a massive shop renovation that scares the landlord and overwhelms the crew. Instead: repaint the waiting room one weekend, add new signage the next, upgrade the POS system quietly, swap out one lift at a time. In three months, the shop is transformed and nobody had a reason to push back on any single change.",
    nourApplication:
      "Don't plan a massive NOUR OS v2.0 rewrite. Instead: improve one API endpoint per day, add one test per commit, refactor one component per sprint. In six months, the entire codebase is modernized through small bites that never required a risky big-bang migration.",
    triggerPatterns: [
      "incremental_improvement",
      "small_wins",
      "avoiding_resistance",
      "gradual_change",
      "fait_accompli",
    ],
  },
  {
    number: 30,
    title: "Penetrate Their Minds (Communication)",
    shortTitle: "Mind Penetration",
    essence:
      "The ultimate victory is won in the mind. Influence how others think, frame their choices, and shape their perception of reality. Communication is the deepest form of warfare.",
    shopApplication:
      "Train service advisors to frame repairs in terms of safety, not cost: 'These brake pads are at 2mm—that's metal on metal in about 1,000 miles, and that turns a $250 pad job into a $900 rotor replacement.' The customer now sees the repair as saving money, not spending it. Frame the narrative.",
    nourApplication:
      "Position NOUR OS in users' minds not as 'another dashboard' but as 'your personal operations system.' Every blog post, demo, and conversation should frame it as the command center for their entire life—not a gadget controller. Once that mental frame is set, competitors are just 'dashboards.'",
    triggerPatterns: [
      "framing_opportunity",
      "narrative_shaping",
      "persuasion_needed",
      "customer_communication",
      "mental_positioning",
    ],
  },
  {
    number: 31,
    title: "Destroy from Within (Inner Front)",
    shortTitle: "Inner Front",
    essence:
      "The most devastating attacks come from inside. Infiltrate, influence, and erode from within. Conversely, protect yourself from internal threats that can destroy everything.",
    shopApplication:
      "The biggest threat to Nick's Tire isn't the competition—it's a toxic employee poisoning morale from within. One tech who complains constantly, cuts corners, and turns other employees negative can destroy a shop faster than any competitor. Identify internal rot early, address it directly, and remove it if it doesn't change.",
    nourApplication:
      "NOUR OS's inner front threat is technical debt that silently destroys the codebase from within. Skipped tests, hardcoded secrets, unhandled edge cases—they compound until the system is fragile. Run regular internal audits. The enemy within is more dangerous than any external competitor.",
    triggerPatterns: [
      "internal_threat",
      "toxic_employee",
      "technical_debt",
      "cultural_rot",
      "insider_problem",
    ],
  },
  {
    number: 32,
    title: "Dominate While Seeming to Submit (Passive Aggression)",
    shortTitle: "Passive Dominance",
    essence:
      "Appear to yield while actually maintaining control. Let others think they're in charge while you subtly steer outcomes. Overt dominance creates resistance; covert influence creates compliance.",
    shopApplication:
      "When a difficult customer insists they know what's wrong with their car ('It's definitely the alternator'), don't argue. Say 'You might be right—let's confirm with a quick test.' Run the diagnostics, show them it's actually the battery, and now they feel heard while you've guided them to the correct (and more profitable) repair without a confrontation.",
    nourApplication:
      "When a potential partner or investor suggests a 'better' technical direction for NOUR OS, don't push back openly. Acknowledge the idea, prototype it quickly, show why the current approach works better with data, and let them feel like they contributed to the decision. Submit on the surface, dominate on the outcome.",
    triggerPatterns: [
      "power_dynamics",
      "subtle_control",
      "avoiding_confrontation",
      "influence_over_authority",
      "soft_power",
    ],
  },
  {
    number: 33,
    title: "Sow Uncertainty and Panic (Chain Reaction/Terror)",
    shortTitle: "Chain Reaction",
    essence:
      "A single bold action can trigger a cascade of fear and uncertainty in your opponents. The psychological impact of one decisive strike often exceeds the material damage. Use sparingly and strategically.",
    shopApplication:
      "When Nick's Tire lands the biggest fleet contract in the neighborhood—say, the local municipality's vehicle maintenance—every competing shop hears about it. That one win signals dominance and makes competitors question whether they can keep up. One bold move reshapes the competitive landscape without needing to fight each rival individually.",
    nourApplication:
      "Ship one jaw-dropping feature that nobody expected—like real-time AI diagnostics that predict device failures 48 hours in advance. One breakthrough feature creates a chain reaction: tech blogs pick it up, users flood in, competitors scramble to respond. A single bold move shifts the entire market perception.",
    triggerPatterns: [
      "bold_move",
      "shock_and_awe",
      "cascade_effect",
      "psychological_warfare",
      "decisive_action",
    ],
  },
];

export async function seed33Strategies(prisma: PrismaClient) {
  console.log("Seeding 33 Strategies of War...");

  for (const strategy of strategies) {
    await prisma.strategicLaw.upsert({
      where: {
        book_number: {
          book: "THIRTY_THREE_STRATEGIES",
          number: strategy.number,
        },
      },
      update: {
        title: strategy.title,
        shortTitle: strategy.shortTitle,
        essence: strategy.essence,
        shopApplication: strategy.shopApplication,
        nourApplication: strategy.nourApplication,
        triggerPatterns: strategy.triggerPatterns,
      },
      create: {
        book: "THIRTY_THREE_STRATEGIES",
        number: strategy.number,
        title: strategy.title,
        shortTitle: strategy.shortTitle,
        essence: strategy.essence,
        shopApplication: strategy.shopApplication,
        nourApplication: strategy.nourApplication,
        triggerPatterns: strategy.triggerPatterns,
      },
    });
  }

  console.log(`Seeded ${strategies.length} strategies of war.`);
}
