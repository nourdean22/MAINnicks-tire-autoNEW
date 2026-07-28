/**
 * Greene Library Expansion — Adds ~54 new entries:
 * - 9 Seducer Archetypes (ART_OF_SEDUCTION 101-109)
 * - 9 Anti-Seducer Types (ART_OF_SEDUCTION 201-209)
 * - 18 Victim Types (ART_OF_SEDUCTION 301-318)
 * - 8 Mastery sub-principles (MASTERY 13-20)
 * - 10 50th Law chapters (FIFTIETH_LAW 1-10)
 *
 * Run: DATABASE_URL="..." npx tsx prisma/seeds/seed-greene-expansion.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// ═══════════════════════════════════════════════════════════════════
// SEDUCER ARCHETYPES (Art of Seduction 101-109)
// ═══════════════════════════════════════════════════════════════════

const seducerArchetypes = [
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 101,
    title: "The Siren",
    shortTitle: "Siren Archetype",
    essence:
      "The Siren is the ultimate figure of female power — she operates through an overwhelming sensory and physical presence that clouds the rational mind. In business, the Siren brand creates visceral desire through aesthetics, atmosphere, and sensory experience that competitors cannot replicate through logic or pricing alone.",
    shopApplication:
      "Transform Nick's Tire & Auto from a commodity service into a sensory experience. The shop should LOOK different — clean floors, organized bays visible from the waiting area, branded uniforms, the smell of fresh coffee instead of stale oil. When a customer walks in, the visual impression should immediately separate you from Jiffy Lube. Invest in a professional waiting area with a mounted screen showing live bay cameras. The Siren shop doesn't compete on price — it competes on the feeling customers get when they walk through the door.",
    nourApplication:
      "Your brand — both personal and NOUR OS — should create desire through polish, not just function. When you demo NOUR OS or post about it, the UI, the screenshots, the language should make people WANT it before they understand what it does. Stop shipping rough prototypes publicly. Every touchpoint should feel crafted. The Siren principle applied to tech: make it beautiful first, then explain what it does.",
    triggerPatterns: [
      "brand_aesthetics_neglected",
      "customer_experience_flat",
      "visual_identity_weak",
      "sensory_appeal_missing",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 102,
    title: "The Rake",
    shortTitle: "Rake Archetype",
    essence:
      "The Rake seduces through relentless, focused attention — making the target feel like the only person in the world. In business, this translates to making each customer feel like your most important client through personalized, intense focus that creates loyalty beyond reason.",
    shopApplication:
      "Train advisors at Nick's to give each customer undivided attention during the consultation. No multitasking, no glancing at phones, no rushing. When John brings in his F-150, the advisor should remember his name, his vehicle history, and what he mentioned last time about that road trip. 'John, last time you mentioned your brakes were squeaking on the highway — let's take a look at those first.' This level of personal attention is what makes customers drive past three other shops to reach you.",
    nourApplication:
      "When you engage with something — a client, a project, a conversation — be fully present. Your pattern is scattered attention across too many things simultaneously. The Rake's power comes from concentrated intensity on ONE target. Apply this to business development: instead of posting on 5 platforms poorly, dominate ONE channel completely. Instead of 10 half-built features, ship ONE polished feature that makes users feel seen.",
    triggerPatterns: [
      "attention_scattered",
      "customer_feels_ignored",
      "personalization_missing",
      "followup_generic",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 103,
    title: "The Ideal Lover",
    shortTitle: "Ideal Lover Archetype",
    essence:
      "The Ideal Lover studies the target's deepest unmet needs and becomes their fantasy made real. In business, this means understanding what customers actually want — not what you want to sell — and reshaping your service to fill that exact gap. The Ideal Lover listens before acting.",
    shopApplication:
      "Most auto shops sell what THEY want to sell (the most expensive repair). The Ideal Lover shop sells what the CUSTOMER needs to feel safe, respected, and smart. A single mom bringing in a minivan with a check engine light doesn't want a $2,000 upsell — she wants someone to explain in plain English what's wrong, what's urgent vs. what can wait, and how to budget for it. Train advisors to ask: 'What's most important to you right now — getting everything fixed, or prioritizing safety items within your budget?' That question IS the Ideal Lover strategy.",
    nourApplication:
      "Stop building features YOU think are cool and start building what your future users actually need. The Ideal Lover pattern for NOUR OS: interview 5 shop owners, ask what keeps them up at night, and build THAT. Your tendency is to build systems that excite YOUR mind (complex dashboards, strategic triggers, AI briefings) — but an Ideal Lover product solves the customer's actual pain, even if it's unglamorous (simple scheduling, parts ordering, invoice follow-up).",
    triggerPatterns: [
      "customer_needs_assumed",
      "product_market_misfit",
      "selling_vs_serving",
      "empathy_gap",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 104,
    title: "The Dandy",
    shortTitle: "Dandy Archetype",
    essence:
      "The Dandy defies expectations and refuses to be categorized. They project an image that is slightly ambiguous, unconventional, and fascinating. In business, the Dandy brand breaks the mold of its industry — doing something no one expects from that category.",
    shopApplication:
      "Nick's Tire & Auto should not look, feel, or act like a typical Cleveland tire shop. The Dandy move: host a community car care workshop on Saturday mornings. Post cinematic Instagram Reels of tire changes set to music. Have a shop dog. Put a bookshelf in the waiting area. These unexpected touches make people talk about you. When someone asks 'What tire shop do you go to?' the answer becomes a STORY, not just a name. Defy the category.",
    nourApplication:
      "You are already a Dandy — a tire shop owner who builds AI-powered operating systems at night. Lean into this contrast instead of hiding it. Your personal brand should be the guy who runs a blue-collar business with Silicon Valley tools. This ambiguity is your superpower. Don't try to fit into either world perfectly — the friction between them IS your brand. Post about running a shop AND building software. The people who find that combination fascinating are your ideal audience.",
    triggerPatterns: [
      "brand_too_generic",
      "category_conformity",
      "differentiation_weak",
      "unexpected_missing",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 105,
    title: "The Natural",
    shortTitle: "Natural Archetype",
    essence:
      "The Natural seduces through authenticity, spontaneity, and childlike openness. They disarm by being genuine in a world of calculation. In business, the Natural brand feels refreshingly honest, approachable, and unpretentious — creating trust through transparency rather than polish.",
    shopApplication:
      "The most powerful marketing for Nick's is radical honesty. Film a TikTok showing a customer's worn brake pads next to new ones. Post a Google Business update saying 'We had a slow week, so we're offering free inspections through Friday.' Share a photo of a mistake your team caught before it went out the door. The Natural doesn't perform perfection — they show the real, human side of the business. Customers trust shops that admit imperfection more than shops that claim they never make mistakes.",
    nourApplication:
      "Your best content comes from unfiltered authenticity — the late-night coding sessions, the frustration of a failed deployment, the excitement of a feature working. Stop trying to polish everything before sharing it. The Natural pattern: share the process, not just the result. Your audience connects with the struggle more than the success. Post the messy whiteboard, the terminal errors, the 2 AM breakthrough. That's your Natural energy.",
    triggerPatterns: [
      "authenticity_lacking",
      "over_polishing",
      "transparency_missing",
      "brand_feels_corporate",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 106,
    title: "The Coquette",
    shortTitle: "Coquette Archetype",
    essence:
      "The Coquette seduces through intermittent reinforcement — alternating warmth and coldness, availability and distance. They create obsessive interest by being unpredictable. In business, the Coquette strategy uses scarcity, exclusivity, and strategic withdrawal to increase desire.",
    shopApplication:
      "Don't always be available. Run limited-time offers that actually END. 'First 10 appointments this week get a free alignment check — 6 spots left.' When you're booked out 3 days, don't apologize — celebrate it: 'We're fully booked through Wednesday, but I'm holding a Thursday morning slot for you.' Scarcity signals quality. If Nick's is always available, it feels desperate. If Nick's is sometimes unavailable, it feels in demand. The Coquette shop is slightly harder to get into than competitors — and customers value it more because of that.",
    nourApplication:
      "Stop giving everything away for free, immediately, to everyone. Your NOUR OS demos, your expertise, your time — these have value that increases with scarcity. The Coquette pattern for personal brand: don't post every day. Post brilliantly, then go silent for a few days. Let people miss your content. For business: don't discount to fill the schedule. A full-price, slightly-harder-to-book shop commands more respect than a shop that's always running promotions.",
    triggerPatterns: [
      "always_available",
      "discount_overuse",
      "scarcity_missing",
      "exclusivity_absent",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 107,
    title: "The Charmer",
    shortTitle: "Charmer Archetype",
    essence:
      "The Charmer makes others feel comfortable, validated, and important. They focus outward — listening more than speaking, confirming the other's self-image. In business, the Charmer creates an environment where customers feel respected, heard, and valued as people, not just transactions.",
    shopApplication:
      "Train every person at Nick's — from the front desk to the techs — to make customers feel good about themselves, not just their car. 'Smart move getting that oil change on time — a lot of people wait too long.' 'Your truck is in great shape for the mileage — you clearly take care of it.' Compliment their decisions, not just their vehicle. The Charmer advisor never makes a customer feel stupid for not knowing car stuff. They educate with warmth, not condescension. The result: customers WANT to come back because they feel good about themselves when they leave.",
    nourApplication:
      "In conversations — business, personal, or online — practice making others feel important. Your default can be direct and blunt, which works for efficiency but kills charm. The Charmer move: before correcting someone, validate what they got right. Before pitching your idea, acknowledge theirs. In business development, charm is the lubricant that makes deals happen without friction. Charm is not manipulation — it's genuine interest in making others feel valued.",
    triggerPatterns: [
      "customer_feels_judged",
      "communication_blunt",
      "warmth_missing",
      "validation_absent",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 108,
    title: "The Charismatic",
    shortTitle: "Charismatic Archetype",
    essence:
      "The Charismatic leads through vision, conviction, and extraordinary energy. They inspire others to follow by the sheer force of their belief. In business, the Charismatic leader creates a mission that staff and customers want to be part of — transcending mere transactions.",
    shopApplication:
      "As the owner, your energy sets the tone for the entire shop. If you walk in defeated, the team mirrors it. If you walk in with a clear mission — 'We're going to be the most trusted shop on the East Side of Cleveland' — the team rallies. The Charismatic shop owner doesn't just manage; they inspire. Hold a weekly 5-minute team huddle: 'Here's what we accomplished this week, here's what we're going after next week.' Give the team something to believe in beyond a paycheck. Charisma at Nick's means the techs feel proud to work there, and that pride shows in their work.",
    nourApplication:
      "You have natural charismatic energy when you're passionate about a project — the problem is it burns hot and then disappears. The Charismatic pattern requires SUSTAINED conviction, not just initial excitement. Channel your vision for NOUR OS into a consistent public narrative. Become the person people associate with the intersection of blue-collar business and technology. Sustained charisma = consistent action + unwavering mission, not periodic bursts of intensity.",
    triggerPatterns: [
      "team_morale_low",
      "vision_unclear",
      "leadership_energy_flat",
      "mission_missing",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 109,
    title: "The Star",
    shortTitle: "Star Archetype",
    essence:
      "The Star is larger than life — projecting an image that transcends the ordinary. They create an aura of glamour and distinction that makes people want to associate with them. In business, the Star brand becomes aspirational — something customers are proud to be connected to.",
    shopApplication:
      "Elevate Nick's from a local shop to a Cleveland institution. Get featured in local media — Cleveland Scene, Fox 8 Morning Show, Cleveland.com. Sponsor a Little League team. Put up professional signage that looks like it belongs on a franchise, not a corner shop. The Star shop doesn't just fix cars — it represents something bigger: honest, community-rooted business done at a high level. When someone tells their friend 'I go to Nick's,' it should carry a sense of 'I know a place' prestige.",
    nourApplication:
      "Build a personal brand that's larger than any single project. You are not just a shop owner, not just a developer — you are someone building a unique life at the intersection of both. The Star pattern: create a public persona that's memorable and aspirational. This doesn't mean being fake — it means curating which parts of your story you amplify. The late-night coding, the early-morning shop hustle, the family man, the systems thinker — together, these create a Star narrative that no competitor can replicate.",
    triggerPatterns: [
      "brand_invisible",
      "local_presence_weak",
      "media_absent",
      "aspiration_missing",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// ANTI-SEDUCER TYPES (Art of Seduction 201-209)
// ═══════════════════════════════════════════════════════════════════

const antiSeducerTypes = [
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 201,
    title: "The Brute — Overly Aggressive, No Subtlety",
    shortTitle: "The Brute",
    essence:
      "The Brute relies on force, aggression, and blunt pressure to get what they want. They have no patience for the art of persuasion and try to overwhelm through sheer pushiness. In business, the Brute is the hard-sell salesperson who drives customers away by being too aggressive, too fast, too pushy.",
    shopApplication:
      "The Brute advisor at Nick's is the one who tells every customer they need $3,000 in work and pressures them to decide on the spot. 'You NEED these brakes done TODAY or you're going to kill someone.' This destroys trust instantly. Train your team: never pressure a customer. Present findings, explain urgency levels honestly, and let them decide. The anti-Brute approach: 'Here's what we found. These two items are safety-critical. These three can wait 2-3 months. What would you like to prioritize?' Give them control. The sale closes itself when trust is present.",
    nourApplication:
      "Watch for Brute energy in your own behavior — pushing too hard on ideas, forcing systems onto people who aren't ready, being aggressive in negotiations when patience would serve better. Your intensity can tip into Brute territory when you're excited about something and can't understand why others don't see it immediately. The anti-pattern: slow down, let people arrive at your conclusion on their own. Plant the seed and wait.",
    triggerPatterns: [
      "hard_sell_complaint",
      "customer_pressure",
      "aggressive_upselling",
      "trust_destroyed",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 202,
    title: "The Suffocator — Clingy, Overbearing Attention",
    shortTitle: "The Suffocator",
    essence:
      "The Suffocator smothers with excessive attention, constant check-ins, and overwhelming neediness. They mistake quantity of contact for quality of connection. In business, the Suffocator sends too many follow-up emails, calls too frequently, and makes customers feel trapped rather than valued.",
    shopApplication:
      "Don't call a customer 5 times about a pending estimate. Don't text them daily reminders. The Suffocator pattern kills more deals than silence does. After sending an estimate, follow up ONCE after 24-48 hours. If no response, wait one week and try once more with new value: 'We have a parts special this week that would save you $80 on that repair.' Two attempts, then let it breathe. If they want the service, they'll come back. If they feel chased, they'll go to Firestone just to escape you.",
    nourApplication:
      "In relationships and business, your tendency to over-engineer communication can become suffocating. Not every thought needs a Slack message. Not every insight needs a system notification. The Suffocator pattern in NOUR OS: too many alerts, too many reminders, too many dashboards demanding attention. Design for silence by default, noise only when critical. Same principle with people — give space for them to come to you.",
    triggerPatterns: [
      "excessive_followups",
      "customer_avoidance",
      "alert_fatigue",
      "communication_overload",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 203,
    title: "The Moralizer — Judgmental, Preachy, Self-Righteous",
    shortTitle: "The Moralizer",
    essence:
      "The Moralizer makes others feel inferior through constant judgment and unsolicited moral lectures. They position themselves as superior and make every interaction feel like a sermon. In business, the Moralizer makes customers feel guilty for their choices instead of empowered by their options.",
    shopApplication:
      "Never make a customer feel guilty about deferred maintenance. 'I can't believe you've been driving on these tires' is Moralizer energy that makes them defensive and less likely to return. Instead: 'These tires have served you well — they've got about 10% tread left. Let me show you some options that fit your budget so we can get you driving safe again.' The non-judgmental approach builds trust. Customers who feel judged go to the shop that makes them feel good, even if the work is worse.",
    nourApplication:
      "Watch for Moralizer patterns in self-talk. 'I should have done X by now' and 'Why can't I just be consistent' are moralizing self-judgments that create shame spirals instead of productive action. The NOUR OS philosophy should be neutral data, not moral judgment. Drift detection should say 'Focus score trending down — here are 3 options' not 'You're failing at your goals.' Design systems that inform without judging.",
    triggerPatterns: [
      "judgmental_language",
      "customer_shaming",
      "self_criticism_spiral",
      "preachy_communication",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 204,
    title: "The Tightwad — Miserly, Signals Scarcity",
    shortTitle: "The Tightwad",
    essence:
      "The Tightwad repels through visible stinginess — cheap materials, cut corners, and a constant reluctance to invest. They signal scarcity and desperation, making others feel like dealing with them is a downgrade. In business, the Tightwad brand looks cheap, feels cheap, and attracts only price-shoppers who have zero loyalty.",
    shopApplication:
      "Don't be the shop with the cheapest waiting room chairs, the worst coffee, and the handwritten signs. These signal 'we can't afford better' and attract customers who will leave for $5 less at the next shop. Invest in the visible things: clean uniforms, professional signage, decent coffee, a tablet for digital inspections instead of clipboard carbon copies. The Tightwad shop saves $500/month on these things and loses $5,000/month in customers who chose the shop that LOOKS like it cares. Spend to signal quality.",
    nourApplication:
      "Don't be a Tightwad with tools, education, or infrastructure. The $20/month you save by using free-tier everything costs you hours of debugging and limitations. Buy the right tools: proper hosting, quality domains, paid APIs when the free tier constrains you. The Tightwad pattern in your life: spending hours on workarounds instead of spending $50 to solve the problem. Your time has a dollar value — act like it.",
    triggerPatterns: [
      "cost_cutting_visible",
      "cheap_signals",
      "penny_wise_pound_foolish",
      "investment_avoidance",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 205,
    title: "The Bumbler — Awkward, Self-Conscious, Uncertain",
    shortTitle: "The Bumbler",
    essence:
      "The Bumbler lacks confidence and makes others uncomfortable through their visible anxiety and self-doubt. They apologize too much, second-guess themselves publicly, and create an atmosphere of uncertainty. In business, the Bumbler erodes customer confidence by projecting insecurity about their own product or service.",
    shopApplication:
      "An advisor who says 'I THINK it might be the alternator, but I'm not sure, maybe we should look at it more' destroys customer confidence. Train your team to speak with certainty when they're certain, and with structured honesty when they're not: 'Based on the symptoms, the most likely cause is the alternator. We'll run a diagnostic to confirm before we do any work.' Never apologize for your prices. Never say 'I know it's a lot.' Present the value confidently: 'This repair uses OE-spec parts with a 2-year warranty. Here's the breakdown.' Confidence sells.",
    nourApplication:
      "The Bumbler pattern shows up when you over-qualify your work: 'It's not perfect yet' or 'I know this isn't great, but...' Stop prefacing your output with disclaimers. Present your work — code, business decisions, content — with confidence. If it genuinely needs improvement, improve it before showing it. If it's ready to show, show it without apology. Confidence is a skill, not a feeling — practice projecting it even when internal doubt exists.",
    triggerPatterns: [
      "confidence_lacking",
      "excessive_disclaimers",
      "price_apologizing",
      "uncertainty_projected",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 206,
    title: "The Windbag — Talks Too Much, Listens Too Little",
    shortTitle: "The Windbag",
    essence:
      "The Windbag overwhelms with words, drowning out the other person's voice. They mistake talking for communicating and leave no space for connection. In business, the Windbag salesperson talks so much about features and benefits that they never learn what the customer actually needs.",
    shopApplication:
      "The worst service advisors talk for 5 minutes straight about what they found during the inspection. The best ones show the customer a photo, say two sentences, and ask: 'What questions do you have?' The Windbag advisor loses the customer at sentence three. Train the team: explain findings in under 60 seconds, use visuals (photos, videos of the worn part), and then LISTEN. The customer will tell you exactly what they need if you give them space to talk. Shut up and sell more.",
    nourApplication:
      "You can be a Windbag when excited about a technical concept — over-explaining, going too deep, losing the listener. In business conversations, pitch meetings, or even personal discussions, practice the 60-second rule: make your point in under a minute, then stop and listen. In NOUR OS design: don't over-explain in the UI. Show the data, let the user interpret. Dashboards that require paragraphs of explanation are Windbag dashboards.",
    triggerPatterns: [
      "over_explaining",
      "listening_deficit",
      "pitch_too_long",
      "ui_too_verbose",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 207,
    title: "The Reactor — Overly Emotional, Dramatic Responses",
    shortTitle: "The Reactor",
    essence:
      "The Reactor turns every situation into high drama, overreacting to setbacks and making others feel like they're walking on eggshells. Their emotional volatility creates instability. In business, the Reactor boss or salesperson makes every problem feel like a crisis, exhausting staff and customers alike.",
    shopApplication:
      "When a tech makes a mistake — wrong oil filter, missed a torque spec — the Reactor owner explodes in front of the team. This creates a culture of fear where mistakes get HIDDEN instead of reported. The anti-Reactor response: address errors calmly, privately, and with a systems mindset. 'This happened because we don't have a double-check process for oil specs. Let's add one.' A calm shop is a safe shop — where techs admit mistakes early, before they become expensive or dangerous.",
    nourApplication:
      "Your emotional pattern includes Reactor spikes — especially when things break unexpectedly (deployment failures, data loss, systems not working). The Reactor response wastes energy on emotional processing when the situation demands calm troubleshooting. Build an internal protocol: when something breaks, take one breath, then diagnose. No frustration monologue. No rage-quitting the project. The system doesn't care about your feelings — it needs your focus.",
    triggerPatterns: [
      "overreaction_to_setback",
      "emotional_volatility",
      "team_fear_culture",
      "crisis_from_nothing",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 208,
    title: "The Vulgarian — Crude, Tasteless, No Class",
    shortTitle: "The Vulgarian",
    essence:
      "The Vulgarian offends through crudeness, poor taste, and lack of refinement. They mistake bluntness for honesty and crassness for authenticity. In business, the Vulgarian brand feels low-class, unprofessional, and embarrassing to be associated with.",
    shopApplication:
      "The Vulgarian shop has explicit radio playing in the bays, techs cursing within earshot of customers, crude jokes on the walls, and a waiting area that smells like cigarettes. It doesn't matter how good the work is — the experience drives away anyone with standards. Set clear culture rules at Nick's: professional language in customer-facing areas, clean environment, respectful communication. You can be casual and friendly without being crude. The shop that feels professional gets the fleet contracts, the high-value vehicles, and the repeat customers.",
    nourApplication:
      "In personal brand and online presence, maintain class even when being direct. Vulgarian energy shows up in aggressive social media posts, crude humor that doesn't land, or dismissive language about competitors. You can be honest, bold, and even confrontational without being vulgar. The standard: would you say this in front of a client you respect? If not, rephrase it. Professionalism is not weakness — it's strategic restraint.",
    triggerPatterns: [
      "professionalism_lacking",
      "crude_communication",
      "brand_embarrassment",
      "environment_unprofessional",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 209,
    title: "The Doormat — No Boundaries, Eager to Please",
    shortTitle: "The Doormat",
    essence:
      "The Doormat agrees with everything, never pushes back, and has no opinions of their own. Their excessive compliance makes them boring and unrespectable. In business, the Doormat gives away too much — free work, excessive discounts, unlimited revisions — because they can't say no.",
    shopApplication:
      "The Doormat shop owner gives every angry customer a discount, lets vendors push unfavorable terms, and lets employees call in without consequences. This isn't generosity — it's weakness that gets exploited. Set clear boundaries at Nick's: your prices reflect your quality, and you don't apologize for them. Warranty claims follow a defined process. Employees have clear expectations with real consequences. You can be kind and firm simultaneously. A shop with no boundaries attracts the customers who exploit boundaries — and repels the ones who would respect them.",
    nourApplication:
      "The Doormat pattern in your life: saying yes to projects you should decline, giving free advice when you should charge, tolerating behaviors that waste your time. Every time you say yes to something that doesn't serve your mission, you say no to something that does. Practice the strategic no: 'I appreciate you thinking of me, but I'm focused on [specific priority] right now.' No justification needed. No apology needed. Boundaries are a power move, not a personality flaw.",
    triggerPatterns: [
      "boundaries_missing",
      "discount_caving",
      "people_pleasing",
      "free_work_pattern",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// VICTIM TYPES (Art of Seduction 301-318)
// ═══════════════════════════════════════════════════════════════════

const victimTypes = [
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 301,
    title: "The Reformed Rake or Siren",
    shortTitle: "Reformed Rake/Siren",
    essence:
      "Someone who once lived freely and now feels constrained by responsibilities. They secretly crave the excitement they gave up. In business, this is the customer who used to drive a sports car and now drives a minivan — sell them the feeling of their former identity.",
    shopApplication:
      "Identify the customer who lights up talking about the car they USED to drive. 'Man, I had a Mustang GT back in the day...' This customer will spend on performance upgrades, premium tires, and aesthetic touches for their current vehicle because it reconnects them to their former identity. Market to this type: 'Your daily driver can still feel like something special. Premium tire packages, performance alignments, and sport brake upgrades available.' The Reformed Rake doesn't buy a tire — they buy a feeling.",
    nourApplication:
      "Recognize this pattern in yourself: you once had the freedom to build anything, explore any idea, stay up all night coding with no consequences. Now you have responsibilities — business, marriage, health routines. The danger: resentment toward the structure you built. The solution: build small windows of creative freedom INTO your structure. NOUR OS should have a 'creative hour' — protected time for building whatever excites you, guilt-free, because it's scheduled.",
    triggerPatterns: [
      "nostalgia_pattern",
      "identity_loss",
      "excitement_craving",
      "constraint_resentment",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 302,
    title: "The Disappointed Dreamer",
    shortTitle: "Disappointed Dreamer",
    essence:
      "Someone whose life hasn't matched their fantasies. They feel quietly let down by reality and are susceptible to anyone who can revive their sense of possibility. In business, this is the customer who settles for less because they've been disappointed before — show them what's possible.",
    shopApplication:
      "The Disappointed Dreamer customer has been burned by other shops. They expect mediocrity because that's all they've experienced. When Nick's delivers exceptional service — a car returned cleaner than when it arrived, a repair done early, a genuine follow-up call — it shatters their low expectations. This creates fierce loyalty. Identify these customers by their guarded body language and low expectations: 'Just do whatever needs doing, I guess.' Win them by exceeding every expectation, then watch them become your most vocal advocates on Google Reviews.",
    nourApplication:
      "The Disappointed Dreamer in you shows up after failed projects — 'I've tried this before and it didn't work.' This cynicism is a defense mechanism against future disappointment. Combat it by making promises to yourself that are small enough to ALWAYS keep. Instead of 'I'll build the entire platform this month,' commit to 'I'll ship one feature this week.' Stack small wins until the dream feels possible again.",
    triggerPatterns: [
      "cynicism_rising",
      "low_expectations",
      "dream_abandoned",
      "settling_pattern",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 303,
    title: "The Pampered Royal",
    shortTitle: "Pampered Royal",
    essence:
      "Someone accustomed to getting what they want, who expects special treatment as their due. They are drawn to those who provide luxury, exclusivity, and personalized attention. In business, this is the high-value customer who expects premium service and will pay generously for it.",
    shopApplication:
      "The Pampered Royal drives a BMW, Mercedes, or luxury truck and expects the service experience to match the vehicle. Create a VIP tier at Nick's: reserved appointment slots, vehicle picked up and delivered, a text with photos when work is complete, a hand-wash before return. Charge 15-20% more for this tier — they WANT to pay more because cheap service feels beneath them. These customers have the highest lifetime value and the strongest referral networks. Cater to them explicitly and they'll bring their entire social circle.",
    nourApplication:
      "Recognize Pampered Royal customers and relationships in your life — people who need to feel special. Don't resent this need; leverage it. In business development, identify the prospects who value exclusivity over price. In personal life, recognize when your wife or family needs to feel prioritized and pampered — it's not high-maintenance, it's a legitimate need that, when met, creates deep loyalty and peace at home.",
    triggerPatterns: [
      "vip_customer_unserved",
      "premium_tier_missing",
      "luxury_expectation",
      "exclusivity_demand",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 304,
    title: "The New Prude",
    shortTitle: "New Prude",
    essence:
      "Someone who projects strict moral standards publicly but secretly desires to break free. They are drawn to situations that give them permission to do what they secretly want while maintaining their virtuous image. In business, this is the customer who wants quality but feels guilty spending — give them justification.",
    shopApplication:
      "The New Prude customer hesitates on the $1,200 brake job not because they can't afford it — but because they feel guilty spending that much on a car. Give them moral permission: 'This is a safety investment for your family. These brakes will protect your kids for the next 40,000 miles.' Reframe the expense as responsibility, not indulgence. The New Prude needs a justification story they can tell themselves (and their spouse). Provide that story and the sale closes itself.",
    nourApplication:
      "You have New Prude patterns around spending on yourself — gym memberships, quality food, tools, education. You want them but feel guilty because 'the money should go to the business.' Reframe: investing in your health, tools, and knowledge IS investing in the business because you are the business's most critical asset. Give yourself permission to spend on things that make you more effective.",
    triggerPatterns: [
      "spending_guilt",
      "justification_needed",
      "moral_framing",
      "permission_seeking",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 305,
    title: "The Crushed Star",
    shortTitle: "Crushed Star",
    essence:
      "Someone who once had attention, status, or success and lost it. They desperately want to recapture their former glory. In business, this is the customer or partner who used to be somebody and responds strongly to anyone who treats them like they still are.",
    shopApplication:
      "The Crushed Star might be the fleet manager who used to run a bigger operation, the car enthusiast who sold their project car, or the retired mechanic who misses the shop life. Treat them with the respect their FORMER status deserves. Ask for their opinion: 'You know engines — what do you think about this sound?' Involve them. Make them feel like an expert again. This emotional connection creates loyalty that transcends price and convenience. They'll drive across town to the shop that makes them feel important.",
    nourApplication:
      "Recognize Crushed Star energy in yourself after a project fails or a goal slips. The danger is chasing the validation of past wins instead of building toward new ones. When you reminisce about a coding breakthrough or a great business month, use it as fuel — not as evidence that you've declined. The Crushed Star recovers by creating NEW achievements, not relitigating old ones.",
    triggerPatterns: [
      "past_glory_fixation",
      "status_loss",
      "validation_seeking",
      "comeback_energy",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 306,
    title: "The Novice",
    shortTitle: "The Novice",
    essence:
      "Someone new to a domain, eager to learn but easily overwhelmed. They are drawn to confident guides who simplify complexity and make them feel capable. In business, this is the first-time customer who knows nothing about cars and is terrified of being ripped off.",
    shopApplication:
      "The Novice customer — often a young adult buying their first car or someone who's always had a spouse handle car stuff — is the most valuable long-term customer IF you treat them right. They will be loyal for DECADES to the first shop that treats them with respect. Train advisors: 'When someone doesn't know anything about cars, that's not a sales opportunity — it's a trust opportunity. Explain everything in plain English, show them what you're looking at, never make them feel stupid. They'll tell everyone they know about the shop that took the time to educate them.'",
    nourApplication:
      "When entering a new domain — marketing, finance, legal — you are the Novice. Resist the urge to pretend expertise you don't have. Instead, find one trusted mentor/resource in that domain and learn systematically. The Novice's greatest vulnerability is the fraudulent expert who exploits their ignorance. Protect yourself by cross-referencing advice and never committing large resources based on a single source's recommendation.",
    triggerPatterns: [
      "knowledge_gap",
      "first_time_customer",
      "expertise_fake",
      "education_opportunity",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 307,
    title: "The Conqueror",
    shortTitle: "The Conqueror",
    essence:
      "Someone motivated by challenge and competition. They want to win, overcome obstacles, and prove their superiority. They are repelled by easy victories and attracted to difficulty. In business, this is the customer who wants the best, not the cheapest — and values the hunt.",
    shopApplication:
      "The Conqueror customer doesn't want the discount package — they want the BEST package. Don't lead with price; lead with quality and exclusivity. 'We use Michelin Pilot Sport tires — same compound as what goes on Porsche GT3s. Most shops don't carry them. We keep them in stock because we have customers who won't settle for less.' The Conqueror responds to challenge and exclusivity. Make premium services feel like an achievement, not just a purchase. Create tiers that signal status.",
    nourApplication:
      "You are fundamentally a Conqueror type — motivated by challenge, bored by routine, energized by difficulty. This is a strength AND a vulnerability. Strength: you take on ambitious projects others avoid. Vulnerability: you abandon projects when the challenge phase ends and the grind phase begins. The hack: reframe maintenance as its own conquest. 'Can I run this system flawlessly for 30 days straight?' Make consistency the challenge.",
    triggerPatterns: [
      "challenge_seeking",
      "boredom_with_routine",
      "premium_positioning",
      "competition_drive",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 308,
    title: "The Exotic Fetishist",
    shortTitle: "Exotic Fetishist",
    essence:
      "Someone drawn to the foreign, unusual, and unfamiliar. They are bored by the conventional and seek novelty in experience, culture, and style. In business, this is the customer attracted to brands that feel different from everything else in the market.",
    shopApplication:
      "Position Nick's as the shop that does things DIFFERENTLY. Digital inspections with photos and video when competitors use paper. Text message updates instead of phone calls. A clean, modern waiting area when every other shop on Euclid has plastic chairs and a dusty TV. The Exotic Fetishist customer will choose you specifically because you don't feel like a typical auto shop. They're drawn to your Instagram presence, your professional branding, and the feeling that you're from a different era of auto repair.",
    nourApplication:
      "Your Exotic Fetishist tendency is your constant hunt for new tools, frameworks, and approaches. This creates genuine innovation but also creates the 'shiny object' problem. Channel this tendency productively: dedicate one day per month to exploring new tools freely. The rest of the month, execute with existing tools. This satisfies the novelty need without derailing production.",
    triggerPatterns: [
      "novelty_seeking",
      "shiny_object_syndrome",
      "differentiation_craving",
      "conventional_boredom",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 309,
    title: "The Drama Queen",
    shortTitle: "Drama Queen",
    essence:
      "Someone who thrives on emotional intensity and craves excitement in their daily life. They find ordinary life boring and are drawn to situations and people that create emotional peaks. In business, this is the customer who responds to storytelling, urgency, and emotional framing.",
    shopApplication:
      "The Drama Queen customer responds to narrative, not data. Don't say 'Your tire tread is at 3/32.' Say 'I've seen tires like this blow out on I-90 in the rain — your family is riding on these every day.' Paint the picture. Create emotional stakes. This isn't manipulation — it's communication that matches their processing style. They need to FEEL the urgency, not just understand it intellectually. For marketing: tell customer stories on your website. Before/after photos with captions. Video testimonials. Drama Queens buy stories, not specifications.",
    nourApplication:
      "You have Drama Queen energy that manifests as emotional intensity around wins and losses. A good day feels like conquering the world; a bad day feels like everything is falling apart. This emotional range is fuel for creativity but poison for consistency. Build systems (like NOUR OS daily scoring) that give you an OBJECTIVE view of your trajectory, independent of how you FEEL about it. The data corrects the drama.",
    triggerPatterns: [
      "emotional_intensity",
      "narrative_needed",
      "urgency_response",
      "boredom_danger",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 310,
    title: "The Professor",
    shortTitle: "The Professor",
    essence:
      "Someone who lives in their head — analytical, intellectual, and detached from emotion. They overthink everything and are seduced by ideas, systems, and frameworks. In business, this is the customer who researches exhaustively before buying and responds to data, not emotion.",
    shopApplication:
      "The Professor customer has already Googled their car's symptoms, read three forums, and has a theory about what's wrong. Don't dismiss their research — engage with it. 'You're right that it could be the CV joint. Based on the noise pattern you described, let me show you exactly what we find during the inspection.' Give them data: torque readings, tread depth measurements, comparison photos. They want to feel SMART about their decision, not sold. Provide the data that confirms their analytical process. They'll become loyal because you respected their intelligence.",
    nourApplication:
      "You ARE the Professor type — seduced by systems, frameworks, and intellectual models (Robert Greene, NOUR OS, strategic triggers). The danger: spending all your time designing systems and none executing them. Systems-as-procrastination is your primary anti-pattern. The cure: for every hour you spend designing a system, spend two hours USING it. If the system doesn't have 2 weeks of actual data in it, it's a fantasy, not a tool.",
    triggerPatterns: [
      "analysis_paralysis",
      "systems_over_execution",
      "data_driven_customer",
      "research_heavy",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 311,
    title: "The Beauty",
    shortTitle: "The Beauty",
    essence:
      "Someone who has always been admired for external qualities and secretly craves recognition for inner substance. They are tired of surface-level attention and are drawn to those who see past the exterior. In business, this is the premium brand customer who wants to be valued as a person, not just a wallet.",
    shopApplication:
      "The Beauty customer drives a nice car and other shops see dollar signs. Nick's should see a person. Don't comment on the car's value — comment on how well they maintain it. Don't upsell luxury packages because they can afford it — recommend what they actually need. This customer has been price-gouged by every dealership and luxury shop in Cleveland. The shop that treats them like a normal person — honest recommendations, fair prices, no markup for the luxury badge — earns their loyalty. They spend more over time BECAUSE you didn't try to take advantage.",
    nourApplication:
      "In personal branding, don't let external markers (the shop owner title, the coding skills, the system you built) become your entire identity. The Beauty pattern: being recognized only for surface achievements while your deeper qualities go unnoticed. Make sure your relationships — personal and professional — are built on substance, not just on what you produce. You are more than your output.",
    triggerPatterns: [
      "surface_recognition_only",
      "substance_overlooked",
      "premium_customer_gouged",
      "identity_beyond_output",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 312,
    title: "The Aging Baby",
    shortTitle: "Aging Baby",
    essence:
      "Someone who resists growing up and clings to youthful pleasures, irresponsibility, or indulgence. They are drawn to those who indulge their childlike desires without judgment. In business, this is the customer who wants to be taken care of completely — no decisions, no complexity, just results.",
    shopApplication:
      "The Aging Baby customer doesn't want to understand what's wrong with their car — they just want it fixed. 'Just do whatever it needs.' Don't overwhelm them with inspection findings and options. Give them a simple recommendation: 'Here's what your car needs to be safe and reliable for the next 6 months. Total is $X. Want us to go ahead?' They want a trusted parent figure for their car. Be that. Make it easy. Handle everything. These customers have the highest repeat rates because switching shops means learning to trust someone new — which requires effort they don't want to spend.",
    nourApplication:
      "Watch for Aging Baby tendencies: wanting someone else to handle the hard parts of business (taxes, HR, legal, difficult conversations). These are responsibilities you can delegate but never abdicate. The Aging Baby pattern in tech: wanting an AI or system to make all the decisions. NOUR OS should support decision-making, not replace it. You are the operator, not a passenger.",
    triggerPatterns: [
      "delegation_as_avoidance",
      "decision_abdication",
      "simplicity_over_engagement",
      "responsibility_resistance",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 313,
    title: "The Rescuer",
    shortTitle: "The Rescuer",
    essence:
      "Someone who derives identity and purpose from helping others. They are drawn to broken situations, struggling people, and fixable problems. In business, the Rescuer customer responds to vulnerability and the chance to 'save' a business or person.",
    shopApplication:
      "The Rescuer customer becomes your strongest advocate when they feel like they 'discovered' you. They respond to underdog stories: 'Young guy opens his own shop on the East Side, doing things the right way.' Craft your brand narrative around the honest, hardworking shop that needs community support to compete against the chains. The Rescuer will leave you 5-star reviews, refer friends, and defend you against critics because your success is their project. Don't fake vulnerability — channel your genuine story of building something from scratch.",
    nourApplication:
      "Your Rescuer tendency shows up in over-extending for others — taking on their problems, fixing their systems, solving their issues at the expense of your own priorities. Set boundaries. You can help people without becoming responsible for their outcomes. The Rescuer burns out when they measure their worth by how much they sacrifice for others. Measure worth by outcomes, not effort spent on others' behalf.",
    triggerPatterns: [
      "overextending_for_others",
      "savior_complex",
      "underdog_narrative",
      "boundary_violation",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 314,
    title: "The Roué",
    shortTitle: "The Roué",
    essence:
      "Someone worldly, experienced, and jaded — they've seen it all and are hard to impress. They are only drawn to genuine sophistication, competence, or novelty they haven't encountered. In business, the Roué customer has been to every shop and won't be fooled by marketing — only genuine quality impresses them.",
    shopApplication:
      "The Roué customer walks in skeptical. They've been to 10 shops and been disappointed by all of them. Don't try to charm them — demonstrate competence silently. Let the inspection photos speak for themselves. Let the organized, clean shop speak for itself. When they ask questions, answer directly without sales language. This customer respects directness and substance. If you impress a Roué, they become your most credible referral source because their endorsement carries weight — everyone knows they're hard to please.",
    nourApplication:
      "As you gain experience in business and tech, guard against becoming the Roué — so jaded that nothing impresses or motivates you. Maintain beginner's curiosity. Cynicism is the enemy of growth. At the same time, use your Roué instincts to filter advice: most business guidance is recycled garbage from people who've never built anything. Trust your own experience over generic counsel.",
    triggerPatterns: [
      "cynicism_rising",
      "jaded_perspective",
      "quality_skeptic",
      "experience_leverage",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 315,
    title: "The Idol Worshipper",
    shortTitle: "Idol Worshipper",
    essence:
      "Someone who places others on pedestals and seeks heroes, mentors, and role models to follow. They are drawn to confident leaders who project certainty and vision. In business, the Idol Worshipper becomes the most loyal customer or employee when they believe in the leader's vision.",
    shopApplication:
      "The Idol Worshipper employee will work harder than anyone if they believe in you as a leader. This is the tech who says 'I want to learn from you' or the advisor who models your work ethic. Earn their worship through consistent competence, not just charisma. Show up, work hard, make good decisions, treat people fairly. When you mess up, own it publicly — Idol Worshippers respect accountability even more than perfection. The Idol Worshipper customer recommends you with evangelical fervor — 'You HAVE to go to Nick's' — because your shop validates their judgment.",
    nourApplication:
      "Be cautious about your own Idol Worshipper tendencies — placing Robert Greene, Elon Musk, or any mentor on a pedestal. Extract principles, not identities. You should apply Greene's frameworks, not become his disciple. The difference: a student uses the master's tools to build their own thing. A worshipper tries to become the master. You are building YOUR system, informed by their wisdom, not imitating their life.",
    triggerPatterns: [
      "hero_worship",
      "mentor_dependence",
      "leader_credibility",
      "loyalty_through_vision",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 316,
    title: "The Sensualist",
    shortTitle: "The Sensualist",
    essence:
      "Someone who values physical experience, comfort, and pleasure above intellectual engagement. They are drawn to environments and experiences that feel good to the senses. In business, the Sensualist customer chooses based on atmosphere, comfort, and physical experience over logic or price.",
    shopApplication:
      "The Sensualist customer chooses a shop based on how it FEELS — not the Yelp rating, not the price. Clean waiting area, fresh coffee, comfortable seating, pleasant music, a bathroom that doesn't make them cringe. Invest in sensory details at Nick's: air fresheners in the customer area, a mounted TV with something watchable, filtered water, hand sanitizer. These micro-investments of $200/month generate thousands in retained customers who choose atmosphere over convenience. The Sensualist will drive past 3 closer shops to come to the one that feels right.",
    nourApplication:
      "Your work environment directly affects your output quality. The Sensualist principle for productivity: optimize your physical workspace. Clean desk, good lighting, quality chair, the right temperature, background music or silence (whichever helps). Don't code in chaos. Don't build systems in a cluttered environment. Your brain mirrors your surroundings. A refined workspace produces refined work.",
    triggerPatterns: [
      "environment_neglected",
      "comfort_investment",
      "sensory_experience",
      "workspace_quality",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 317,
    title: "The Lonely Leader",
    shortTitle: "Lonely Leader",
    essence:
      "Someone in a position of authority who feels isolated by their role. They crave genuine connection but can't find it because everyone around them has an agenda. In business, the Lonely Leader is the fleet manager, business owner, or executive who needs a trusted partner, not another vendor.",
    shopApplication:
      "The Lonely Leader fleet manager deals with vendors all day who see them as a revenue target. Nick's should be the shop that acts like a partner, not a vendor. Proactively flag vehicle issues before they become breakdowns. Provide quarterly fleet health reports without being asked. Call to say 'I noticed your van's brakes are getting close — want to schedule before it becomes an emergency?' This unprompted care builds the trust that Lonely Leaders desperately need but rarely find. They'll give you the entire fleet because you earned it through genuine partnership.",
    nourApplication:
      "As a business owner, you ARE the Lonely Leader. Your employees don't fully understand your stress. Your friends outside business don't get the pressure. Finding genuine peers — other shop owners, other young entrepreneurs — is not optional. It's a strategic necessity. Join a mastermind group, attend local business owner meetups, or build an advisory relationship with a mentor. Isolation leads to poor decisions because you lose perspective.",
    triggerPatterns: [
      "leadership_isolation",
      "peer_connection_missing",
      "vendor_vs_partner",
      "trust_deficit",
    ],
  },
  {
    book: "ART_OF_SEDUCTION" as const,
    number: 318,
    title: "The Floating Gender",
    shortTitle: "Floating Gender",
    essence:
      "Someone psychologically fluid, who doesn't fit rigid categories. They are drawn to others who are similarly unconventional and non-conformist. In business, this represents customers who don't fit typical demographics and respond to brands that defy categorization themselves.",
    shopApplication:
      "Don't assume every customer fits a stereotype. The woman who drives a lifted truck and knows more about engines than your techs exists. The young professional who drives a Prius but wants performance tires exists. The retiree who's modifying a project car exists. Train your team to read each individual customer, not apply demographic assumptions. The shop that treats every person as an individual — without assumptions based on age, gender, or vehicle type — earns loyalty from the people that other shops make feel uncomfortable or invisible.",
    nourApplication:
      "You don't fit conventional categories — shop owner AND developer, blue collar AND tech, practical AND strategic. This is a strength. Stop trying to explain yourself through one lens. Your brand, your career, your identity operates across traditional boundaries. Embrace the ambiguity. The people who find you interesting are the ones who also don't fit neatly into categories. They become your strongest community.",
    triggerPatterns: [
      "category_assumption",
      "demographic_stereotyping",
      "unconventional_identity",
      "niche_defiance",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// MASTERY EXPANSION (Mastery 13-20)
// ═══════════════════════════════════════════════════════════════════

const masteryExpansion = [
  {
    book: "MASTERY" as const,
    number: 13,
    title: "The Resistance Phase",
    shortTitle: "Resistance Phase",
    essence:
      "Every path to mastery hits a wall — the Resistance Phase — where progress plateaus, boredom sets in, and the temptation to quit peaks. This is where most people abandon their pursuit. The ones who push through discover that the plateau was the final test before a breakthrough. The discomfort IS the signal that growth is happening beneath the surface.",
    shopApplication:
      "At Nick's, the Resistance Phase hits around month 6-12 of any new initiative — digital inspections, a new CRM, a fleet outreach program. Initial excitement fades, the system feels like extra work, and the team wants to go back to the old way. This is EXACTLY when you must hold the line. The shops that push through the resistance phase with new systems see exponential returns in year 2. The shops that quit go back to mediocrity. When your team resists a new process, acknowledge the difficulty but don't retreat. 'I know this is harder right now. That's temporary. The results are coming.'",
    nourApplication:
      "Your core pattern is Resistance Phase failure — you build systems with intense energy for 2-4 weeks, hit the resistance wall, feel bored or frustrated, and pivot to a new shiny project. NOUR OS, daily scoring, habit tracking — all have hit this wall. The breakthrough: recognize the resistance as a PREDICTABLE phase, not a signal to stop. When you feel the urge to abandon a system, set a timer: 30 more days. If after 30 days of committed use the system still doesn't work, then pivot. But not before.",
    triggerPatterns: [
      "plateau_frustration",
      "system_abandonment",
      "boredom_with_process",
      "novelty_seeking_escape",
      "consistency_failure",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 14,
    title: "The 10,000 Hours Principle",
    shortTitle: "Deep Practice",
    essence:
      "Mastery requires approximately 10,000 hours of deliberate, focused practice — not passive repetition, but active engagement at the edge of your ability. Quality of practice matters more than quantity. One hour of focused, challenging work beats four hours of comfortable repetition. Deep practice means working on weaknesses, not strengths.",
    shopApplication:
      "A tech with 10 years of experience who's been doing the same oil changes isn't a master — they have 1 year of experience repeated 10 times. Deep practice at Nick's means intentionally taking on harder diagnostics, learning new systems (hybrid engines, ADAS calibration), and studying why repairs fail. Send techs to training. Challenge them with the jobs they'd normally refuse. Track diagnostic accuracy rates. The shop that invests in deep practice builds a team that can handle anything — and customers pay premium prices for that confidence.",
    nourApplication:
      "Your coding hours are high, but are they DEEP practice hours? Building a new page layout for the 10th time isn't deliberate practice. Deliberately studying TypeScript's type system, mastering Prisma's advanced queries, or learning deployment optimization — that's deep practice. Track your deep practice hours separately from your coding hours. Aim for 2 hours of genuine deep practice per week — learning something at the edge of your current ability, not reinforcing what you already know.",
    triggerPatterns: [
      "comfort_zone_stagnation",
      "passive_repetition",
      "skill_plateau",
      "training_neglected",
      "deliberate_practice_absent",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 15,
    title: "Emotional Pitfalls on the Path to Mastery",
    shortTitle: "Emotional Pitfalls",
    essence:
      "Five emotional traps derail the journey to mastery: boredom (leading to distraction), panic (leading to shortcuts), ego (leading to complacency), complacency (leading to stagnation), and envy (leading to comparison). Each has a specific antidote. Recognizing the trap IS the escape — most people are controlled by emotions they don't even notice.",
    shopApplication:
      "Watch for these traps at Nick's: BOREDOM — the team gets sloppy on routine jobs (torque specs, fluid levels). PANIC — rushing a difficult repair because the customer is waiting. EGO — a tech refuses to double-check their work or ask for help. COMPLACENCY — 'We've always done it this way.' ENVY — comparing to the flashy shop down the street instead of focusing on your own growth. Create systems to catch each: checklists for boredom, time buffers for panic, peer review for ego, quarterly process reviews for complacency, and competitive analysis for envy.",
    nourApplication:
      "Your primary emotional pitfalls: BOREDOM (abandoning systems), EGO (building complex solutions when simple ones work), and ENVY (comparing your progress to others online). The antidotes: BOREDOM → reframe routine as mastery practice. EGO → measure by results, not complexity. ENVY → compare to yesterday's version of yourself, not someone else's highlight reel. Map each pitfall to a NOUR OS trigger that fires when the pattern emerges.",
    triggerPatterns: [
      "boredom_distraction",
      "panic_shortcut",
      "ego_complacency",
      "comparison_envy",
      "emotional_trap_active",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 16,
    title: "The Master's Return to Childhood Curiosity",
    shortTitle: "Return to Curiosity",
    essence:
      "Masters in any field share a quality: they maintain (or recover) the open, curious mindset of childhood. As we gain expertise, we tend to narrow our focus and become rigid. The final stage of mastery is a return to childlike wonder — seeing the field with fresh eyes while possessing expert knowledge. This synthesis of experience and openness produces true creative breakthroughs.",
    shopApplication:
      "The master mechanic who's been fixing cars for 30 years can either become rigid ('I've seen everything, nothing surprises me') or curious ('Every car teaches me something new'). Foster curiosity at Nick's: when a weird diagnostic comes in, make it a learning opportunity for the team, not just a frustration. Subscribe to technical bulletins. Watch YouTube teardowns of new vehicles. The shop that stays curious adapts to new technology (EVs, ADAS, hybrids) while rigid shops die wondering where the customers went.",
    nourApplication:
      "Your natural curiosity is your greatest asset — don't let expertise kill it. As you get better at coding, business, or systems design, maintain the beginner's willingness to ask 'Why does this work?' and 'What if we did it differently?' The moment you stop being curious about your own field is the moment you start declining. Schedule 'curiosity time' — exploring with no specific goal, just genuine interest. This is where your best ideas will come from.",
    triggerPatterns: [
      "curiosity_declining",
      "rigidity_increasing",
      "expertise_arrogance",
      "exploration_absent",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 17,
    title: "Connecting to Your Environment",
    shortTitle: "Environmental Awareness",
    essence:
      "Masters develop an acute sensitivity to their environment — reading social cues, sensing shifts in mood or energy, and adapting in real-time. This is not mystical; it's the result of thousands of hours of attentive observation. In any field, the ability to read the room, the market, or the situation is as important as technical skill.",
    shopApplication:
      "An exceptional service advisor reads the customer within the first 30 seconds: Are they anxious? Rushed? Chatty? Skeptical? Angry about the last shop? The advisor who calibrates their approach to the customer's energy closes more work and generates more trust. Train environmental awareness at Nick's: 'How did the customer FEEL when they walked in? What changed during our conversation? What body language told us they weren't comfortable with the price?' This is the difference between a good advisor and a great one.",
    nourApplication:
      "Develop sensitivity to your own environment: What time of day are you sharpest? What physical conditions help you focus? What social interactions drain vs. energize you? What emotional states precede your best work vs. your worst? Track these patterns in NOUR OS daily logs. Over time, you'll develop a map of your optimal conditions — and you can engineer your days to match. Environmental mastery means designing your life's conditions, not just reacting to them.",
    triggerPatterns: [
      "environmental_blindness",
      "social_cue_missed",
      "energy_awareness_low",
      "context_reading_poor",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 18,
    title: "The Creative-Active Phase",
    shortTitle: "Creative-Active",
    essence:
      "After years of disciplined apprenticeship, the master enters the Creative-Active phase — where accumulated knowledge recombines into original insights. This is not random inspiration; it's the result of a saturated mind finding new connections between familiar elements. The Creative-Active phase requires both deep knowledge AND the willingness to break conventional rules.",
    shopApplication:
      "The Creative-Active phase at Nick's is when you have enough experience to innovate on the business model itself. Maybe it's a subscription maintenance plan that no other shop on the East Side offers. Maybe it's a mobile service unit for fleet customers. Maybe it's an AI-powered diagnostic pre-screening tool. These innovations come from YEARS of understanding the conventional model so deeply that you can see where it breaks. You can't shortcut to this — you need the operational mastery first.",
    nourApplication:
      "NOUR OS itself is a Creative-Active product — it recombines your knowledge of business operations, personal development, and software engineering into something that doesn't exist elsewhere. Protect this creative work by maintaining the foundational skills that feed it. If you stop running the shop, stop coding, or stop studying strategy, the creative synthesis loses its source material. The Creative-Active phase requires continuous input, not just output.",
    triggerPatterns: [
      "innovation_opportunity",
      "conventional_breaking_point",
      "creative_synthesis",
      "input_starvation",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 19,
    title: "Mentors and Their Limitations",
    shortTitle: "Mentor Dynamics",
    essence:
      "Mentors accelerate learning by compressing decades of experience into direct transmission. But every mentor has blind spots, biases, and a style that may not match yours perfectly. The ideal apprenticeship absorbs the master's knowledge while maintaining your own identity. Eventually, you must surpass your mentors — not out of disrespect, but as the natural conclusion of genuine learning.",
    shopApplication:
      "Find mentors in auto repair — shop owners who've been successful for 20+ years. Learn their operational wisdom, customer handling, and financial discipline. But don't copy them blindly. Their generation didn't have digital marketing, AI tools, or the same customer expectations. Take what works, discard what's outdated, and build YOUR version of a great shop. The worst mistake: either ignoring experienced mentors entirely (arrogance) or following them slavishly without adapting to current reality (dependence).",
    nourApplication:
      "Robert Greene is a mentor through his books — but his frameworks are tools, not scripture. Apply them to YOUR context, not his. The same principle applies to tech mentors, business influencers, and online educators. Extract principles, not prescriptions. The moment you catch yourself thinking 'What would [mentor] do?' instead of 'What does this situation require?' — you've crossed from learning into dependence. Think for yourself, informed by mentors.",
    triggerPatterns: [
      "mentor_dependence",
      "blind_copying",
      "wisdom_extraction",
      "independence_needed",
    ],
  },
  {
    book: "MASTERY" as const,
    number: 20,
    title: "The Intuitive Mind",
    shortTitle: "Intuitive Mastery",
    essence:
      "The highest level of mastery is intuitive — where rational analysis and experiential knowledge merge into instant, accurate judgment. The master makes decisions that FEEL instantaneous but are actually the product of thousands of hours of pattern recognition. This intuition is not mystical; it's compressed expertise. Trust it — but verify it with data when stakes are high.",
    shopApplication:
      "A master technician hears an engine and knows what's wrong before running diagnostics. A master service advisor reads a customer's tone and knows whether to push the upsell or back off. This intuition develops only through years of deliberate attention. At Nick's, encourage experienced team members to share their intuitive reads: 'What did you notice?' 'What does your gut say?' Then verify with data. The combination of intuition and verification produces the best outcomes — faster than pure analysis, more reliable than pure gut feeling.",
    nourApplication:
      "You're developing intuitive mastery in coding — you can feel when code is 'right' or 'wrong' before understanding exactly why. Trust this sense but verify it. In business, your intuitive reads on customers, employees, and opportunities are getting more accurate with experience. Track your gut calls vs. actual outcomes in your decision log. Over time, you'll learn where your intuition is sharp and where it's biased. Sharpen the sharp parts, compensate for the biased parts.",
    triggerPatterns: [
      "intuition_ignored",
      "analysis_paralysis",
      "pattern_recognition",
      "gut_feeling_vs_data",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// THE 50TH LAW (FIFTIETH_LAW 1-10)
// ═══════════════════════════════════════════════════════════════════

const fiftiethLaw = [
  {
    book: "FIFTIETH_LAW" as const,
    number: 1,
    title: "See Things for What They Are — Intense Realism",
    shortTitle: "Intense Realism",
    essence:
      "Most people see the world through a filter of wishes, fears, and assumptions. Intense realism means stripping away these distortions and seeing circumstances, people, and markets as they ACTUALLY are. This clarity is painful but powerful — every good decision begins with an accurate read of reality. Avoid both optimistic delusion and pessimistic paralysis.",
    shopApplication:
      "Look at Nick's financials, customer numbers, and team performance with unfiltered honesty. If the average ticket is $180 and the shop on Detroit Ave averages $320, that's not a market difference — it's an execution gap. If a tech is consistently slow or sloppy, that's not a training issue — it's a fit issue. The Intense Realism move: review your P&L monthly, track real close rates, and compare your metrics to industry benchmarks. What you discover may be uncomfortable, but it's the foundation for every improvement.",
    nourApplication:
      "Apply intense realism to your own patterns. If you've started and abandoned 5 systems in the last year, the problem isn't the systems — it's the cycle. If your daily score averages 4/10 despite having 'the perfect system,' the system isn't the bottleneck — your discipline is. NOUR OS should be a tool for seeing reality clearly, not a shield against it. Every dashboard should show REAL data, even when it's ugly.",
    triggerPatterns: [
      "reality_avoidance",
      "wishful_thinking",
      "data_ignored",
      "honest_assessment_needed",
      "delusion_pattern",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 2,
    title: "Make Everything Your Own — Self-Reliance",
    shortTitle: "Self-Reliance",
    essence:
      "Dependence on others — for income, validation, knowledge, or security — is the deepest form of vulnerability. True power comes from developing the skills, resources, and mindset to sustain yourself independently. This doesn't mean isolation — it means ensuring that no single dependency can destroy you if removed.",
    shopApplication:
      "Nick's should never depend on a single revenue stream, single vendor, single employee, or single marketing channel. If one tech quitting can cripple the shop, you're not a business — you're a hostage situation. Cross-train employees. Develop relationships with multiple parts suppliers. Build a customer base diverse enough that losing one fleet account doesn't threaten survival. Self-reliance at the business level means: if any single element disappeared tomorrow, the shop would survive and recover within 30 days.",
    nourApplication:
      "Your self-reliance instinct is strong — building your own systems, running your own business, refusing to be an employee. But watch for hidden dependencies: if Vercel goes down, can NOUR OS function? If one AI provider changes pricing, is your stack flexible enough to switch? If your laptop dies, can you recover everything in 24 hours? Audit your dependencies quarterly and build fallbacks for the critical ones.",
    triggerPatterns: [
      "single_dependency",
      "vendor_lock_in",
      "key_person_risk",
      "self_reliance_gap",
      "fallback_missing",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 3,
    title: "Turn Shit into Sugar — Opportunism",
    shortTitle: "Opportunism",
    essence:
      "Every setback, failure, and crisis contains a hidden opportunity for those who maintain clarity and composure. The opportunist doesn't just survive adversity — they use it as fuel for growth. Bad events become learning events. Recessions become market-share grabs. Failures become pivots. The key is mental agility: the speed at which you stop mourning the loss and start exploiting the new reality.",
    shopApplication:
      "When a competitor closes, their customers need a new shop — be ready. When a negative Google review appears, respond publicly with class and turn it into a demonstration of your customer service. When a slow week hits, use the downtime for deep cleaning, training, and marketing. When a tech quits unexpectedly, use it to restructure roles and hire someone better. At Nick's, every 'bad' event should trigger the question: 'How do we use this?' Never waste a crisis.",
    nourApplication:
      "Your biggest breakthroughs follow your biggest frustrations — a failed deployment teaches you infrastructure. A system that broke forces you to build something better. Train yourself to ask 'What can I learn from this?' within 5 minutes of any setback, before the emotional spiral begins. NOUR OS should track setback-to-opportunity conversions: every time something goes wrong, log what you turned it into.",
    triggerPatterns: [
      "setback_without_reframe",
      "crisis_wasted",
      "negativity_spiral",
      "opportunity_in_adversity",
      "competitor_exit",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 4,
    title: "Keep Moving — Calculated Momentum",
    shortTitle: "Calculated Momentum",
    essence:
      "Stagnation is death — in business, in personal growth, in every dimension of life. The 50th Law demands constant forward motion: expanding, improving, adapting. But momentum must be CALCULATED, not reckless. Move forward with purpose and direction, not just speed. The danger is not failure — it's standing still.",
    shopApplication:
      "Nick's should never plateau at 'good enough.' Each quarter should have one growth initiative: a new service offering (ADAS calibration), a new revenue stream (fleet contracts), a process improvement (digital inspections), or a marketing push (Google Ads, Instagram content). Standing still means being overtaken. But calculated means each initiative gets proper resources and attention — don't launch 5 things at once and execute none of them well. One initiative, fully executed, per quarter.",
    nourApplication:
      "Your challenge with momentum is not starting — it's sustaining. You have explosive starts and gradual stops. Calculated momentum means: one major project in motion at all times, with daily minimum progress (even 30 minutes). When you feel the urge to stop, reduce the pace instead of halting. Going from 4 hours/day to 30 minutes/day is better than going from 4 hours/day to zero. Never let a day pass with zero forward motion on your primary objective.",
    triggerPatterns: [
      "stagnation_detected",
      "momentum_lost",
      "growth_initiative_absent",
      "zero_progress_day",
      "plateau_comfort",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 5,
    title: "Know When to Be Bad — Aggression",
    shortTitle: "Strategic Aggression",
    essence:
      "Niceness as a default strategy is a weakness. There are moments that demand aggression: negotiating with vendors who are overcharging you, firing employees who are dragging the team down, confronting a competitor who's spreading lies, or cutting off a client who disrespects your team. Strategic aggression means choosing the right moments to be ruthless — and being comfortable with the discomfort.",
    shopApplication:
      "When a parts vendor raises prices 15% with no justification, don't accept it politely — counter aggressively or switch suppliers on the spot. When a customer verbally abuses your staff, ban them from the shop immediately and publicly support your team. When a competitor runs a dishonest ad campaign, document it and report it. When a tech shows up late for the third time, terminate without a fourth warning. Niceness in these moments isn't kindness — it's cowardice that signals weakness to everyone watching.",
    nourApplication:
      "Your natural conflict avoidance costs you money and respect. Practice strategic aggression: renegotiate your worst vendor contract this week. Have the difficult conversation you've been avoiding. Set a boundary you've been letting slide. Aggression is not anger — it's decisive action taken without apology when the situation demands it. Track 'aggressive actions taken' in your decision log. If the count is zero for two weeks, you're being too passive.",
    triggerPatterns: [
      "conflict_avoidance",
      "boundary_not_enforced",
      "vendor_overcharging",
      "employee_underperforming",
      "aggression_needed",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 6,
    title: "Lead from the Front — Authority",
    shortTitle: "Lead from Front",
    essence:
      "Authority is earned by example, not title. The leader who does the work alongside the team, who takes the hardest problems, who shows up first and leaves last — earns a loyalty that no amount of management theory can replicate. Leading from the front means embodying the standard you set, not just enforcing it.",
    shopApplication:
      "If you expect your techs to keep their bays clean, your office should be spotless. If you expect advisors to make follow-up calls, you should be making calls too. If you expect the team to show up on time, you should be there before them. At Nick's, the owner who rolls up their sleeves — jumping into a bay when they're short-staffed, taking a difficult customer call personally, cleaning the shop bathroom when it needs it — earns respect that translates into team performance. Never ask the team to do something you're not willing to do yourself.",
    nourApplication:
      "Lead from the front in your own life: do the hard things first each day. Complete your non-negotiables before touching the fun stuff. Execute before you strategize. Ship before you plan the next feature. The discipline you demand of your systems (NOUR OS, habit tracking, daily scoring) must be discipline you model first. A system designed by someone who doesn't use it is a fantasy. Use your own tools religiously.",
    triggerPatterns: [
      "authority_gap",
      "hypocrisy_detected",
      "leading_by_example",
      "standard_not_modeled",
      "first_in_last_out",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 7,
    title: "Know Your Environment from the Inside Out — Connection",
    shortTitle: "Inside-Out Knowledge",
    essence:
      "True strategic power comes from intimate, ground-level knowledge of your environment. The executive who only reads reports is blind compared to the one who walks the floor. Know your customers by name. Know your neighborhood. Know the supply chain from raw material to installed part. This insider knowledge is your unfair advantage — it cannot be Googled.",
    shopApplication:
      "Walk the shop floor daily. Talk to every customer personally at least once per week. Know the names of the regulars, their vehicles, their concerns. Know the other businesses on your street — the pizza shop owner, the barber, the gas station attendant — because they refer customers. Know your parts suppliers' delivery schedules, their margins, and their competitors. This granular knowledge lets you make decisions faster and better than any competitor relying on spreadsheets and dashboards alone. The dashboard shows data. The floor shows reality.",
    nourApplication:
      "Know your own operating patterns from the inside — not from the data NOUR OS shows you, but from visceral self-awareness. What does it FEEL like when you're about to drift? What physical sensations precede a productivity collapse? What time of day does your energy actually peak, regardless of what the data says? The deepest self-knowledge comes from paying attention to your own experience, then cross-referencing with the data. Neither alone is sufficient.",
    triggerPatterns: [
      "ground_level_disconnected",
      "customer_knowledge_thin",
      "neighborhood_unknown",
      "data_only_decisions",
      "visceral_awareness_low",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 8,
    title: "Respect the Process — Mastery",
    shortTitle: "Respect the Process",
    essence:
      "There are no shortcuts to real achievement. The process is slow, unglamorous, and repetitive — and that is exactly what makes the result valuable. Respecting the process means embracing the daily grind, the incremental progress, and the long periods where results aren't visible. Impatience is the enemy of mastery. Trust that consistent, quality effort compounds.",
    shopApplication:
      "Building Nick's into a dominant shop takes years, not months. The process: show up every day. Do quality work on every car. Follow up with every customer. Post content consistently. Improve one thing each month. This is not exciting — but the shop that does this for 5 years straight will own its market. The shops that chase exciting strategies, pivot constantly, and look for shortcuts end up exactly where they started. Respect the process. The compound effect is real, but it requires patience measured in years.",
    nourApplication:
      "Respect the process of becoming who you want to be. Daily scoring, habit tracking, strategic reflection — these feel tedious day-to-day but transform your life over 6-12 months. The NOUR OS philosophy IS the process philosophy: small daily inputs, compounding over time. Don't abandon the process because week 3 doesn't look dramatically different from week 1. The transformation is happening below the surface. Trust the data over your feelings. Show up tomorrow regardless of today's score.",
    triggerPatterns: [
      "shortcut_seeking",
      "patience_exhausted",
      "process_abandoned",
      "compound_effect_ignored",
      "instant_gratification",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 9,
    title: "Push Beyond Your Limits — Self-Belief",
    shortTitle: "Push Beyond Limits",
    essence:
      "Your self-imposed limits are the ceiling on your achievement. Most limits are psychological — inherited beliefs about what someone like you can accomplish. The 50th Law says: test every limit. Push past what feels comfortable. The discomfort of expansion is temporary; the expanded capability is permanent. You don't know what you're capable of until you've been pushed further than you thought possible.",
    shopApplication:
      "Push Nick's beyond what feels comfortable. Apply for the fleet contract you think is too big. Raise prices on the service you know you deliver better than competitors. Hire the technician who seems overqualified. Invest in the equipment that feels too expensive. Every expansion of the business required pushing past a comfort zone — opening the shop, hiring the first employee, buying the first lift. The next level requires the same willingness to be uncomfortable. The limit is in your head, not in the market.",
    nourApplication:
      "Push beyond your self-imposed limits in every domain. If you think you can't run a mile, try it. If you think you can't learn Spanish, start today. If you think NOUR OS can't compete with established products, build it anyway. Your greatest breakthroughs came from attempting things you weren't sure you could do. Failure is data. Staying comfortable is stagnation. Set one goal this month that genuinely scares you — the kind where you're not sure you can pull it off. That's the growth edge.",
    triggerPatterns: [
      "self_imposed_limit",
      "comfort_zone_stagnation",
      "ambition_ceiling",
      "fear_of_expansion",
      "playing_small",
    ],
  },
  {
    book: "FIFTIETH_LAW" as const,
    number: 10,
    title: "Confront Your Mortality — The Sublime",
    shortTitle: "Confront Mortality",
    essence:
      "The ultimate source of fearlessness is confronting death. Not morbidly — practically. When you truly internalize that your time is finite, every wasted day becomes painful, every petty conflict becomes irrelevant, and every meaningful pursuit becomes urgent. The awareness of death is not depressing — it is the most powerful motivator available. It strips away everything trivial and reveals what actually matters.",
    shopApplication:
      "Imagine Nick's without you in 5 years — either because you chose to sell it, or because life changed unexpectedly. Is the business built to survive? Does it have systems, processes, and a team that can operate without your daily presence? Building a business that transcends you is the ultimate business achievement. Work toward making yourself optional — not because you want to leave, but because a business that depends entirely on one person is fragile. Create standard operating procedures. Train leaders. Build the machine that runs without you.",
    nourApplication:
      "Confront your mortality by asking: if you had 5 years left, would you spend today the way you're spending it? Would you scroll, hesitate, procrastinate, and drift? Or would you execute with urgency? The awareness of finite time is the antidote to every form of drift. When you catch yourself wasting a day, remember: you will not get it back. This day is gone forever. NOUR OS should have a mortality metric — not to be morbid, but to maintain perspective on what matters and what doesn't.",
    triggerPatterns: [
      "time_wasting",
      "urgency_absent",
      "legacy_thinking",
      "mortality_awareness",
      "trivial_priorities",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * 2026-07-27 · exported so `seed-greene-all.ts` can run this alongside
 * `seed-all.ts`. Previously this file was standalone-only, and
 * `seed-all.ts` never imported it — so the canonical "master seed
 * runner" silently omitted all 56 expansion rows (MASTERY 13-20,
 * the seduction archetypes, and all of FIFTIETH_LAW) while still
 * printing "Seed verified OK", because its floor check is `total < 120`
 * and the remaining books clear 120 on their own.
 */
export const GREENE_EXPANSION_ENTRIES = [
  ...seducerArchetypes,
  ...antiSeducerTypes,
  ...victimTypes,
  ...masteryExpansion,
  ...fiftiethLaw,
];

export async function seedGreeneExpansion(
  prisma: PrismaClient,
): Promise<{ upserted: number; errors: number }> {
  const allEntries = GREENE_EXPANSION_ENTRIES;

  console.log(`Seeding ${allEntries.length} Greene expansion entries...\n`);

  let created = 0;
  let errors = 0;

  for (const entry of allEntries) {
    try {
      const tp = Array.isArray(entry.triggerPatterns)
        ? entry.triggerPatterns
        : JSON.parse(entry.triggerPatterns as string);

      await prisma.strategicLaw.upsert({
        where: {
          book_number: { book: entry.book, number: entry.number },
        },
        create: {
          book: entry.book,
          number: entry.number,
          title: entry.title,
          shortTitle: entry.shortTitle,
          essence: entry.essence,
          shopApplication: entry.shopApplication,
          nourApplication: entry.nourApplication,
          triggerPatterns: tp,
        },
        update: {
          title: entry.title,
          shortTitle: entry.shortTitle,
          essence: entry.essence,
          shopApplication: entry.shopApplication,
          nourApplication: entry.nourApplication,
          triggerPatterns: tp,
        },
      });
      created++;
      process.stdout.write(`  ✓ ${entry.book} #${entry.number}: ${entry.shortTitle}\n`);
    } catch (err: any) {
      errors++;
      console.error(`  ✗ ${entry.book} #${entry.number}: ${err.message}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Expansion complete: ${created} upserted, ${errors} errors`);

  return { upserted: created, errors };
}

/** Standalone entrypoint · kept so the original invocation still works.
 *  Prefer `pnpm seed:greene`, which runs every store in one pass. */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  await seedGreeneExpansion(prisma);

  // Verify total
  const total = await prisma.strategicLaw.count();
  const byBook = await prisma.strategicLaw.groupBy({
    by: ["book"],
    _count: true,
  });

  console.log(`\nTotal laws in database: ${total}`);
  console.log("By book:");
  for (const b of byBook) {
    console.log(`  ${b.book}: ${b._count}`);
  }

  if (total >= 180) {
    console.log(`\n✅ Library expansion verified — ${total} laws total`);
  } else {
    console.error(`\n⚠️ Expected 180+, got ${total}`);
  }

  await prisma.$disconnect();
}

// Only self-run when invoked directly, not when imported by the
// combined runner (which supplies its own client + ordering).
if (process.argv[1]?.includes("seed-greene-expansion")) {
  main().catch(console.error);
}
