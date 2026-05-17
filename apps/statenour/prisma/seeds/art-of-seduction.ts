import type { PrismaClient } from "@prisma/client";

const seductionLaws = [
  {
    number: 1,
    title: "Choose the Right Victim",
    shortTitle: "Right Target",
    essence:
      "Not everyone is worth pursuing. The ideal target is someone already dissatisfied, searching for something, open to influence. Wasting energy on the wrong person drains resources and yields nothing. Identify who is ready to be drawn in.",
    shopApplication:
      "Nick's Tire & Auto shouldn't chase every driver in Cleveland—target the ones already unhappy with their current shop. Look for Google reviewers leaving 1-star reviews at competitors, people posting in Cleveland Facebook groups asking for honest mechanic recommendations, and fleet managers frustrated with unreliable service. These are the customers primed to switch and stay loyal.",
    nourApplication:
      "Nour should not market NOUR OS to everyone with a small business. The ideal early adopter is a tech-curious shop owner already using spreadsheets and frustrated with expensive, clunky software. Find them in auto repair forums, local business meetups, and Reddit threads complaining about shop management tools. Selling to someone who doesn't feel the pain yet is wasted motion.",
    triggerPatterns: [
      "target_audience_undefined",
      "low_conversion_rate",
      "wrong_customer_fit",
      "wasted_outreach",
      "lead_qualification",
    ],
  },
  {
    number: 2,
    title: "Create a False Sense of Security — Approach Indirectly",
    shortTitle: "Indirect Approach",
    essence:
      "A direct, aggressive pitch triggers defenses. Approach sideways—appear as a friend, advisor, or neutral party first. Lower their guard before revealing your intent. The best persuasion doesn't feel like persuasion.",
    shopApplication:
      "Don't cold-call fleet managers with a sales pitch. Instead, offer a free 12-point fleet inspection or host a 'Winter Tire Safety' workshop at a local business park. Position Nick's as a helpful expert first, not a vendor trying to close. By the time you mention service packages, they already trust you.",
    nourApplication:
      "Nour shouldn't lead with 'buy my software.' Instead, publish genuinely useful content—a YouTube breakdown of how to read a P&L as a shop owner, a free tire shop KPI dashboard template. Let the audience discover NOUR OS organically through value-first content. The product pitch comes after credibility is established.",
    triggerPatterns: [
      "hard_sell_failing",
      "customer_resistance",
      "cold_outreach",
      "trust_deficit",
      "aggressive_pitch",
    ],
  },
  {
    number: 3,
    title: "Send Mixed Signals",
    shortTitle: "Mixed Signals",
    essence:
      "Predictability is the enemy of fascination. If people can categorize you instantly, they lose interest. Combine contradictory qualities—toughness with warmth, expertise with humility—to create intrigue and keep attention.",
    shopApplication:
      "Nick's Tire should break the stereotype of the greasy, intimidating auto shop. Put an espresso machine in the waiting area, keep the bays spotless, but let the techs' raw mechanical skill speak for itself. A shop that looks like a boutique but performs like a pit crew creates cognitive dissonance that customers talk about and remember.",
    nourApplication:
      "Nour's personal brand should defy easy categorization. He's a tire shop operator who builds AI-native software—that contradiction is the brand. Lean into it: post a reel of pulling a tire off a rim, then cut to deploying code. The 'blue-collar tech founder' signal is memorable precisely because it doesn't fit a clean box.",
    triggerPatterns: [
      "brand_too_predictable",
      "losing_attention",
      "category_trap",
      "audience_boredom",
      "differentiation_needed",
    ],
  },
  {
    number: 4,
    title: "Appear to Be an Object of Desire — Create Triangles",
    shortTitle: "Create Triangles",
    essence:
      "People want what others want. If you are seen as desired by many, your value rises. Create the impression of demand—social proof, waitlists, visible popularity—and new prospects will pursue you.",
    shopApplication:
      "Display the wall of 5-star Google reviews prominently in the shop and on the website. Post photos of full bays and a packed schedule. When a customer calls and the earliest opening is Thursday, that scarcity signals demand. Run a 'Customer of the Month' feature on social media showing happy customers—each post is social proof that pulls in the next customer.",
    nourApplication:
      "Nour should manufacture visible demand for NOUR OS before launch. A public waitlist counter, testimonials from beta users, screenshots of Slack channels buzzing with early adopters—all create triangulation. When a prospect sees others excited, they stop evaluating features and start fearing they'll miss out.",
    triggerPatterns: [
      "low_social_proof",
      "no_waitlist_urgency",
      "demand_invisible",
      "competitor_preferred",
      "credibility_gap",
    ],
  },
  {
    number: 5,
    title: "Create a Need — Stir Anxiety and Discontent",
    shortTitle: "Stir Discontent",
    essence:
      "People rarely act when comfortable. To move them, surface the pain they've been ignoring. Make them aware of what they're missing, what's at risk, what's quietly failing. Discomfort precedes action.",
    shopApplication:
      "Most drivers ignore their tires until a blowout. Run a Cleveland winter safety campaign showing tread depth data and stopping distances on wet roads. Free tread-depth checks with a printed report showing exactly where they stand create urgency from data, not fear-mongering. Make the invisible risk visible and quantifiable.",
    nourApplication:
      "Nour's content strategy should surface the hidden costs of running a shop without data. 'You lost $14,000 last year to parts markup inconsistency and you didn't even know it.' Position NOUR OS not as nice-to-have software but as the thing that stops the silent bleeding. Make the status quo feel dangerous.",
    triggerPatterns: [
      "customer_complacent",
      "no_urgency",
      "pain_unrecognized",
      "status_quo_comfortable",
      "need_creation",
    ],
  },
  {
    number: 6,
    title: "Master the Art of Insinuation",
    shortTitle: "Insinuation",
    essence:
      "The most powerful messages are the ones people feel they discovered themselves. Plant seeds indirectly—hints, questions, suggestive data—and let the target draw their own conclusions. What people convince themselves of, they believe deeply.",
    shopApplication:
      "Instead of telling a customer they need new brakes, show them the brake pad measurement and say 'You've got about 2mm left—most people replace at 3mm, but it's your call.' The insinuation that they're already past the threshold does more than a hard sell ever could. Let the customer feel like they made the decision.",
    nourApplication:
      "In sales conversations for NOUR OS, don't say 'your current system is bad.' Ask questions: 'How long does it take you to pull last month's labor margin? Do you know your average ticket by tech?' The gaps in their answers insinuate the problem. They sell themselves on the solution before Nour ever pitches it.",
    triggerPatterns: [
      "direct_pitch_rejected",
      "customer_defensive",
      "seed_planting",
      "subtle_influence",
      "self_persuasion",
    ],
  },
  {
    number: 7,
    title: "Enter Their Spirit",
    shortTitle: "Enter Their Spirit",
    essence:
      "Mirror the other person's values, mood, and worldview. People are drawn to those who seem to understand them deeply. Adapt to their frequency before trying to change it. Empathy is a strategic instrument.",
    shopApplication:
      "When a single mom comes in worried about a $900 repair bill, don't start with the technical breakdown. Start with 'I know this isn't what you wanted to hear today—let me show you what absolutely has to be done now versus what can wait 60 days.' Meeting her emotional state first builds the trust that keeps her coming back for every future repair.",
    nourApplication:
      "When Nour talks to potential NOUR OS customers, he should mirror their language and frustrations. If a shop owner says 'I'm drowning in paperwork,' don't respond with technical jargon about workflow automation. Say 'Yeah, that's the worst part of running a shop—the stuff that has nothing to do with fixing cars.' Match their spirit first, then introduce the solution.",
    triggerPatterns: [
      "empathy_gap",
      "customer_misread",
      "tone_mismatch",
      "rapport_missing",
      "perspective_taking",
    ],
  },
  {
    number: 8,
    title: "Create Temptation",
    shortTitle: "Create Temptation",
    essence:
      "Dangle something just out of reach—a vision of what could be, a taste of a better future. People are motivated more by what they almost have than by what they already possess. Make the reward vivid and tantalizingly close.",
    shopApplication:
      "Offer a free alignment check and show the customer the before/after printout of their alignment angles. Let them see how close their car is to driving perfectly straight—then quote the alignment. The taste of the result, visualized on paper, makes the purchase feel like completing something rather than spending money.",
    nourApplication:
      "Give NOUR OS prospects a 7-day free trial with full features unlocked. Let them see their real data flowing through dashboards, their margins calculated automatically, their schedule optimized. When the trial ends and they're back to spreadsheets, the contrast is the temptation. They've tasted the future and can't go back.",
    triggerPatterns: [
      "low_desire",
      "value_unclear",
      "trial_conversion",
      "vision_selling",
      "future_state_motivation",
    ],
  },
  {
    number: 9,
    title: "Keep Them in Suspense — What Comes Next?",
    shortTitle: "Suspense",
    essence:
      "Once you have attention, maintain it by being unpredictable. Vary your approach, surprise with new offerings, keep them guessing what's next. Routine kills engagement; anticipation sustains it.",
    shopApplication:
      "Don't run the same '10% off oil change' coupon every month—it becomes wallpaper. Instead, do surprise drops: a random Tuesday text to loyalty members saying 'Free tire rotation today only for the first 15 people who reply.' Unpredictable generosity keeps customers checking their phones and talking about Nick's at the barbershop.",
    nourApplication:
      "Nour's content and product releases should be unpredictable enough to sustain interest. Drop a surprise feature nobody asked for but everyone needed. Publish an unexpected deep-dive on a topic outside the usual lane. Keep the audience wondering what's coming next rather than assuming they already know the playbook.",
    triggerPatterns: [
      "audience_disengaged",
      "routine_fatigue",
      "predictable_pattern",
      "engagement_dropping",
      "surprise_needed",
    ],
  },
  {
    number: 10,
    title: "Use the Demonic Power of Words to Sow Confusion",
    shortTitle: "Power of Words",
    essence:
      "Language shapes perception. The right words at the right time can reframe reality, shift emotions, and alter decisions. Master rhetoric—elevate your message above the noise with language that resonates at a visceral level.",
    shopApplication:
      "Stop calling it a '$49.99 oil change' and start calling it a 'Performance Reset.' Rename the waiting room the 'Driver's Lounge.' Call the 50-point inspection a 'Vehicle Health Scan.' Language elevates the perceived value of identical services. The shop that names things memorably charges more and gets fewer objections.",
    nourApplication:
      "Nour should obsess over naming and framing in NOUR OS. Don't call it a 'dashboard'—call it the 'Command Center.' Don't say 'reports'—say 'Profit Intelligence.' The language around the product shapes how users perceive its value. Every feature name should make the user feel like they're gaining power, not just accessing data.",
    triggerPatterns: [
      "weak_messaging",
      "commodity_framing",
      "language_upgrade",
      "brand_naming",
      "perception_shift",
    ],
  },
  {
    number: 11,
    title: "Pay Attention to Detail",
    shortTitle: "Attention to Detail",
    essence:
      "Grand gestures matter less than the accumulation of small, thoughtful touches. People notice when you remember their preferences, anticipate their needs, and care about the little things. Details signal genuine investment.",
    shopApplication:
      "Remember that Mrs. Rodriguez always wants her seat position and mirrors noted before the car goes in the bay. Text customers a photo of their completed work before they pick up. Put a floor mat down before returning the car. These micro-details are what get mentioned in 5-star reviews and drive word-of-mouth in a neighborhood like Old Brooklyn.",
    nourApplication:
      "In NOUR OS, the details are the product. Smooth animations on dashboard transitions, intelligent defaults that save one click per action, a loading screen that shows a useful tip instead of a spinner. Nour should audit every micro-interaction because the cumulative effect of 50 tiny polish points is what separates 'nice tool' from 'I can't live without this.'",
    triggerPatterns: [
      "quality_slip",
      "customer_experience_gap",
      "polish_needed",
      "detail_oversight",
      "micro_interaction",
    ],
  },
  {
    number: 12,
    title: "Poeticize Your Presence",
    shortTitle: "Poeticize Presence",
    essence:
      "Elevate yourself above the mundane. Create an aura of specialness around your brand, your space, your interactions. People are drawn to what feels elevated, curated, and intentional. Make every touchpoint feel like an experience, not a transaction.",
    shopApplication:
      "Nick's Tire should feel different the moment someone walks in. Clean concrete floors, a curated playlist instead of talk radio, the smell of fresh coffee instead of rubber and grease. The shop itself tells a story: 'This place takes everything seriously—including your time here.' That atmospheric difference justifies premium pricing in a commodity market.",
    nourApplication:
      "Nour's brand presence—website, social media, even email signatures—should feel crafted, not default. Custom typography, a consistent color story, language that reads like it was written by a human who cares. NOUR OS should feel like a product with a soul, not a SaaS dashboard stamped out of a template. Poeticize every surface the customer touches.",
    triggerPatterns: [
      "brand_feels_generic",
      "atmosphere_neglected",
      "commodity_perception",
      "experience_design",
      "presence_elevation",
    ],
  },
  {
    number: 13,
    title: "Disarm Through Strategic Weakness and Vulnerability",
    shortTitle: "Strategic Vulnerability",
    essence:
      "Showing calculated vulnerability lowers defenses. Admitting a flaw, sharing a struggle, or confessing a limitation makes you relatable and trustworthy. Perfection intimidates; humanity connects.",
    shopApplication:
      "When Nick's makes a mistake—wrong part ordered, job took longer than quoted—own it publicly and generously. Post on social media: 'We messed up a timing belt job last week. Took 2 days longer than promised. We gave the customer a full detail and 20% off their next visit. We're not perfect, but we make it right.' That transparency builds more trust than a flawless facade ever could.",
    nourApplication:
      "Nour should share the real struggles of building NOUR OS—the failed deploys, the features that got scrapped, the weeks where nothing worked. 'Build in public' vulnerability creates an audience that roots for you. People don't connect with polished success stories; they connect with honest builders who show the mess behind the product.",
    triggerPatterns: [
      "trust_barrier",
      "perfection_facade",
      "authenticity_needed",
      "mistake_recovery",
      "vulnerability_opportunity",
    ],
  },
  {
    number: 14,
    title: "Confuse Desire and Reality — The Perfect Illusion",
    shortTitle: "Perfect Illusion",
    essence:
      "Blur the line between what is and what could be. Create experiences so compelling that the customer can already feel the result before they commit. The best marketing makes the future feel like the present.",
    shopApplication:
      "When quoting a suspension overhaul, don't just list parts and prices. Say: 'When you drive out of here, it's going to feel like a new truck. No more wandering on the highway, no more clunking over potholes on Denison Ave.' Paint the after-state so vividly that the customer is already experiencing it emotionally before signing the estimate.",
    nourApplication:
      "NOUR OS demos should show the prospect's own data, not generic sample data. When they see their actual shop name, their real revenue numbers, their technicians' names on the dashboard, the illusion collapses into reality—they can't unsee themselves using it. The demo should feel like they already own it.",
    triggerPatterns: [
      "value_visualization",
      "demo_optimization",
      "future_state_selling",
      "emotional_close",
      "reality_bridging",
    ],
  },
  {
    number: 15,
    title: "Isolate the Victim",
    shortTitle: "Isolate the Target",
    essence:
      "Separate the target from their usual influences—advisors, competitors, distractions. In isolation, your message is the only signal. Control the information environment and your influence multiplies.",
    shopApplication:
      "When a high-value fleet prospect is considering Nick's, get them out of the comparison mindset. Invite them for a private shop tour during off-hours, walk them through the bays, introduce the lead tech by name, show them the parts inventory system. In that one-on-one environment, they're not comparing you to a spreadsheet of bids—they're experiencing a relationship.",
    nourApplication:
      "For NOUR OS sales, get prospects out of the 'comparing 5 SaaS tools in browser tabs' mode. Offer a dedicated onboarding call where Nour personally walks them through setup with their data. Once they're in a private, focused session, the competition fades. They're not evaluating features anymore—they're building a relationship with the founder.",
    triggerPatterns: [
      "comparison_shopping",
      "competitor_noise",
      "attention_fragmented",
      "exclusive_experience",
      "decision_isolation",
    ],
  },
  {
    number: 16,
    title: "Prove Yourself",
    shortTitle: "Prove Yourself",
    essence:
      "Words and promises eventually ring hollow. At the critical moment, demonstrate your value through action, sacrifice, or undeniable results. Proof of commitment converts skeptics into believers.",
    shopApplication:
      "When a skeptical customer questions the diagnosis, don't argue—show them. Walk them into the bay, point the flashlight at the worn ball joint, let them see the play in the tie rod. Better yet, show them the old part next to a new one after the job is done. Tangible proof eliminates doubt in a way that no amount of explaining ever will.",
    nourApplication:
      "Nour should prove NOUR OS works by publishing real, verifiable results. 'Shop X increased average ticket by 18% in 90 days using our scheduling optimizer.' Not vague claims—specific, auditable outcomes. Offer a 'pay only if your margins improve' guarantee for early customers. Proof of commitment to results is the ultimate sales closer.",
    triggerPatterns: [
      "skepticism_high",
      "trust_unearned",
      "proof_needed",
      "results_demanded",
      "show_dont_tell",
    ],
  },
  {
    number: 17,
    title: "Effect a Regression",
    shortTitle: "Regression",
    essence:
      "Take people back to a simpler, more emotional time. Nostalgia, childhood comforts, and primal feelings bypass rational defenses. When you tap into deep-seated emotional memories, you create bonds that logic cannot break.",
    shopApplication:
      "Lean into the nostalgia of the old-school neighborhood mechanic—the guy your dad trusted, the shop where they knew your name and your car's history by heart. Position Nick's as that throwback experience with modern capabilities: 'Your grandfather's mechanic, with 2026 diagnostic technology.' That emotional anchor differentiates from corporate chains that feel sterile and transactional.",
    nourApplication:
      "Nour's brand storytelling should tap into the simplicity people crave. 'Remember when running a business meant doing great work and getting paid fairly? Before you needed 15 subscriptions and a data science degree?' Position NOUR OS as the return to simplicity—modern tech that brings back the feeling of having everything under control without the complexity.",
    triggerPatterns: [
      "nostalgia_trigger",
      "emotional_anchoring",
      "simplicity_craving",
      "heritage_branding",
      "primal_appeal",
    ],
  },
  {
    number: 18,
    title: "Stir Up the Transgressive and Taboo",
    shortTitle: "Transgressive Edge",
    essence:
      "People are secretly drawn to what breaks convention. Controlled rule-breaking—challenging industry norms, saying what others won't, doing what competitors consider inappropriate—creates magnetic energy and fierce loyalty.",
    shopApplication:
      "Break auto repair taboos publicly. Post a video showing exactly how much markup goes on parts and why. Share the real cost of a brake job with full transparency. Most shops guard this information like a secret—Nick's publishing it signals confidence and integrity. The customers who value honesty will flock to you; the ones who don't weren't your people anyway.",
    nourApplication:
      "Nour should say the things other SaaS founders won't. 'Most shop management software is overpriced garbage designed by people who've never touched a lug nut.' Call out the industry's dysfunction directly. This transgressive honesty polarizes—some people will hate it, but the right audience will feel like they finally found someone who gets it.",
    triggerPatterns: [
      "playing_it_safe",
      "industry_conformity",
      "bold_stance_needed",
      "taboo_opportunity",
      "radical_transparency",
    ],
  },
  {
    number: 19,
    title: "Use Spiritual Lures",
    shortTitle: "Spiritual Lures",
    essence:
      "Appeal to something higher than self-interest—purpose, meaning, community, legacy. People want to feel part of something larger. Connect your offering to a cause, a mission, or a vision that transcends the transaction.",
    shopApplication:
      "Position Nick's Tire as more than a repair shop—it's a neighborhood institution keeping Cleveland families safe on the road. Sponsor the local Little League team, host a free winter tire check for single parents, run a 'Wheels for Workers' program donating tires to people who need their car for employment. The shop becomes a community pillar, not just a business.",
    nourApplication:
      "Frame NOUR OS as a movement, not a product. 'We're building the operating system for independent business owners who refuse to be crushed by corporate chains.' The mission is empowerment of the small operator. Every feature, every update, every piece of content should reinforce: this is for the underdog, the grinder, the person building something real with their hands and their mind.",
    triggerPatterns: [
      "mission_absent",
      "purpose_seeking",
      "community_building",
      "cause_alignment",
      "legacy_motivation",
    ],
  },
  {
    number: 20,
    title: "Mix Pleasure with Pain",
    shortTitle: "Pleasure and Pain",
    essence:
      "Pure pleasure becomes boring; pure pain drives people away. The combination—tension followed by relief, challenge followed by reward—creates the deepest engagement. Controlled discomfort makes the resolution feel extraordinary.",
    shopApplication:
      "The vehicle inspection that reveals $2,400 in needed work is the pain. The service advisor who then prioritizes it into three phases over six months, starting with the $380 safety-critical items, is the relief. The customer felt the weight of the problem and then felt rescued by a reasonable plan. That emotional arc—anxiety to relief—creates loyalty that a simple oil change never could.",
    nourApplication:
      "In NOUR OS onboarding, show the user their problem first: 'Based on your data, you're leaving an estimated $2,100/month on the table from scheduling gaps.' That's the pain. Then immediately show the optimized schedule that recovers it. The product experience should oscillate between 'here's what's broken' and 'here's how we fix it'—the contrast drives engagement and retention.",
    triggerPatterns: [
      "flat_engagement",
      "no_emotional_arc",
      "pain_point_leverage",
      "contrast_selling",
      "tension_relief_cycle",
    ],
  },
  {
    number: 21,
    title: "Give Them Space to Fall — The Pursuer Is Pursued",
    shortTitle: "Space to Fall",
    essence:
      "Pulling back at the right moment is more powerful than pushing forward. When you step away, the other party feels the void and pursues you. Strategic withdrawal creates desire more effectively than relentless pursuit.",
    shopApplication:
      "After giving a thorough estimate, don't follow up five times. Send one professional follow-up, then go silent. Let the customer sit with the quote, compare it to the competitor's vague phone estimate, and realize Nick's was the only shop that actually showed them the problem. The customers who come back after space are the ones who stay for years.",
    nourApplication:
      "After a strong NOUR OS demo, don't barrage the prospect with follow-up emails. Send one recap, then let them breathe. If the product is as good as demonstrated, the silence creates a vacuum they'll fill by coming back. Nour should also apply this to content—disappear for a week after a viral post, and watch the audience actively seek out the next one.",
    triggerPatterns: [
      "over_pursuing",
      "follow_up_fatigue",
      "strategic_withdrawal",
      "space_creation",
      "pursuit_reversal",
    ],
  },
  {
    number: 22,
    title: "Use Physical Lures",
    shortTitle: "Physical Lures",
    essence:
      "Engage the senses directly. Abstract promises and digital messages only go so far. Physical experiences—what people can see, touch, smell, and feel—create deeper impressions and stronger memories than words alone.",
    shopApplication:
      "Let the customer sit in the car after the alignment and feel the steering wheel track straight for the first time in months. Hand them the worn-out brake pad next to the new one so they can feel the difference in thickness. Put fresh floor mats down, vacuum the interior as a courtesy. The physical, sensory experience of the result is the most powerful advertisement Nick's can run.",
    nourApplication:
      "Nour should create physical touchpoints for a digital product. Send beta users a branded notebook and pen with their login credentials. Mail a sticker pack to power users. At trade shows, have a live terminal where shop owners can touch and interact with NOUR OS on a real screen with their real data. Digital products that create physical artifacts become more real and harder to cancel.",
    triggerPatterns: [
      "digital_only_experience",
      "sensory_engagement",
      "tangible_touchpoint",
      "physical_proof",
      "experiential_marketing",
    ],
  },
  {
    number: 23,
    title: "Master the Art of the Bold Move",
    shortTitle: "Bold Move",
    essence:
      "After patient buildup, there comes a moment that demands decisive action. Hesitation at the critical point undoes all prior work. When the moment is right, move with confidence and totality. Timidity at the close kills the deal.",
    shopApplication:
      "When the customer has seen the inspection, heard the recommendation, and is visibly leaning toward approval—don't hedge. Say: 'Let's get this scheduled. I can have your truck back to you by Thursday afternoon, and you'll have peace of mind for the rest of winter.' The bold, confident close at the right moment converts more than any discount or extended deliberation.",
    nourApplication:
      "When Nour has a warm prospect who's done two demos and asked about pricing—stop nurturing and close. 'I'd like to get you started this week. I'll personally handle your onboarding and have you live by Friday.' The bold ask, delivered with confidence at the right moment, is what separates founders who sell from founders who 'build and hope.' Ship the feature, publish the post, make the ask.",
    triggerPatterns: [
      "hesitation_at_close",
      "timidity_detected",
      "moment_of_decision",
      "bold_action_needed",
      "closing_opportunity",
    ],
  },
  {
    number: 24,
    title: "Beware the Aftereffects",
    shortTitle: "Aftereffects",
    essence:
      "The interaction doesn't end at the close. What happens after the sale—buyer's remorse, unmet expectations, neglected follow-through—can destroy everything you built. Manage the aftermath as carefully as the approach.",
    shopApplication:
      "After a big repair, call the customer 48 hours later: 'Hey, just checking—how's the truck feeling after the suspension work?' That single call prevents negative reviews, catches any issues early, and plants the seed for the next visit. Most shops vanish after they swipe the card. Nick's staying present after the transaction is the final move that locks in lifetime value.",
    nourApplication:
      "After a NOUR OS customer signs up, the real work begins. The first 14 days determine whether they churn or become a power user. Nour should build an onboarding sequence that checks in at day 1, 3, 7, and 14 with personalized guidance. Post-sale neglect is the number one killer of SaaS businesses—the aftereffect of a great demo is meaningless if the onboarding experience is hollow.",
    triggerPatterns: [
      "post_sale_neglect",
      "buyer_remorse",
      "churn_risk",
      "follow_through_gap",
      "onboarding_failure",
    ],
  },
];

export async function seedSeduction(prisma: PrismaClient) {
  console.log("Seeding Art of Seduction (Business Strategy)...");
  let count = 0;
  for (const law of seductionLaws) {
    await prisma.strategicLaw.upsert({
      where: { book_number: { book: "ART_OF_SEDUCTION", number: law.number } },
      update: {
        title: law.title,
        shortTitle: law.shortTitle,
        essence: law.essence,
        shopApplication: law.shopApplication,
        nourApplication: law.nourApplication,
        triggerPatterns: law.triggerPatterns,
      },
      create: {
        book: "ART_OF_SEDUCTION",
        number: law.number,
        title: law.title,
        shortTitle: law.shortTitle,
        essence: law.essence,
        shopApplication: law.shopApplication,
        nourApplication: law.nourApplication,
        triggerPatterns: law.triggerPatterns,
      },
    });
    count++;
  }
  console.log(`  \u2713 ${count} seduction strategies seeded`);
}
