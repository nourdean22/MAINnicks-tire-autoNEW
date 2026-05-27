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
  key: string; // brain memory key · "law_10", "seducer_siren", etc.
  category: "law" | "seducer" | "dark_trait" | "mentorship" | "strategy";
  number?: number; // 1-48 for laws
  title: string;
  summary: string; // 1-sentence
  fullText: string; // 3-5 sentence Greene-flavored explanation
  sourceBook: string;
  applicabilityPrompt: string; // AI prompt fragment
}

// ─── 48 Laws of Power ────────────────────────────────────────────
export const LAWS_OF_POWER: GreeneEntry[] = [
  {
    key: "law_1",
    category: "law",
    number: 1,
    title: "Never outshine the master",
    summary: "Make those above you feel comfortably superior.",
    fullText:
      "Always make those above you feel comfortably superior. In your desire to please and impress them, do not go too far in displaying your talents or you might accomplish the opposite — inspire fear and insecurity. Make your masters appear more brilliant than they are and you will attain the heights of power.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Does this person hold positional or earned power over the operator (boss, senior peer, established expert in operator's domain)? If yes, Law 1 applies to outward-facing interactions.",
  },
  {
    key: "law_3",
    category: "law",
    number: 3,
    title: "Conceal your intentions",
    summary:
      "Keep people off-balance and in the dark by never revealing the purpose behind your actions.",
    fullText:
      "If they have no clue what you are up to, they cannot prepare a defense. Guide them far enough down the wrong path, envelop them in enough smoke, and by the time they realize your intentions, it will be too late.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Is the operator preparing a strategic move (negotiation, ask, pivot) involving this person? Law 3 applies — restrain over-sharing of intent.",
  },
  {
    key: "law_5",
    category: "law",
    number: 5,
    title: "Guard your reputation with your life",
    summary: "Reputation is the cornerstone of power.",
    fullText:
      "Through reputation alone you can intimidate and win; once it slips, however, you are vulnerable and will be attacked on all sides. Make your reputation unassailable. Always be alert to potential attacks and thwart them before they happen.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Does this person have ability or pattern of damaging the operator's reputation in shared social/professional circles? If yes, Law 5 applies — invest defensively.",
  },
  {
    key: "law_10",
    category: "law",
    number: 10,
    title: "Infection: Avoid the unhappy and unlucky",
    summary: "Misery and misfortune are infectious.",
    fullText:
      "You can die from someone else's misery — emotional states are as infectious as diseases. You may feel you are helping the drowning man but you are only precipitating your own disaster. The unfortunate sometimes draw misfortune on themselves; they will also draw it on you. Associate with the happy and fortunate instead.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Has this person's ledger trended net-negative for 90+ days AND does their cross-reference with operator's mastery score show drag (>0.5 drop on days they were chat-mentioned)? If yes, Law 10 is the central law for this profile.",
  },
  {
    key: "law_13",
    category: "law",
    number: 13,
    title: "Appeal to self-interest, never to mercy or gratitude",
    summary: "If you need to ask, find what they want.",
    fullText:
      "When asking for help, do not bother to remind others of your past assistance and good deeds. They will find a way to ignore you. Instead, uncover something in your request, or in your alliance with them, that will benefit them, and emphasize it out of all proportion. They will respond enthusiastically when they see something to be gained for themselves.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Is the operator about to ask this person for help? Law 13 applies — frame the ask around their self-interest, not your need.",
  },
  {
    key: "law_14",
    category: "law",
    number: 14,
    title: "Pose as a friend, work as a spy",
    summary: "Knowing about your rivals is critical.",
    fullText:
      "Use spies to gather valuable information that will keep you a step ahead. Better still, play the spy yourself. In polite social encounters, learn to probe. Ask indirect questions to get people to reveal their weaknesses and intentions.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Is this person a `rival` or `competitor` role with high power-balance positive (operator weaker)? Law 14 applies — gather intelligence patiently.",
  },
  {
    key: "law_16",
    category: "law",
    number: 16,
    title: "Use absence to increase respect and honor",
    summary: "Too much circulation makes the price go down.",
    fullText:
      "The more you are seen and heard from, the more common you appear. If you are already established in a group, temporary withdrawal from it will make you more talked about, even more admired. You must learn when to leave. Create value through scarcity.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Has the operator initiated 80%+ of recent interactions AND interactionCount > 20? If yes, Law 16 applies — strategic absence is the next move.",
  },
  {
    key: "law_20",
    category: "law",
    number: 20,
    title: "Do not commit to anyone",
    summary: "Keep yourself free, fluid, available.",
    fullText:
      "It is the fool who always rushes to take sides. Do not commit to any side or cause but yourself. By maintaining your independence, you become the master of others — playing people against one another, making them pursue you.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Is the operator being pressured into a faction or alliance by this person? Law 20 applies — preserve optionality.",
  },
  {
    key: "law_27",
    category: "law",
    number: 27,
    title: "Play on people's need to believe",
    summary: "People have an overwhelming desire to believe in something.",
    fullText:
      "Become the focal point of such desire by offering them a cause, a new faith to follow. Promise the moon but be vague; surround yourself with the trappings of mystery and certainty. Be careful with this one — Greene warns that using it dishonestly creates real backlash.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Does this person actively follow the operator or look to operator for direction? Law 27 applies — meet the need for belief with intentional framing.",
  },
  {
    key: "law_38",
    category: "law",
    number: 38,
    title: "Think as you like but behave like others",
    summary:
      "Read the room. Conform outwardly when the cost of nonconformity exceeds the value.",
    fullText:
      "If you make a show of going against the times, flaunting unconventional ideas and unorthodox ways, people will think you only want attention and look down on you. They will find a way to punish you. It is far safer to blend in and nurture the common touch. Share your originality only with tolerant friends.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Is this a `business` or `network_only` relationship where operator's idiosyncratic views could cost rapport? Law 38 applies — calibrate display.",
  },
  {
    key: "law_43",
    category: "law",
    number: 43,
    title: "Work on the hearts and minds of others",
    summary: "Coercion creates a reaction that will eventually work against you.",
    fullText:
      "You must seduce others into wanting to move in your direction. A person whom you have seduced becomes your loyal pawn. Work on emotions and individual psychology to bring people into your orbit.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Is this a `mentor`, `mentee`, `friend`, or `close_friend` role where coercion would damage long-term value? Law 43 always applies — focus on persuasion-through-emotion.",
  },
  {
    key: "law_47",
    category: "law",
    number: 47,
    title: "In victory, learn when to stop",
    summary: "Don't go past the mark you aimed for.",
    fullText:
      "The moment of victory is often the moment of greatest peril. In the heat of victory, arrogance and overconfidence can push you past the goal you had aimed for, and by going too far, you make more enemies than you defeat. Do not allow success to go to your head.",
    sourceBook: "48 Laws of Power",
    applicabilityPrompt:
      "Has the operator recently 'won' an interaction with this person (favor granted, argument resolved in operator's favor)? Law 47 applies — restrain the urge to press further.",
  },
];

// ─── 9 Seducer types (Art of Seduction) ──────────────────────────
export const SEDUCER_TYPES: GreeneEntry[] = [
  {
    key: "seducer_siren",
    category: "seducer",
    title: "Siren",
    summary: "Magnetic sexual presence + theater of imperfection.",
    fullText:
      "The Siren projects a sexual presence that promises pleasure and adventure. Her power lies in being slightly inaccessible and dramatic. The Siren operates by creating a public spectacle around herself.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person command attention through dramatic presence + sexual magnetism? Tag as Siren.",
  },
  {
    key: "seducer_rake",
    category: "seducer",
    title: "Rake",
    summary: "Promises uncompromising desire + extravagant attention.",
    fullText:
      "The Rake worships at the altar of romance. Like a Don Juan, he focuses all his attention and desire on the target, making her feel uniquely chosen.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person specialize in dedicated romantic pursuit + verbal worship? Tag as Rake.",
  },
  {
    key: "seducer_ideal_lover",
    category: "seducer",
    title: "Ideal Lover",
    summary: "Becomes whatever you most need.",
    fullText:
      "The Ideal Lover senses what the target is missing and becomes that. They are chameleons of unmet need.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person mirror back the operator's unstated needs? Tag as Ideal Lover.",
  },
  {
    key: "seducer_dandy",
    category: "seducer",
    title: "Dandy",
    summary: "Androgynous, fluid, refuses to commit to a single type.",
    fullText:
      "The Dandy refuses to be pinned down. They display traits across gender + role, signaling unattainable freedom.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person resist being categorized? Tag as Dandy.",
  },
  {
    key: "seducer_natural",
    category: "seducer",
    title: "Natural",
    summary: "Disarming, unstudied, childlike.",
    fullText:
      "The Natural seems incapable of artifice. Their power comes from triggering protective instinct in others.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person disarm with apparent un-self-conscious naturalness? Tag as Natural.",
  },
  {
    key: "seducer_coquette",
    category: "seducer",
    title: "Coquette",
    summary: "Hot/cold, advance/retreat tempo.",
    fullText:
      "The Coquette controls through alternating heat and cold — granting attention then withdrawing it.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person operate on intermittent reinforcement / hot-cold cycles? Tag as Coquette.",
  },
  {
    key: "seducer_charmer",
    category: "seducer",
    title: "Charmer",
    summary: "Soothes, flatters, makes you feel uniquely seen.",
    fullText:
      "The Charmer focuses entirely on you — your concerns, your ambitions, your worries. They draw out and reflect back.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person make the operator feel uniquely listened-to + understood? Tag as Charmer.",
  },
  {
    key: "seducer_charismatic",
    category: "seducer",
    title: "Charismatic",
    summary:
      "Conveys an inner conviction or mission others want to follow.",
    fullText:
      "The Charismatic radiates conviction about a higher purpose. People follow them because they make the followers' lives feel meaningful.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person operate from visible mission + conviction? Tag as Charismatic.",
  },
  {
    key: "seducer_star",
    category: "seducer",
    title: "Star",
    summary: "Ethereal, slightly removed, projects a screen for projection.",
    fullText:
      "The Star is luminous but slightly distant — close enough to be magnetic, far enough to remain an object of projection. Like a film star, they let others fill in the gaps.",
    sourceBook: "The Art of Seduction",
    applicabilityPrompt:
      "Does this person maintain glamour + slight distance? Tag as Star.",
  },
];

// ─── 12 Dark Traits (Laws of Human Nature) ───────────────────────
export const DARK_TRAITS: GreeneEntry[] = [
  {
    key: "dark_narcissist",
    category: "dark_trait",
    title: "Narcissist (Deep)",
    summary: "Cannot tolerate criticism + drains others' attention.",
    fullText:
      "Deep narcissists need constant attention + cannot tolerate criticism. They drain energy from any interaction.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Has this person responded defensively + aggressively to mild critique 3+ times? Tag dark_narcissist.",
  },
  {
    key: "dark_envious",
    category: "dark_trait",
    title: "Envious",
    summary: "Resents the operator's successes; subtly undermines.",
    fullText:
      "The envious type cannot bear to see others rise. They will quietly undermine while professing support.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Has this person responded coldly or critically to operator's recent wins? Tag dark_envious.",
  },
  {
    key: "dark_grandiose",
    category: "dark_trait",
    title: "Grandiose",
    summary: "Self-image vastly exceeds actual contribution.",
    fullText:
      "Grandiose types live in a self-image far above reality. Their stories grow with each retelling.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Do this person's stated achievements drift inconsistent or inflated over time? Tag dark_grandiose.",
  },
  {
    key: "dark_defensive",
    category: "dark_trait",
    title: "Defensive",
    summary: "Cannot accept feedback; every input becomes attack.",
    fullText:
      "Defensive types treat all input as attack. They cannot accept feedback or differing perspectives.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Has this person interpreted neutral input as personal attack 3+ times? Tag dark_defensive.",
  },
  {
    key: "dark_manipulator",
    category: "dark_trait",
    title: "Manipulator",
    summary: "Uses guilt, obligation, false intimacy as levers.",
    fullText:
      "Manipulators read what you need and use it as a control lever. Guilt and obligation are their favorite tools.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Has this person used guilt or obligation 2+ times to extract effort? Tag dark_manipulator.",
  },
  {
    key: "dark_passive_aggressive",
    category: "dark_trait",
    title: "Passive-aggressive",
    summary:
      "Hostility expressed indirectly through 'forgetting', delay, hint.",
    fullText:
      "Hostility never expressed openly. Always through forgetting, lateness, subtle digs, plausibly-deniable jabs.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Does this person express dissatisfaction through delay + forgetting rather than direct conversation? Tag dark_passive_aggressive.",
  },
  {
    key: "dark_drainer",
    category: "dark_trait",
    title: "Drainer",
    summary:
      "Every interaction leaves operator with less energy than before.",
    fullText:
      "Drainers monopolize emotional space without reciprocation. Time with them feels heavier than it should.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Has cross-ref of operator's daily score on days this person was chat-mentioned shown 0.5+ drop avg? Tag dark_drainer.",
  },
  {
    key: "dark_saint",
    category: "dark_trait",
    title: "False Saint",
    summary: "Performs virtue + uses moral high ground as weapon.",
    fullText:
      "The false saint performs virtue. They use moral high ground to control others + win arguments.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Does this person frame disagreements as moral failings rather than differences? Tag dark_saint.",
  },
  {
    key: "dark_status_obsessed",
    category: "dark_trait",
    title: "Status-obsessed",
    summary: "All decisions filtered through status optics.",
    fullText:
      "Every choice they make is filtered through 'how does this look'. Authenticity is suppressed.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Do this person's stated preferences shift to match the highest-status person in the room? Tag dark_status_obsessed.",
  },
  {
    key: "dark_fault_finder",
    category: "dark_trait",
    title: "Fault-finder",
    summary: "Sees flaws first; rarely volunteers praise.",
    fullText:
      "The fault-finder leads with criticism. Their first instinct on hearing news is to spot the problem.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Are this person's first responses to operator's news critical 60%+ of the time? Tag dark_fault_finder.",
  },
  {
    key: "dark_drama",
    category: "dark_trait",
    title: "Drama-seeking",
    summary: "Generates and feeds crisis to maintain centrality.",
    fullText:
      "Drama-seekers manufacture crisis when the world is calm. The crisis keeps them at center stage.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Does this person initiate crises out of calm periods 3+ times? Tag dark_drama.",
  },
  {
    key: "dark_chronic_victim",
    category: "dark_trait",
    title: "Chronic Victim",
    summary: "Every story positions them as wronged; never the actor.",
    fullText:
      "The chronic victim narrates a life of being wronged. They are never the actor, always the recipient of others' wrongs.",
    sourceBook: "Laws of Human Nature",
    applicabilityPrompt:
      "Are this person's stories about themselves 80%+ where they are wronged or harmed by external forces? Tag dark_chronic_victim.",
  },
];

// ─── 5 Mentorship roles (Mastery) ────────────────────────────────
export const MENTORSHIP_ROLES: GreeneEntry[] = [
  {
    key: "mentor_true",
    category: "mentorship",
    title: "True Mentor",
    summary:
      "Time-spent ratio is high AND advice produces actionable, validated lift.",
    fullText:
      "A true mentor compresses years of expertise into hours of guidance. The student's trajectory observably accelerates.",
    sourceBook: "Mastery",
    applicabilityPrompt:
      "Has time spent with this person produced 3+ validated leveraged moves in the last 90 days? Tag mentor_true.",
  },
  {
    key: "mentor_peer",
    category: "mentorship",
    title: "Peer Mentor",
    summary: "Lateral exchange of expertise + accountability.",
    fullText:
      "Peer mentors are at similar levels but specialize in non-overlapping domains. The exchange is two-way.",
    sourceBook: "Mastery",
    applicabilityPrompt:
      "Is this person at operator's career level with complementary expertise, and is the exchange two-way? Tag mentor_peer.",
  },
  {
    key: "mentor_anti",
    category: "mentorship",
    title: "Anti-mentor",
    summary: "Looks like a mentor but extracts more than gives.",
    fullText:
      "Anti-mentors hold status as wise advisors but consume time without delivering proportionate value. Their advice tends to be generic or self-serving.",
    sourceBook: "Mastery",
    applicabilityPrompt:
      "Has time spent with this person exceeded 5 hours/month with <1 actionable leveraged move? Tag mentor_anti.",
  },
  {
    key: "mentor_apprentice",
    category: "mentorship",
    title: "Apprentice",
    summary: "Operator is the source of expertise; investment compounds.",
    fullText:
      "Apprentices receive from the operator. Their development is a long-arc investment that pays back through alliance + reputation.",
    sourceBook: "Mastery",
    applicabilityPrompt:
      "Does this person reliably implement operator's advice + return with progress? Tag mentor_apprentice.",
  },
  {
    key: "mentor_none",
    category: "mentorship",
    title: "None",
    summary: "No mentorship dynamic.",
    fullText:
      "Pure peer / non-domain relationship without mentor or apprentice angle.",
    sourceBook: "Mastery",
    applicabilityPrompt: "Default tag when no other mentorship pattern applies.",
  },
];

// ─── 8 Strategies (33 Strategies of War) ─────────────────────────
export const WAR_STRATEGIES: GreeneEntry[] = [
  {
    key: "strategy_engage",
    category: "strategy",
    title: "Engage",
    summary: "Active investment + frequent contact.",
    fullText:
      "Engage strategy reserves serious investment in this relationship. Cadence is short.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "High-trust + high-value relationship · short cadence is appropriate.",
  },
  {
    key: "strategy_defend",
    category: "strategy",
    title: "Defend",
    summary: "Maintain contact but preserve resources.",
    fullText:
      "Defensive strategy maintains the relationship at minimum-viable cadence without further investment.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "Operator must preserve resources for higher-leverage relationships · maintain only.",
  },
  {
    key: "strategy_withdraw",
    category: "strategy",
    title: "Withdraw",
    summary: "Reduce contact deliberately; use absence as signal.",
    fullText:
      "Withdraw strategy uses absence as a power signal · Law 16 applies. Cadence extends deliberately.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "Operator over-invested + needs to reset power balance · extend cadence.",
  },
  {
    key: "strategy_counter",
    category: "strategy",
    title: "Counter-attack",
    summary: "Active push-back after a violation.",
    fullText:
      "Counter-attack strategy responds to a specific offense with proportional + visible response.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "This person has recently violated trust or boundary · response is calibrated counter.",
  },
  {
    key: "strategy_wait",
    category: "strategy",
    title: "Wait",
    summary: "Take no action; observe.",
    fullText:
      "Wait strategy takes no action and observes. Time reveals the situation.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "Situation is unclear · gather information before acting.",
  },
  {
    key: "strategy_alliance",
    category: "strategy",
    title: "Alliance",
    summary: "Formal pact + mutual support.",
    fullText:
      "Alliance strategy creates an explicit mutual-aid arrangement. Both parties know they can call on each other.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "This person is positioned for explicit mutual-aid relationship · formalize.",
  },
  {
    key: "strategy_recon",
    category: "strategy",
    title: "Reconnaissance",
    summary: "Gather intelligence before deciding strategy.",
    fullText:
      "Reconnaissance strategy probes for information without committing. Asks indirect questions, observes patterns.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "Relationship is new + intel-gathering is warranted before strategy lock-in.",
  },
  {
    key: "strategy_severance",
    category: "strategy",
    title: "Severance",
    summary: "End the relationship; clean break.",
    fullText:
      "Severance strategy ends the relationship deliberately. No lingering · clean break.",
    sourceBook: "33 Strategies of War",
    applicabilityPrompt:
      "Relationship has reached terminal state · execute formal severance.",
  },
];

export const ALL_GREENE_ENTRIES: GreeneEntry[] = [
  ...LAWS_OF_POWER,
  ...SEDUCER_TYPES,
  ...DARK_TRAITS,
  ...MENTORSHIP_ROLES,
  ...WAR_STRATEGIES,
];
