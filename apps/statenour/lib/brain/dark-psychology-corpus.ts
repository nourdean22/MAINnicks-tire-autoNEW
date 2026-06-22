/**
 * Dark psychology + negotiation + competitive intel corpus.
 *
 * Mirrors the Greene corpus shape (GreeneEntry) so the same seed script
 * pattern, matcher, and BrainMemory metadata shape all work unchanged.
 *
 * Sources:
 *   · P0WER Handbook v1-v5.5 (D4RKH0R1Z0N) — cognitive biases, manipulation,
 *     social engineering, emotional control, body language
 *   · Never Split the Difference (Chris Voss) — negotiation patterns
 *   · Chanakya Neeti — economic warfare, competitive intelligence
 *   · BOLD: 212 Charisma Tips — social tactics (selective)
 *
 * Each entry follows the GreeneEntry interface so the seed script, the
 * dark-psychology-matcher, and the BrainMemory metadata are all consistent.
 */

import type { GreeneEntry } from "@/lib/brain/greene/schema";

// ── Dark Psychology (cognitive biases + manipulation techniques) ──────

const ANCHORING_BIAS: GreeneEntry = {
  key: "dp_anchoring_bias",
  book: "48LP", // reusing GreeneBook type; sourceBook in metadata is the real label
  type: "principle",
  title: "Anchoring Bias — The First Number Wins",
  summary:
    "The first number stated in a negotiation becomes the psychological anchor. All subsequent adjustments are measured against it, not against reality.",
  fullText:
    "When you state a price first, you set the anchor. Even if it's extreme, the other party's counter-offer will be pulled toward it. This is why car dealerships put MSRP stickers on windows — the brain latches onto the first number and adjusts from there, rarely far enough. Use: open with a specific, justified number that favors you. Counter: when someone anchors you, reject it explicitly and re-anchor with your own number + rationale.",
  triggers: ["price", "negotiate", "negotiation", "offer", "counter", "deal", "money", "salary", "budget"],
  actions: [
    "Set the anchor first with a specific, well-justified number",
    "If they anchor first, explicitly reject it and re-anchor with your own number",
    "Use precise numbers (e.g. $47 not $50) — they feel researched and harder to move",
  ],
  relatedKeys: ["dp_scarcity", "dp_illusion_of_choice", "neg_accusation_audit"],
  applicabilityPrompt:
    "Does this interaction involve setting or responding to a price, offer, or numerical terms?",
};

const SCARCITY_PRINCIPLE: GreeneEntry = {
  key: "dp_scarcity",
  book: "48LP",
  type: "principle",
  title: "Scarcity — People Want What They Can't Have",
  summary:
    "Perceived scarcity creates urgency. Limited-time offers, exclusive access, and 'last chance' framing exploit the brain's loss-aversion circuitry.",
  fullText:
    "The brain weights potential losses roughly 2x heavier than equivalent gains. When something becomes scarce, the desire for it spikes — not because it's better, but because losing access feels like a loss. Use: create genuine scarcity (limited slots, time-bound offers, exclusive access). Counter: ask 'would I want this if it were unlimited?' to break the spell.",
  triggers: ["scarcity", "limited", "exclusive", "urgent", "deadline", "last chance", "fomo", "waiting"],
  actions: [
    "Create genuine scarcity — limited slots, time-bound windows, exclusive tiers",
    "Frame inaction as a loss, not just a missed gain",
    "When targeted: ask 'would I want this if supply were unlimited?'",
  ],
  relatedKeys: ["dp_anchoring_bias", "dp_illusion_of_choice", "law_16"],
  applicabilityPrompt:
    "Is the operator trying to create urgency, drive action, or being pressured by a limited-time offer?",
};

const ILLUSION_OF_CHOICE: GreeneEntry = {
  key: "dp_illusion_of_choice",
  book: "48LP",
  type: "principle",
  title: "Illusion of Choice — Offer Two Options You Both Win",
  summary:
    "Presenting two options that both benefit you makes the other party feel in control while you control the outcome either way.",
  fullText:
    "Never ask 'will you?' — ask 'which one?' Offering A vs B where both work for you is more powerful than a yes/no question. The brain experiences agency even when the frame is rigged. Use: 'Would you prefer Tuesday at 2pm or Thursday at 10am?' instead of 'Can we meet this week?' Counter: when given a forced choice, introduce option C that they didn't offer.",
  triggers: ["choice", "options", "decide", "either", "or", "prefer", "which"],
  actions: [
    "Replace yes/no questions with 'which one?' framing",
    "Offer two options where both benefit you",
    "When trapped in a forced choice, introduce a third option they didn't offer",
  ],
  relatedKeys: ["dp_anchoring_bias", "dp_scarcity", "neg_calibrated_question"],
  applicabilityPrompt:
    "Is the operator trying to get someone to commit, choose, or decide between options?",
};

const SOCIAL_PROOF: GreeneEntry = {
  key: "dp_social_proof",
  book: "48LP",
  type: "principle",
  title: "Social Proof — Others Validate, So It Must Be Good",
  summary:
    "People look to what others are doing when uncertain. Reviews, testimonials, and 'popular choice' framing reduce decision friction.",
  fullText:
    "When uncertain, the brain outsources judgment to the crowd. 1,700 reviews at 4.9 stars is more persuasive than any logical argument about quality. Use: surface specific social proof (numbers + stories), not vague claims. Counter: ask 'would this be good if nobody else were doing it?'",
  triggers: ["reviews", "social proof", "testimonials", "popular", "everyone", "others", "rating"],
  actions: [
    "Surface specific social proof — exact numbers + named testimonials",
    "Show what comparable peers chose, not just raw counts",
    "When targeted: ask 'would this be good if nobody else were doing it?'",
  ],
  relatedKeys: ["dp_scarcity", "dp_authority_bias", "dp_anchoring_bias"],
  applicabilityPrompt:
    "Is the operator trying to persuade, build trust, or being influenced by crowd behavior?",
};

const AUTHORITY_BIAS: GreeneEntry = {
  key: "dp_authority_bias",
  book: "48LP",
  type: "principle",
  title: "Authority Bias — People Defer to Perceived Authority",
  summary:
    "Titles, uniforms, credentials, and confident body language trigger automatic compliance. The brain shortcuts to 'they must know better.'",
  fullText:
    "Milgram's experiments showed people will obey authority even against their own conscience. In business: a confident tone + a title + a credential opens doors that logic alone can't. Use: project authority through posture, precise language, and selective credentials. Counter: ask 'what's the actual evidence, independent of their title?'",
  triggers: ["authority", "expert", "credential", "title", "professional", "official", "confident"],
  actions: [
    "Project authority through posture, precise language, and visible credentials",
    "Cite specific experience/results, not vague 'expertise'",
    "When targeted: separate the person's title from the actual evidence",
  ],
  relatedKeys: ["dp_social_proof", "dp_anchoring_bias"],
  applicabilityPrompt:
    "Is the operator trying to establish credibility or being influenced by someone's authority?",
};

const RECIPROCITY_TRAP: GreeneEntry = {
  key: "dp_reciprocity_trap",
  book: "48LP",
  type: "principle",
  title: "Reciprocity Trap — Small Favors Create Large Debts",
  summary:
    "An unprompted favor creates a psychological debt. The recipient feels compelled to reciprocate, often disproportionately.",
  fullText:
    "The brain tracks social debts with high precision. A small, unprompted favor (free sample, helpful introduction, unexpected discount) creates a disproportionate obligation. Use: give first, give specifically, and give without asking. Counter: accept favors neutrally without signaling debt — 'thanks, I appreciate that' without 'I owe you one.'",
  triggers: ["favor", "reciprocity", "owe", "debt", "gift", "free", "bonus", "thanks"],
  actions: [
    "Give first — small, specific, unprompted favors create disproportionate obligation",
    "Don't ask for anything when giving; let the debt build silently",
    "When targeted: accept favors neutrally without signaling 'I owe you'",
  ],
  relatedKeys: ["dp_scarcity", "dp_illusion_of_choice", "law_40"],
  applicabilityPrompt:
    "Is the operator trying to build obligation, or feeling pressured to reciprocate?",
};

const EMOTIONAL_DETACHMENT: GreeneEntry = {
  key: "dp_emotional_detachment",
  book: "48LP",
  type: "principle",
  title: "Emotional Detachment — Never Let Them See You Bleed",
  summary:
    "Emotional control is the foundation of power. When your emotions are visible, opponents can manipulate them. When they're hidden, you become unpredictable.",
  fullText:
    "The P0WER Iota framework: identify your triggers, neutralize them before they fire, reprogram your default response, and project calm dominance through body language. Emotional reactions are leverage points for anyone watching. Use: practice the pause — when triggered, wait 3 seconds before responding. Counter: when someone is trying to provoke you, recognize the pattern and respond with cold precision instead of heat.",
  triggers: ["emotion", "angry", "triggered", "composure", "calm", "react", "patience", "control", "stress"],
  actions: [
    "Practice the pause — 3 seconds between trigger and response",
    "Identify your top 3 emotional triggers and pre-plan neutral responses",
    "Project calm through slow movements, low voice, and steady eye contact",
  ],
  relatedKeys: ["dp_body_language", "dp_anchoring_bias", "law_3"],
  applicabilityPrompt:
    "Is the operator dealing with a high-stakes interaction where emotional control matters?",
};

const BODY_LANGUAGE_DOMINANCE: GreeneEntry = {
  key: "dp_body_language",
  book: "48LP",
  type: "principle",
  title: "Body Language Dominance — Project Power Before You Speak",
  summary:
    "Posture, space-claiming, and movement speed signal status before a word is spoken. Slow, deliberate movements read as high-status.",
  fullText:
    "Take up space — spread your materials, claim the armrest, stand with feet apart. Move slowly — fast movements signal anxiety. Maintain steady eye contact — breaking first signals submission. Use the 'steeple' hand position for authority. Lower your voice at the end of sentences — uptalk signals uncertainty.",
  triggers: ["body language", "posture", "presence", "confidence", "dominant", "status", "intimidate"],
  actions: [
    "Move slowly and deliberately — speed signals anxiety",
    "Take up space — spread materials, claim the armrest, wide stance",
    "End sentences with a downward inflection — uptalk signals submission",
  ],
  relatedKeys: ["dp_emotional_detachment", "dp_authority_bias"],
  applicabilityPrompt:
    "Is the operator preparing for a high-stakes meeting, negotiation, or confrontation?",
};

// ── Negotiation Tactics (Voss / Never Split the Difference) ───────────

const MIRRORING: GreeneEntry = {
  key: "neg_mirroring",
  book: "48LP",
  type: "principle",
  title: "Mirroring — Repeat Their Last 1-3 Words",
  summary:
    "Repeating the last 1-3 words of what someone said as a question builds rapport and extracts more information without pressure.",
  fullText:
    "Mirroring is the fastest rapport-building tool. When you repeat their words back as a question, they feel heard and elaborate. 'The price is too high.' — 'Too high?' They'll explain why, giving you the leverage points. Use: repeat the last 1-3 words with an upward inflection. Then go silent. The silence is where the magic happens.",
  triggers: ["negotiate", "negotiation", "customer", "objection", "price", "resistance", "rapport"],
  actions: [
    "Repeat the last 1-3 words of their statement as a question",
    "Then go silent — let them fill the space",
    "Use on phone calls: mirror their exact words to build connection",
  ],
  relatedKeys: ["neg_labeling", "neg_calibrated_question", "neg_accusation_audit"],
  applicabilityPrompt:
    "Is the operator in a negotiation, sales call, or dealing with a resistant customer?",
};

const LABELING: GreeneEntry = {
  key: "neg_labeling",
  book: "48LP",
  type: "principle",
  title: "Labeling — Name Their Emotion to Defuse It",
  summary:
    "'It sounds like you're frustrated with...' naming the emotion validates it and reduces its intensity. People calm down when they feel understood.",
  fullText:
    "When you label an emotion, you force the brain to process it cognitively, which reduces its emotional charge. 'It seems like you're worried about the timeline.' This doesn't mean you agree — it means you see them. Use: start with 'It sounds like...' or 'It seems like...' to avoid claiming you know exactly what they feel. Wrong labels are fine — they'll correct you and give you more information.",
  triggers: ["emotion", "frustrated", "angry", "upset", "concerned", "worried", "customer", "difficult"],
  actions: [
    "Start with 'It sounds like...' or 'It seems like...' — never 'You are...'",
    "Label the emotion, not the problem — 'frustrated' not 'wrong'",
    "Then go silent — let them confirm, correct, or elaborate",
  ],
  relatedKeys: ["neg_mirroring", "neg_calibrated_question"],
  applicabilityPrompt:
    "Is the operator dealing with an emotional customer, team member, or stakeholder?",
};

const CALIBRATED_QUESTIONS: GreeneEntry = {
  key: "neg_calibrated_question",
  book: "48LP",
  type: "principle",
  title: "Calibrated Questions — 'How Am I Supposed to Do That?'",
  summary:
    "Open-ended questions starting with 'How' or 'What' force the other party to solve your problem. They can't answer with a simple no.",
  fullText:
    "'How am I supposed to do that?' is the most powerful negotiation phrase. It puts the burden on them to find a solution. 'What about this works for you?' makes them articulate their real constraints. Never ask 'why' — it triggers defensiveness. Use 'How' and 'What' exclusively. The goal is to make them think, not to make them agree.",
  triggers: ["negotiate", "negotiation", "resistance", "no", "refuse", "pushback", "stuck"],
  actions: [
    "Replace 'why' with 'how' or 'what' — 'why' triggers defensiveness",
    "Ask 'How am I supposed to do that?' to shift the burden",
    "Ask 'What about this works for you?' to surface real constraints",
  ],
  relatedKeys: ["neg_mirroring", "neg_labeling", "neg_no_oriented"],
  applicabilityPrompt:
    "Is the operator facing resistance, a hard no, or a stalled negotiation?",
};

const NO_ORIENTED: GreeneEntry = {
  key: "neg_no_oriented",
  book: "48LP",
  type: "principle",
  title: "No-Oriented Questions — Make Them Say No to Move Forward",
  summary:
    "People feel safe saying 'no.' Frame your ask so 'no' is the answer that moves things forward. 'Is it a bad idea to...?' is more effective than 'Would you...?'",
  fullText:
    "'No' feels like protection to the brain. 'Have you given up on this project?' gets a faster response than 'Are you still interested?' When you let people say no, they drop their guard and often say yes to the next ask. Use: 'Is it a bad idea to look at alternatives?' 'Would it be ridiculous to consider...?' Counter: when someone uses this on you, recognize the pattern and answer with your own calibrated question.",
  triggers: ["hesitant", "ghosting", "no response", "stalled", "follow up", "deadline"],
  actions: [
    "Frame asks so 'no' is the safe answer that moves things forward",
    "Use 'Have you given up on...?' for stalled deals",
    "After they say no, ask your real question — their guard is down",
  ],
  relatedKeys: ["neg_calibrated_question", "neg_mirroring"],
  applicabilityPrompt:
    "Is the operator dealing with a stalled deal, ghosting, or hesitant prospect?",
};

const ACCUSATION_AUDIT: GreeneEntry = {
  key: "neg_accusation_audit",
  book: "48LP",
  type: "principle",
  title: "Accusation Audit — Pre-empt Their Worst Thoughts",
  summary:
    "Before they can think it, say it. Naming the worst thing they could think about you defuses it before it forms.",
  fullText:
    "'You're probably going to think this is expensive.' 'You might think I'm being pushy.' By naming the negative thought first, you remove its power. The brain can't hold the accusation with the same intensity when you've already said it. Use: list every possible negative they could think, then address each one. This is especially powerful before a price reveal.",
  triggers: ["price", "expensive", "objection", "pitch", "sales", "pushy", "skeptic"],
  actions: [
    "Before the price reveal, name every negative thought they could have",
    "Start with the worst one — 'You're probably going to think this is expensive'",
    "Then deliver your message — the objection has lost its sting",
  ],
  relatedKeys: ["neg_mirroring", "neg_labeling", "dp_anchoring_bias"],
  applicabilityPrompt:
    "Is the operator about to deliver news that could trigger resistance or objections?",
};

// ── Competitive Intelligence (Chanakya Neeti) ─────────────────────────

const CHANAKYA_KNOW_ENEMY: GreeneEntry = {
  key: "ci_know_enemy",
  book: "48LP",
  type: "principle",
  title: "Know Your Enemy Completely Before Striking",
  summary:
    "Chanakya: before you attack a competitor, know their revenue, margins, customer base, weaknesses, and key relationships. Intelligence first, action second.",
  fullText:
    "Chanakya Neeti: 'Before starting a war, know the strength of the enemy, their allies, their resources, and their weaknesses.' In business: scrape competitor reviews, pricing, response times, website quality, and staff turnover. Every weakness is an opportunity. Every strength is a threat to counter. Map it all before you act.",
  triggers: ["competitor", "competition", "market", "rival", "strategy", "war", "attack", "dominate"],
  actions: [
    "Map every competitor's rating, review count, pricing, and response time",
    "Identify their top weakness (low reviews, no website, slow response)",
    "Build your exploit strategy around their specific weakness, not your generic strength",
  ],
  relatedKeys: ["ci_economic_warfare", "ci_alliance", "dp_social_proof"],
  applicabilityPrompt:
    "Is the operator analyzing competitors or planning a market dominance strategy?",
};

const CHANAKYA_ECONOMIC_WARFARE: GreeneEntry = {
  key: "ci_economic_warfare",
  book: "48LP",
  type: "principle",
  title: "Economic Warfare — Attack Their Revenue, Not Their Reputation",
  summary:
    "Chanakya: the fastest way to defeat a competitor is to cut their revenue stream, not to argue about quality. Win on price + speed + access.",
  fullText:
    "Chanakya taught that economic warfare is faster and more decisive than reputation warfare. If a competitor's advantage is premium positioning, undercut on price + convenience. If their advantage is volume, differentiate on specialization. Target the revenue source, not the brand. Use: identify what makes them money and offer a faster/cheaper/better version to the same customers.",
  triggers: ["competitor", "pricing", "undercut", "market share", "revenue", "dominate", "business"],
  actions: [
    "Identify the competitor's primary revenue source",
    "Offer a faster/cheaper/better version to their exact customer base",
    "Don't fight on brand — fight on access, speed, and price",
  ],
  relatedKeys: ["ci_know_enemy", "ci_alliance", "dp_anchoring_bias"],
  applicabilityPrompt:
    "Is the operator planning to take market share from a specific competitor?",
};

const CHANAKYA_ALLIANCE: GreeneEntry = {
  key: "ci_alliance",
  book: "48LP",
  type: "principle",
  title: "Strategic Alliances — Turn Enemies of Your Enemy into Friends",
  summary:
    "Chanakya: the enemy of your enemy is your temporary ally. Build coalitions that weaken your competitor without costing you leverage.",
  fullText:
    "Chanakya Neeti: 'Your enemy's enemy is your friend — but only while the common enemy exists.' In business: partner with complementary services, suppliers, or even former competitors to box out a dominant player. Use: identify who else loses when your competitor wins, and align with them. Counter: remember the alliance is temporary — don't over-share strategy.",
  triggers: ["partnership", "alliance", "collaborate", "coalition", "competitor", "network", "strategic"],
  actions: [
    "Identify who else loses when your competitor wins",
    "Build a temporary alliance with them — shared marketing, referrals, bundling",
    "Don't over-share your own strategy — the alliance is conditional",
  ],
  relatedKeys: ["ci_know_enemy", "ci_economic_warfare"],
  applicabilityPrompt:
    "Is the operator considering partnerships or alliances against a common competitor?",
};

// ── Tactical Playbook ─────────────────────────────────────────────────

const TROJAN_NETWORKING: GreeneEntry = {
  key: "tp_trojan_networking",
  book: "48LP",
  type: "principle",
  title: "Trojan Networking — Enter Through Service, Not Through Asking",
  summary:
    "Get inside a powerful person's circle by offering value first — free work, introductions, research — then leverage the access.",
  fullText:
    "The Trojan Horse of networking: you don't ask for access, you earn it by being useful. Offer to do the boring work nobody wants. Make the introduction they need. Send the research they don't have time to do. Once inside, you have the relationship. Once you have the relationship, you have the leverage. Use: identify what they need but won't do themselves, and do it for free.",
  triggers: ["networking", "connection", "introduction", "access", "mentor", "influential", "powerful"],
  actions: [
    "Identify what the target person needs but won't do themselves",
    "Do it for free and deliver it — no strings attached",
    "Once inside their circle, leverage the access for your goals",
  ],
  relatedKeys: ["dp_reciprocity_trap", "ci_alliance", "law_13"],
  applicabilityPrompt:
    "Is the operator trying to build a relationship with a powerful or influential person?",
};

const STRATEGIC_SILENCE: GreeneEntry = {
  key: "tp_strategic_silence",
  book: "48LP",
  type: "principle",
  title: "Strategic Silence — Let Silence Do the Heavy Lifting",
  summary:
    "After making a point or an offer, go completely silent. Most people fill silence by conceding, explaining, or revealing their real position.",
  fullText:
    "Silence is a power move. After you state your price, your position, or your boundary — stop talking. The urge to fill the silence is almost irresistible, and what fills it is usually a concession or a reveal. Use: count to 7 in your head after every important statement. Counter: when someone uses silence on you, match it — the first to speak loses.",
  triggers: ["silence", "pause", "wait", "negotiate", "negotiation", "offer", "price", "concede"],
  actions: [
    "After stating your price or position, go completely silent — count to 7",
    "Let them fill the silence — they usually concede or reveal their real position",
    "When someone uses silence on you, match it — the first to speak loses",
  ],
  relatedKeys: ["neg_mirroring", "neg_calibrated_question", "dp_emotional_detachment"],
  applicabilityPrompt:
    "Is the operator in a negotiation or high-stakes conversation where silence could create leverage?",
};

const FUTURE_PACING: GreeneEntry = {
  key: "tp_future_pacing",
  book: "48LP",
  type: "principle",
  title: "Future Pacing — Paint the Picture of What Happens Next",
  summary:
    "Describe the future state where they've already said yes. The brain simulates it and wants to make it real.",
  fullText:
    "'So once we get this set up, you'll have tires on your car by Friday and you won't have to think about it again.' Future pacing makes the decision feel already made. The brain fills in the steps between now and the future state, reducing friction. Use: describe the end state, not the process. Counter: when someone future-paces you, ask 'what needs to happen for that to work?' to re-introduce friction.",
  triggers: ["close", "commit", "future", "next steps", "imagine", "picture", "once we"],
  actions: [
    "Describe the end state where they've already said yes — not the process",
    "Use sensory language — 'you'll have', 'you won't need to', 'it'll be done'",
    "When targeted: ask 'what needs to happen for that to work?' to re-introduce friction",
  ],
  relatedKeys: ["dp_illusion_of_choice", "neg_no_oriented", "tp_strategic_silence"],
  applicabilityPrompt:
    "Is the operator trying to close a deal, get a commitment, or move someone to action?",
};

// ── Aggregates ────────────────────────────────────────────────────────

export const DARK_PSYCHOLOGY_ENTRIES: GreeneEntry[] = [
  ANCHORING_BIAS,
  SCARCITY_PRINCIPLE,
  ILLUSION_OF_CHOICE,
  SOCIAL_PROOF,
  AUTHORITY_BIAS,
  RECIPROCITY_TRAP,
  EMOTIONAL_DETACHMENT,
  BODY_LANGUAGE_DOMINANCE,
];

export const NEGOTIATION_TACTIC_ENTRIES: GreeneEntry[] = [
  MIRRORING,
  LABELING,
  CALIBRATED_QUESTIONS,
  NO_ORIENTED,
  ACCUSATION_AUDIT,
];

export const COMPETITIVE_INTEL_ENTRIES: GreeneEntry[] = [
  CHANAKYA_KNOW_ENEMY,
  CHANAKYA_ECONOMIC_WARFARE,
  CHANAKYA_ALLIANCE,
];

export const TACTICAL_PLAYBOOK_ENTRIES: GreeneEntry[] = [
  TROJAN_NETWORKING,
  STRATEGIC_SILENCE,
  FUTURE_PACING,
];

/** All dark-knowledge entries across all categories. */
export const ALL_DARK_KNOWLEDGE_ENTRIES: GreeneEntry[] = [
  ...DARK_PSYCHOLOGY_ENTRIES,
  ...NEGOTIATION_TACTIC_ENTRIES,
  ...COMPETITIVE_INTEL_ENTRIES,
  ...TACTICAL_PLAYBOOK_ENTRIES,
];

/** Per-category counts for the seed script diagnostic. */
export const DARK_KNOWLEDGE_CORPUS_COUNTS = {
  total: ALL_DARK_KNOWLEDGE_ENTRIES.length,
  byCategory: {
    dark_psychology: DARK_PSYCHOLOGY_ENTRIES.length,
    negotiation_tactic: NEGOTIATION_TACTIC_ENTRIES.length,
    competitive_intel: COMPETITIVE_INTEL_ENTRIES.length,
    tactical_playbook: TACTICAL_PLAYBOOK_ENTRIES.length,
  } as const,
};

/** Source book labels for the seed script content prefix. */
export const DARK_KNOWLEDGE_SOURCE_LABELS: Record<string, string> = {
  dark_psychology: "P0WER Handbook",
  negotiation_tactic: "Never Split the Difference",
  competitive_intel: "Chanakya Neeti",
  tactical_playbook: "Tactical Playbook",
};
