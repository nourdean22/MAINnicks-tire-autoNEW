/**
 * 2026-05-28 · Power Atlas · The 48 Laws of Power · full set.
 *
 * Authored against the unified GreeneEntry schema · all 48 laws have
 * triggers (operator-schema observables) + actions (imperative moves)
 * + relatedKeys (cross-book references).
 *
 * Source: Robert Greene, "The 48 Laws of Power" (1998).
 */

import type { GreeneEntry } from "./schema";

export const LAWS_OF_POWER: GreeneEntry[] = [
  {
    key: "law_1",
    book: "48LP",
    type: "law",
    number: 1,
    title: "Never outshine the master",
    summary: "Make those above you feel comfortably superior.",
    fullText:
      "Always make those above you feel comfortably superior. In your desire to please and impress, do not go too far displaying your talents or you might accomplish the opposite — inspire fear and insecurity. Make your masters appear more brilliant than they are and you will attain the heights of power.",
    triggers: [
      "person.role is boss/senior_peer/established_expert in operator's domain",
      "person.power_balance > +0.4 (operator weaker)",
      "operator preparing public demonstration of skill in their presence",
    ],
    actions: [
      "Soften your visible expertise in their presence",
      "Credit them publicly for moves they enabled",
      "Save the showpiece work for arenas they don't directly compete in",
      "Ask their opinion before stating yours, even when you already know the answer",
    ],
    relatedKeys: ["law_38", "law_46", "strategy_recon"],
    applicabilityPrompt:
      "Does this person hold positional or earned power over the operator? If yes, Law 1 applies to outward-facing interactions.",
  },
  {
    key: "law_2",
    book: "48LP",
    type: "law",
    number: 2,
    title: "Never put too much trust in friends, learn how to use enemies",
    summary: "Friends envy more than they admit; ex-enemies are loyal in proving themselves.",
    fullText:
      "Be wary of friends — they will betray you more quickly, for they are easily aroused to envy. They also become spoiled and tyrannical. Hire a former enemy instead and they will be more loyal than a friend, because they have more to prove. In fact you have more to fear from friends than from enemies. If you have no enemies, find a way to make them.",
    triggers: [
      "operator hiring or delegating to a close friend",
      "person.relationship === 'friend' AND person.envy_signal > 0",
      "former-rival recently extending an olive branch",
    ],
    actions: [
      "Structure friend-as-collaborator with explicit terms + exit clauses",
      "Test critical work with someone neutral before a friend",
      "Convert a former enemy with a genuine first favor",
      "Keep the line between friendship and operating relationship visible",
    ],
    relatedKeys: ["law_10", "law_18", "dark_envious"],
    applicabilityPrompt:
      "Is the operator about to hire, partner with, or rely heavily on a close friend? If yes, Law 2 applies — examine the envy signal first.",
  },
  {
    key: "law_3",
    book: "48LP",
    type: "law",
    number: 3,
    title: "Conceal your intentions",
    summary: "Keep people off-balance by never revealing the purpose behind your actions.",
    fullText:
      "If they have no clue what you are up to, they cannot prepare a defense. Guide them far enough down the wrong path, envelop them in enough smoke, and by the time they realize your intentions it will be too late.",
    triggers: [
      "operator preparing a strategic move (negotiation, pivot, ask)",
      "person has track record of leaking operator's plans",
      "competitive context where surprise creates leverage",
    ],
    actions: [
      "Share the goal only with people whose alignment is locked",
      "Brief partial truths that are technically accurate but incomplete",
      "Telegraph a decoy plan if asked directly",
      "Move on the real plan only when defenses can no longer respond",
    ],
    relatedKeys: ["law_4", "law_14", "strategy_recon"],
    applicabilityPrompt:
      "Is the operator preparing a strategic move involving this person? If yes, Law 3 applies — restrain over-sharing of intent.",
  },
  {
    key: "law_4",
    book: "48LP",
    type: "law",
    number: 4,
    title: "Always say less than necessary",
    summary: "Powerful people impress and intimidate by saying less.",
    fullText:
      "When you are trying to impress people with words, the more you say the more common you appear and the less in control. Even if you are saying something banal, it will seem original if you make it vague, open-ended, and sphinx-like. Powerful people impress and intimidate by saying less. The more you say, the more likely you are to say something foolish.",
    triggers: [
      "operator drafting a long message to a high-stakes person",
      "high-status meeting where the urge is to over-explain",
      "negotiation context with information asymmetry favoring brevity",
    ],
    actions: [
      "Cut every message in half before sending",
      "Sit through 3 seconds of silence before answering a question",
      "Use one strong sentence where you'd default to three",
      "Reply with a question more often than a statement",
    ],
    relatedKeys: ["law_3", "law_1", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator about to send a long-form message or over-explain in a high-stakes conversation? If yes, Law 4 applies.",
  },
  {
    key: "law_5",
    book: "48LP",
    type: "law",
    number: 5,
    title: "Guard your reputation with your life",
    summary: "Reputation is the cornerstone of power.",
    fullText:
      "Through reputation alone you can intimidate and win; once it slips, however, you are vulnerable and will be attacked on all sides. Make your reputation unassailable. Always be alert to potential attacks and thwart them before they happen.",
    triggers: [
      "person has ability or pattern of damaging operator's standing in shared circles",
      "rumors or gossip about the operator surfacing through this person's network",
      "public-facing project where reputation is the input asset",
    ],
    actions: [
      "Address a single attack head-on with calm, sourced facts",
      "Cultivate 2-3 third-party allies who will speak for you unprompted",
      "Don't engage with low-status detractors — silence beats defense",
      "Publish small visible wins on a steady cadence",
    ],
    relatedKeys: ["law_19", "law_38", "strategy_defend"],
    applicabilityPrompt:
      "Does this person have ability or pattern of damaging the operator's reputation in shared social/professional circles? If yes, Law 5 applies.",
  },
  {
    key: "law_6",
    book: "48LP",
    type: "law",
    number: 6,
    title: "Court attention at all cost",
    summary: "Stand out. Be different, mysterious, larger than life.",
    fullText:
      "Everything is judged by appearance. What is unseen counts for nothing. Never let yourself get lost in the crowd, then, or buried in oblivion. Stand out. Be conspicuous, at all cost. Make yourself a magnet of attention by appearing larger, more colorful, more mysterious than the bland masses.",
    triggers: [
      "operator in a crowded market or peer group with low individual visibility",
      "new audience being addressed (launch, demo, intro round)",
      "platform algorithm favoring distinct identity over generic posts",
    ],
    actions: [
      "Anchor a single visual or verbal signature that's unmistakably yours",
      "Take one contrarian-but-defensible stance per quarter",
      "Time scarce appearances for maximum compounded curiosity",
      "Trade some neutrality for memorability",
    ],
    relatedKeys: ["law_25", "law_37", "seducer_star"],
    applicabilityPrompt:
      "Is the operator competing for attention in a crowded peer group or launching to a new audience? If yes, Law 6 applies.",
  },
  {
    key: "law_7",
    book: "48LP",
    type: "law",
    number: 7,
    title: "Get others to do the work, take the credit",
    summary: "Use the skill, time, and energy of others to further your own cause.",
    fullText:
      "Use the wisdom, knowledge, and legwork of other people to further your own cause. Not only will such assistance save you valuable time and energy, it will give you a godlike aura of efficiency and speed. In the end, your helpers will be forgotten and you will be remembered. Never do yourself what others can do for you.",
    triggers: [
      "operator about to redo work an AI agent or contractor could do",
      "delegation opportunity with someone who'd benefit from the credit",
      "process bottleneck on a non-leveraged task",
    ],
    actions: [
      "Identify the top 3 tasks only you can do; delegate the rest",
      "Frame credit-sharing as a perk for the contributor",
      "Build leverage layers (agents · interns · vendors) before solo grind",
      "Be the synthesizer, not the executor",
    ],
    relatedKeys: ["law_11", "mentor_apprentice", "strategy_alliance"],
    applicabilityPrompt:
      "Is the operator stuck doing low-leverage work that others could perform? If yes, Law 7 applies.",
  },
  {
    key: "law_8",
    book: "48LP",
    type: "law",
    number: 8,
    title: "Make other people come to you — use bait if necessary",
    summary: "Pull your opponent to you and force them off their plan.",
    fullText:
      "When you force the other person to act, you are the one in control. It is always better to make your opponent come to you, abandoning their own plans in the process. Lure them with fabulous gains — then attack. You hold the cards.",
    triggers: [
      "person pressuring operator to come to their turf or timeline",
      "negotiation where the initiator is at a disadvantage",
      "operator chasing instead of attracting interest",
    ],
    actions: [
      "Set the time and place of every important meeting",
      "Make your offering distinctive enough that they pursue it",
      "Use scarcity signals (limited slots, narrow windows) deliberately",
      "Refuse to chase — let interest mature into action",
    ],
    relatedKeys: ["law_16", "strategy_wait", "seducer_coquette"],
    applicabilityPrompt:
      "Is the operator chasing this person or being summoned on their terms? If yes, Law 8 applies — flip the polarity.",
  },
  {
    key: "law_9",
    book: "48LP",
    type: "law",
    number: 9,
    title: "Win through your actions, never through argument",
    summary: "Demonstrate; don't explain.",
    fullText:
      "Any momentary triumph through argument is really a Pyrrhic victory: the resentment and ill will you stir up is stronger and lasts longer than any momentary change of opinion. It is much more powerful to get others to agree with you through your actions, without saying a word. Demonstrate, do not explicate.",
    triggers: [
      "operator about to defend a recent decision in long-form",
      "argumentative dynamic where being-right costs more than the win",
      "person whose mind changes only through observable proof",
    ],
    actions: [
      "Stop defending the decision; ship the next visible win",
      "Reply to disagreement with the next action, not a thesis",
      "Let outcomes do the persuading on a 90-day arc",
      "Refuse rematches of stale arguments",
    ],
    relatedKeys: ["law_4", "law_47", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator trapped in a recurring argument with this person? If yes, Law 9 applies — switch to demonstration.",
  },
  {
    key: "law_10",
    book: "48LP",
    type: "law",
    number: 10,
    title: "Infection: Avoid the unhappy and unlucky",
    summary: "Misery and misfortune are infectious.",
    fullText:
      "You can die from someone else's misery — emotional states are as infectious as diseases. You may feel you are helping the drowning man but you are only precipitating your own disaster. The unfortunate sometimes draw misfortune on themselves; they will also draw it on you. Associate with the happy and fortunate instead.",
    triggers: [
      "person's ledger trended net-negative for 90+ days",
      "cross-reference with operator's mastery score shows drag (>0.5 drop on chat-mention days)",
      "person.dark_traits includes drainer or chronic_victim",
    ],
    actions: [
      "Cut cadence in half for 30 days as a calibration test",
      "Stop participating in their crisis loops",
      "Replace their slot with a person whose ledger is net-positive",
      "If they recover, return cautiously; if not, formalize distance",
    ],
    relatedKeys: ["dark_drainer", "dark_chronic_victim", "strategy_withdraw"],
    applicabilityPrompt:
      "Has this person's ledger trended net-negative for 90+ days AND cross-reference with operator's mastery score shows drag? If yes, Law 10 is the central law for this profile.",
  },
  {
    key: "law_11",
    book: "48LP",
    type: "law",
    number: 11,
    title: "Learn to keep people dependent on you",
    summary: "Be the irreplaceable input to their success.",
    fullText:
      "To maintain your independence you must always be needed and wanted. The more you are relied on, the more freedom you have. Make people depend on you for their happiness and prosperity and you have nothing to fear. Never teach them enough so that they can do without you.",
    triggers: [
      "operator providing a service or skill someone uses repeatedly",
      "partnership where independence is the leverage point",
      "transitions where operator considers handing over the keys",
    ],
    actions: [
      "Document the WHAT but withhold the HOW until the relationship is locked",
      "Be the single source of a critical input",
      "Make graceful transitions conditional on commitments",
      "Resist the urge to teach yourself out of indispensability",
    ],
    relatedKeys: ["law_7", "mentor_true", "strategy_alliance"],
    applicabilityPrompt:
      "Is the operator in a relationship where leverage depends on irreplaceability? If yes, Law 11 applies.",
  },
  {
    key: "law_12",
    book: "48LP",
    type: "law",
    number: 12,
    title: "Use selective honesty and generosity to disarm",
    summary: "One sincere act covers a dozen dishonest ones.",
    fullText:
      "One sincere and honest move will cover over dozens of dishonest ones. Open-hearted gestures of honesty and generosity bring down the guard of even the most suspicious people. Once your selective honesty opens a hole in their armor, you can deceive and manipulate them at will.",
    triggers: [
      "high-trust deal pending with a guarded counterparty",
      "operator wants to lower person's defenses without burning down trust",
      "first-meeting where small concession buys long-term tolerance",
    ],
    actions: [
      "Lead with one specific, costly admission (\"that part is my weakness\")",
      "Pair it with one unsolicited generous gesture",
      "Use the opening to align — not to extract immediately",
      "Reserve full transparency for relationships that earned it",
    ],
    relatedKeys: ["law_13", "law_32", "seducer_charmer"],
    applicabilityPrompt:
      "Is the operator dealing with a guarded or suspicious counterparty? If yes, Law 12 applies.",
  },
  {
    key: "law_13",
    book: "48LP",
    type: "law",
    number: 13,
    title: "Appeal to self-interest, never to mercy or gratitude",
    summary: "If you need to ask, find what they want.",
    fullText:
      "When asking for help, do not bother to remind others of your past assistance and good deeds. They will find a way to ignore you. Instead, uncover something in your request, or in your alliance with them, that will benefit them, and emphasize it out of all proportion. They will respond enthusiastically when they see something to be gained for themselves.",
    triggers: [
      "operator preparing to ask this person for help, intro, favor, or capital",
      "past-favor mental tally being mentally cashed in",
      "ask is being framed around operator's need not theirs",
    ],
    actions: [
      "Re-frame every ask around their gain",
      "Make the ask the smallest version that solves the problem",
      "Never lead with past favors — make today's value the case",
      "Offer the helper a credit or trade they actually want",
    ],
    relatedKeys: ["law_42", "strategy_alliance", "mentor_peer"],
    applicabilityPrompt:
      "Is the operator about to ask this person for help? If yes, Law 13 applies — frame the ask around their self-interest.",
  },
  {
    key: "law_14",
    book: "48LP",
    type: "law",
    number: 14,
    title: "Pose as a friend, work as a spy",
    summary: "Knowing about your rivals is critical.",
    fullText:
      "Use spies to gather valuable information that will keep you a step ahead. Better still, play the spy yourself. In polite social encounters, learn to probe. Ask indirect questions to get people to reveal their weaknesses and intentions.",
    triggers: [
      "person.role === 'rival' or 'competitor'",
      "high power-balance positive (operator weaker)",
      "decision pending where information asymmetry matters",
    ],
    actions: [
      "Lead with curiosity, not opinion, in their company",
      "Ask soft, open questions and listen for what's said sideways",
      "Cross-reference what they say with what their actions reveal",
      "Keep your own state opaque while collecting theirs",
    ],
    relatedKeys: ["law_3", "law_44", "strategy_recon"],
    applicabilityPrompt:
      "Is this person a rival or competitor where operator is positionally weaker? If yes, Law 14 applies.",
  },
  {
    key: "law_15",
    book: "48LP",
    type: "law",
    number: 15,
    title: "Crush your enemy totally",
    summary: "A half-finished enemy comes back stronger.",
    fullText:
      "All great leaders since Moses have known that a feared enemy must be crushed completely. If one ember is left alight, no matter how dimly it smolders, a fire will eventually break out. More is lost through stopping halfway than through total annihilation. The enemy will recover and seek revenge.",
    triggers: [
      "decisive confrontation in motion where partial measures invite comeback",
      "person has history of returning after a near-loss",
      "stakes are existential, not iterative",
    ],
    actions: [
      "When you commit to confrontation, commit fully",
      "Don't accept partial concessions that leave them able to retry",
      "Make the cost of return higher than the cost of stopping",
      "Only invoke this law sparingly — most contexts reward Law 19 instead",
    ],
    relatedKeys: ["law_19", "strategy_severance", "strategy_counter"],
    applicabilityPrompt:
      "Is the operator in a terminal confrontation where partial measures invite a comeback? If yes, Law 15 applies — but verify the terminal framing first.",
  },
  {
    key: "law_16",
    book: "48LP",
    type: "law",
    number: 16,
    title: "Use absence to increase respect and honor",
    summary: "Too much circulation makes the price go down.",
    fullText:
      "The more you are seen and heard from, the more common you appear. If you are already established in a group, temporary withdrawal from it will make you more talked about, even more admired. You must learn when to leave. Create value through scarcity.",
    triggers: [
      "operator initiated 80%+ of recent interactions",
      // 2026-09-16 (W8): was "interactionCount > 20 in the last 60 days".
      // These strings are read by an LLM applicability check and a substring
      // matcher — they are instructions, so a threshold the data cannot reach
      // is a false instruction. With honest counters (the 2026-09-16 reconcile)
      // the whole-history prod maximum is 4, so ">20 in 60 days" could never be
      // true and the law could only fire on a hallucinated reading. The real
      // saturation signal is the SHAPE of the exchange, not a count.
      "operator is the one restarting the thread each time, several threads running",
      "saturation signal: replies getting shorter, energy declining",
    ],
    actions: [
      "Stop initiating for 14 days",
      "Let one of their messages go to the next morning before replying",
      "Re-enter with a discrete, high-signal moment",
      "Let absence speak for the value you bring",
    ],
    relatedKeys: ["law_8", "strategy_withdraw", "seducer_coquette"],
    applicabilityPrompt:
      "Has the operator initiated 80%+ of recent contact AND is the other side's engagement flattening (shorter replies, longer gaps, the operator always restarting)? If yes, Law 16 applies. Judge the SHAPE of the exchange — do not require a raw interaction count; the ledger only counts deliberately logged contact and undercounts real life.",
  },
  {
    key: "law_17",
    book: "48LP",
    type: "law",
    number: 17,
    title: "Keep others in suspended terror — cultivate an air of unpredictability",
    summary: "Predictability is power surrendered.",
    fullText:
      "Humans are creatures of habit with an insatiable need to see familiarity in other people's actions. Your predictability gives them a sense of control. Turn the tables: be deliberately unpredictable. Behavior that seems to have no consistency or purpose will keep them off-balance, and they will wear themselves out trying to explain your moves.",
    triggers: [
      "operator's pattern fully readable by counterparty",
      "negotiation where the other side anticipates moves",
      "social dynamic where being known is being controlled",
    ],
    actions: [
      "Vary your response cadence randomly within reasonable bounds",
      "Break one expected pattern per cycle",
      "Reveal new sides of yourself selectively",
      "Don't let your moves become a heat-map",
    ],
    relatedKeys: ["law_3", "law_25", "strategy_wait"],
    applicabilityPrompt:
      "Has the operator's behavior become fully predictable to this counterparty? If yes, Law 17 applies.",
  },
  {
    key: "law_18",
    book: "48LP",
    type: "law",
    number: 18,
    title: "Do not build fortresses to protect yourself — isolation is dangerous",
    summary: "The world is dangerous; cutting yourself off is more so.",
    fullText:
      "The world is dangerous and enemies are everywhere — everyone has to protect themselves. A fortress seems the safest. But isolation exposes you to more dangers than it protects you from. Information cannot reach you; you become an easy target. Better to circulate among people, find allies, mingle.",
    triggers: [
      "operator isolating from network during stress",
      "person.role === 'close_friend' losing touch due to operator withdrawal",
      "decision-making becoming insular and brittle",
    ],
    actions: [
      "Re-engage 2-3 trusted people this week",
      "Trade a piece of intel even when you'd rather hoard",
      "Let allies see the work in progress, not just the polish",
      "Resist the urge to face a hard month alone",
    ],
    relatedKeys: ["law_2", "strategy_alliance", "mentor_peer"],
    applicabilityPrompt:
      "Is the operator isolating from network during a hard stretch? If yes, Law 18 applies.",
  },
  {
    key: "law_19",
    book: "48LP",
    type: "law",
    number: 19,
    title: "Know who you're dealing with — do not offend the wrong person",
    summary: "Different people require different responses.",
    fullText:
      "There are many different kinds of people in the world and you can never assume that everyone will react to your strategies in the same way. Deceive or outmaneuver some people and they will spend the rest of their lives seeking revenge. They are wolves in lambs' clothing. Choose your victims and opponents carefully — never offend or deceive the wrong person.",
    triggers: [
      "person's known network gives them outsized retaliation reach",
      "operator about to confront someone whose profile is unread",
      "low-context move planned against someone with high context power",
    ],
    actions: [
      "Profile the person fully before any confrontation",
      "Check their network reach against your blast radius",
      "Use a calibrated test before a real move",
      "When in doubt, default to Law 9 (demonstrate) over Law 15 (crush)",
    ],
    relatedKeys: ["law_15", "law_14", "strategy_recon"],
    applicabilityPrompt:
      "Is the operator about to make a confrontational move against an under-profiled person? If yes, Law 19 applies — pause and profile first.",
  },
  {
    key: "law_20",
    book: "48LP",
    type: "law",
    number: 20,
    title: "Do not commit to anyone",
    summary: "Keep yourself free, fluid, available.",
    fullText:
      "It is the fool who always rushes to take sides. Do not commit to any side or cause but yourself. By maintaining your independence, you become the master of others — playing people against one another, making them pursue you.",
    triggers: [
      "operator being pressured into a faction or alliance",
      "early-stage relationship where lock-in costs option value",
      "multiple parties courting commitment from operator",
    ],
    actions: [
      "Decline early loyalty pledges politely but firmly",
      "Keep multiple options open until one decisively wins",
      "Let pursuers compete for your attention",
      "Frame neutrality as principled, not evasive",
    ],
    relatedKeys: ["law_3", "law_8", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator being pressured into a faction or alliance early? If yes, Law 20 applies — preserve optionality.",
  },
  {
    key: "law_21",
    book: "48LP",
    type: "law",
    number: 21,
    title: "Play a sucker to catch a sucker — seem dumber than your mark",
    summary: "Let them feel smart; they'll lower their guard.",
    fullText:
      "No one likes feeling stupid. The trick is to make your victims feel smart — and not just smart, but smarter than you are. Once convinced of this, they will never suspect that you may have ulterior motives.",
    triggers: [
      "negotiation where the other party leads with status display",
      "person who responds well to feeling like the smart one",
      "operator's expertise creating defensiveness",
    ],
    actions: [
      "Ask basic questions even when you know the answer",
      "Let them explain things to you they think they're explaining",
      "Hold back one degree of insight in every exchange",
      "Reserve the depth for the right moment",
    ],
    relatedKeys: ["law_4", "law_38", "seducer_natural"],
    applicabilityPrompt:
      "Is the operator's expertise creating defensiveness or status friction? If yes, Law 21 applies.",
  },
  {
    key: "law_22",
    book: "48LP",
    type: "law",
    number: 22,
    title: "Use the surrender tactic: transform weakness into power",
    summary: "Surrender buys time and exposes the victor's overreach.",
    fullText:
      "When you are weaker, never fight for honor's sake; choose surrender instead. Surrender gives you time to recover, time to torment and irritate your conqueror, time to wait for his power to wane. Do not give him the satisfaction of fighting and defeating you — surrender first. By turning the other cheek, you infuriate and unsettle him.",
    triggers: [
      "operator clearly outmatched in a current conflict",
      "honor-fight with no upside but high downside",
      "loss is inevitable; the question is how clean the exit is",
    ],
    actions: [
      "Concede the lost battle visibly and quickly",
      "Re-route resources to where you can win",
      "Let the overreach of the victor work against them over time",
      "Don't confuse surrender with submission",
    ],
    relatedKeys: ["law_15", "strategy_withdraw", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator in an outmatched conflict where honor-fighting would compound the loss? If yes, Law 22 applies.",
  },
  {
    key: "law_23",
    book: "48LP",
    type: "law",
    number: 23,
    title: "Concentrate your forces",
    summary: "Find the single richest source and dig deep.",
    fullText:
      "Conserve your forces and energies by keeping them concentrated at their strongest point. You gain more by finding a rich mine and mining it deeper than by flitting from one shallow mine to another. Intensity defeats extensity every time.",
    triggers: [
      "operator's attention scattered across many sub-projects",
      "leverage signal showing one relationship/project compounds best",
      "shallow engagement across many vs deep on few",
    ],
    actions: [
      "Identify the top 1-2 leverage points right now",
      "Cut or pause everything below the cutline",
      "Reinvest the saved energy into the depth play",
      "Don't apologize for the discipline",
    ],
    relatedKeys: ["law_7", "strategy_engage", "mastery_apprenticeship"],
    applicabilityPrompt:
      "Is the operator's effort scattered across many shallow fronts? If yes, Law 23 applies.",
  },
  {
    key: "law_24",
    book: "48LP",
    type: "law",
    number: 24,
    title: "Play the perfect courtier",
    summary: "Indirect, polished, alert to power dynamics — that is the courtier.",
    fullText:
      "The perfect courtier thrives in a world where everything revolves around power and political dexterity. He has mastered the art of indirection; he flatters, yields to superiors, and asserts power over others in the most oblique and graceful manner.",
    triggers: [
      "operator in a politically dense environment (boardroom, status-driven peer group)",
      "high-context organization where direct moves backfire",
      "alliance-building inside a hierarchy",
    ],
    actions: [
      "Read the room before speaking; never lead with a blunt take in mixed company",
      "Make every superior feel respected without being obsequious",
      "Earn credit through service, not through claiming",
      "Save your strong opinions for one-on-ones",
    ],
    relatedKeys: ["law_1", "law_38", "law_46"],
    applicabilityPrompt:
      "Is the operator operating inside a high-context political environment? If yes, Law 24 applies.",
  },
  {
    key: "law_25",
    book: "48LP",
    type: "law",
    number: 25,
    title: "Re-create yourself",
    summary: "Do not accept the role society foists on you; cast a new one.",
    fullText:
      "Do not accept the roles that society foists on you. Re-create yourself by forging a new identity, one that commands attention and never bores the audience. Be the master of your own image rather than letting others define it for you. Incorporate dramatic devices into your public gestures and actions — your power will be enhanced and your character will seem larger than life.",
    triggers: [
      "operator boxed into a stale identity by peer group or family",
      "new chapter (business pivot, life phase) where the old frame doesn't serve",
      "platform reset where you control the introduction",
    ],
    actions: [
      "Choose the next identity deliberately, not by default",
      "Drop a defining label that no longer applies",
      "Introduce the new self consistently across surfaces",
      "Let the old identity die through non-use, not announcement",
    ],
    relatedKeys: ["law_6", "law_37", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator in a transition where the old identity no longer serves the next chapter? If yes, Law 25 applies.",
  },
  {
    key: "law_26",
    book: "48LP",
    type: "law",
    number: 26,
    title: "Keep your hands clean",
    summary: "Have a useful pawn do the unclean work.",
    fullText:
      "You must seem a paragon of civility and efficiency: your hands are never soiled by mistakes and nasty deeds. Maintain such a spotless appearance by using others as scapegoats and cat's-paws to disguise your involvement.",
    triggers: [
      "operator facing a necessary but reputation-costly action",
      "the unclean step has a willing executor with their own motive",
      "context where direct visible involvement compounds the cost",
    ],
    actions: [
      "Find someone whose interest already aligns with the move you need",
      "Provide the platform, not the order",
      "Reserve your visible identity for the clean half of the work",
      "Don't ask for unethical work — partner where motives genuinely align",
    ],
    relatedKeys: ["law_7", "law_5", "strategy_alliance"],
    applicabilityPrompt:
      "Is the operator facing a necessary action whose execution would cost them reputation if done directly? If yes, Law 26 applies — and check that alignment is genuine.",
  },
  {
    key: "law_27",
    book: "48LP",
    type: "law",
    number: 27,
    title: "Play on people's need to believe — create a cult-like following",
    summary: "People have an overwhelming desire to believe in something.",
    fullText:
      "Become the focal point of such desire by offering them a cause, a new faith to follow. Promise the moon but be vague; surround yourself with the trappings of mystery and certainty. Use this with care — abusing belief creates a backlash.",
    triggers: [
      "person.role === 'follower' or 'mentee' looking to operator for direction",
      "operator's body of work attracts believers organically",
      "movement-style traction emerging around operator's POV",
    ],
    actions: [
      "Articulate a 1-sentence credo that anchors the community",
      "Create rituals that mark belonging",
      "Deliver visible wins so the belief is grounded, not blind",
      "Refuse the messiah frame; route believers back to their own agency",
    ],
    relatedKeys: ["law_6", "seducer_charismatic", "mastery_creative"],
    applicabilityPrompt:
      "Does this person actively follow the operator or look to operator for direction? If yes, Law 27 applies — meet the need for belief with intentional framing.",
  },
  {
    key: "law_28",
    book: "48LP",
    type: "law",
    number: 28,
    title: "Enter action with boldness",
    summary: "Half-measures invite resistance; boldness compels.",
    fullText:
      "If you are unsure of a course of action, do not attempt it. Your doubts and hesitations will infect your execution. Timidity is dangerous: better to enter with boldness. Any mistakes you commit through audacity are easily corrected. Boldness conceals weakness; timidity exposes it.",
    triggers: [
      "operator about to execute half-measure on a decision already made",
      "stakes require commitment-language not maybe-language",
      "audience reading hesitation as weakness",
    ],
    actions: [
      "Once committed, frame the move with full conviction in messaging",
      "Strip hedging language from public statements",
      "Move on the schedule you'd move on if you were certain",
      "Save the doubts for the war room, not the announcement",
    ],
    relatedKeys: ["law_4", "law_9", "strategy_engage"],
    applicabilityPrompt:
      "Is the operator about to execute a decision they've already made with hesitating energy? If yes, Law 28 applies.",
  },
  {
    key: "law_29",
    book: "48LP",
    type: "law",
    number: 29,
    title: "Plan all the way to the end",
    summary: "Map the consequences before you start.",
    fullText:
      "The ending is everything. Plan all the way to it, taking into account all the possible consequences, obstacles, and twists of fortune that might reverse your hard work and give the glory to others. By planning to the end you will not be overwhelmed by circumstances.",
    triggers: [
      "operator about to launch a multi-step initiative without an end-state defined",
      "decision tree branches unexplored",
      "common failure modes for this kind of project unmapped",
    ],
    actions: [
      "Write the success definition before starting",
      "Pre-mortem the top 3 failure modes",
      "Define the exit conditions and the celebrate conditions",
      "Reserve weekly time to re-check the plan against reality",
    ],
    relatedKeys: ["law_3", "strategy_recon", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator about to launch a multi-step initiative without an end-state defined? If yes, Law 29 applies.",
  },
  {
    key: "law_30",
    book: "48LP",
    type: "law",
    number: 30,
    title: "Make your accomplishments seem effortless",
    summary: "Conceal the sweat; show the result.",
    fullText:
      "Your actions must seem natural and executed with ease. All the toil and practice that go into them, and also the clever tricks, must be concealed. When you act, do so effortlessly, as if you could do much more. Avoid the temptation of revealing how hard you work — it raises questions.",
    triggers: [
      "operator about to share the gory details of how hard the win was",
      "audience that rewards effortless mastery over grind",
      "competitive context where visible struggle invites doubt",
    ],
    actions: [
      "Lead with the result; bury the process",
      "Keep the gym videos in private chat, not in keynote",
      "Let people guess at the depth of your prep",
      "Reserve the grind-story for mentees, not the public",
    ],
    relatedKeys: ["law_4", "law_25", "mastery_invisible"],
    applicabilityPrompt:
      "Is the operator about to publicize how hard a win was, in a context that rewards effortlessness? If yes, Law 30 applies.",
  },
  {
    key: "law_31",
    book: "48LP",
    type: "law",
    number: 31,
    title: "Control the options — get others to play with the cards you deal",
    summary: "Choose the choices they choose from.",
    fullText:
      "The best deceptions are the ones that seem to give the other person a choice: your victims feel they are in control, but are actually your puppets. Give people options that come out in your favor whichever one they choose. Force them to make choices between the lesser of two evils, both of which serve your purpose.",
    triggers: [
      "negotiation where you control the menu",
      "operator getting trapped by open-ended counter-proposals",
      "delegation where outcomes vary too widely",
    ],
    actions: [
      "Present 2-3 framed options rather than open-ended ask",
      "Make every offered choice acceptable to you",
      "Anchor the bracket around your target",
      "Avoid surprises by removing the off-menu option early",
    ],
    relatedKeys: ["law_3", "law_8", "strategy_engage"],
    applicabilityPrompt:
      "Is the operator in a negotiation where they could be framing the choices rather than reacting to them? If yes, Law 31 applies.",
  },
  {
    key: "law_32",
    book: "48LP",
    type: "law",
    number: 32,
    title: "Play to people's fantasies",
    summary: "Truth is harsh; fantasy is what people pay for.",
    fullText:
      "The truth is often avoided because it is ugly and unpleasant. Never appeal to truth and reality unless you are prepared for the anger that comes from disenchantment. Life is so harsh and distressing that people who can manufacture romance or conjure up fantasy are like oases in the desert: everyone flocks to them.",
    triggers: [
      "audience tired of harsh reality and seeking aspiration",
      "operator's pitch competing with grim alternatives",
      "story-economy context where narrative beats spreadsheet",
    ],
    actions: [
      "Anchor your offering in the better-future story",
      "Use specific, sensory language for the dream-state",
      "Sequence proof points after the vision, not before",
      "Don't sell the spreadsheet; sell the life it pays for",
    ],
    relatedKeys: ["law_27", "law_25", "seducer_charismatic"],
    applicabilityPrompt:
      "Is the operator pitching into an audience hungry for aspiration over reality? If yes, Law 32 applies.",
  },
  {
    key: "law_33",
    book: "48LP",
    type: "law",
    number: 33,
    title: "Discover each man's thumbscrew",
    summary: "Find their weakness and you have the lever.",
    fullText:
      "Everyone has a weakness, a gap in the castle wall. That weakness is usually an insecurity, an uncontrollable emotion or need; it can also be a small secret pleasure. Either way, once found, it is a thumbscrew you can turn to your advantage.",
    triggers: [
      "negotiation where you need to understand their real motivator",
      "person whose stated reason and real reason differ",
      "decision where their unspoken concern dominates the outcome",
    ],
    actions: [
      "Listen for what makes them visibly emotional",
      "Note what they over-explain or defend",
      "Test small probes; calibrate the response",
      "Use the lever for alignment, not coercion — Law 19 still applies",
    ],
    relatedKeys: ["law_14", "law_43", "strategy_recon"],
    applicabilityPrompt:
      "Is the operator missing the real motivator behind this person's behavior? If yes, Law 33 applies.",
  },
  {
    key: "law_34",
    book: "48LP",
    type: "law",
    number: 34,
    title: "Be royal in your own fashion — act like a king",
    summary: "Carry yourself as inevitable.",
    fullText:
      "The way you carry yourself will often determine how you are treated: in the long run, appearing vulgar or common will make people disrespect you. A king respects himself and inspires the same sentiment in others. By acting regally and confident of your powers, you make yourself seem destined to wear a crown.",
    triggers: [
      "operator entering a new room or higher-tier circle",
      "self-presentation slipping into apologetic or hesitant",
      "audience that calibrates to confidence signals",
    ],
    actions: [
      "Match the dress, pacing, and posture of the room you're entering",
      "Drop apologetic openers; lead with the value",
      "Walk in like you belong even when uncertain",
      "Let confidence calibrate, not cosplay — Greene's regality is composed, not loud",
    ],
    relatedKeys: ["law_6", "law_28", "seducer_charismatic"],
    applicabilityPrompt:
      "Is the operator entering a higher-tier circle where carriage matters? If yes, Law 34 applies.",
  },
  {
    key: "law_35",
    book: "48LP",
    type: "law",
    number: 35,
    title: "Master the art of timing",
    summary: "Never seem to be in a hurry — hurry betrays lack of control.",
    fullText:
      "Never seem to be in a hurry — hurrying betrays a lack of control over yourself, and over time. Always seem patient, as if you know that everything will come to you eventually. Become a detective of the right moment; sniff out the spirit of the times, the trends that will carry you to power.",
    triggers: [
      "operator about to push for resolution because of internal urgency",
      "market timing where waiting compounds",
      "person who reads urgency as weakness",
    ],
    actions: [
      "Slow your visible cadence to project control",
      "Distinguish real deadlines from manufactured ones",
      "Time your moves to the wave, not the clock",
      "Let the moment come to you when it's almost there anyway",
    ],
    relatedKeys: ["law_4", "law_47", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator rushing a resolution due to internal urgency rather than external timing? If yes, Law 35 applies.",
  },
  {
    key: "law_36",
    book: "48LP",
    type: "law",
    number: 36,
    title: "Disdain things you cannot have — ignoring them is the best revenge",
    summary: "Acknowledgment is half their power. Withdraw it.",
    fullText:
      "By acknowledging a petty problem you give it existence and credibility. The more attention you pay an enemy, the stronger you make him; and a small mistake is often made worse and more visible when you try to fix it. It is sometimes best to leave things alone.",
    triggers: [
      "low-status detractor seeking a public engagement",
      "minor slight that would grow with response",
      "lost opportunity tempting operator into prolonged regret",
    ],
    actions: [
      "Refuse to engage low-status detractors publicly",
      "Withdraw attention from things you can't change",
      "Let stale wounds close through non-touch",
      "Save the public energy for what actually moves",
    ],
    relatedKeys: ["law_5", "law_9", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator considering public engagement with a low-stakes detractor? If yes, Law 36 applies.",
  },
  {
    key: "law_37",
    book: "48LP",
    type: "law",
    number: 37,
    title: "Create compelling spectacles",
    summary: "What people see is more powerful than what you tell them.",
    fullText:
      "Striking imagery and grand symbolic gestures create the aura of power — everyone responds to them. Stage spectacles for those around you, then, full of arresting visuals and radiant symbols that heighten your presence. Dazzled by appearances, no one will notice what you are really doing.",
    triggers: [
      "operator preparing a launch or public reveal",
      "moment where the story compounds the substance",
      "platform context that rewards visible scale and ceremony",
    ],
    actions: [
      "Stage the announcement in a moment, not a memo",
      "Use one signature visual that brands the move",
      "Time the reveal to the audience peak",
      "Let the spectacle frame the work without becoming the work",
    ],
    relatedKeys: ["law_6", "law_25", "law_32"],
    applicabilityPrompt:
      "Is the operator preparing a launch or public reveal where staging matters? If yes, Law 37 applies.",
  },
  {
    key: "law_38",
    book: "48LP",
    type: "law",
    number: 38,
    title: "Think as you like but behave like others",
    summary: "Read the room. Conform outwardly when the cost of nonconformity exceeds the value.",
    fullText:
      "If you make a show of going against the times, flaunting unconventional ideas and unorthodox ways, people will think you only want attention and look down on you. They will find a way to punish you. It is far safer to blend in and nurture the common touch. Share your originality only with tolerant friends.",
    triggers: [
      "person.relationship === 'business' or 'network_only'",
      "operator's idiosyncratic views could cost rapport with low upside",
      "low-context group where signaling difference costs more than it earns",
    ],
    actions: [
      "Calibrate outward signaling to the group's norm",
      "Save edgy takes for the right audience",
      "Don't confuse rebellion with leadership",
      "Earn the right to be different before exercising it",
    ],
    relatedKeys: ["law_1", "law_24", "seducer_natural"],
    applicabilityPrompt:
      "Is this a low-context business or network relationship where idiosyncratic views could cost rapport? If yes, Law 38 applies.",
  },
  {
    key: "law_39",
    book: "48LP",
    type: "law",
    number: 39,
    title: "Stir up waters to catch fish",
    summary: "Cool head + their anger = your edge.",
    fullText:
      "Anger and emotion are strategically counterproductive. You must always stay calm and objective. But if you can make your enemies angry while staying calm yourself, you gain a decided advantage. Put your enemies off-balance: find the chink in their vanity through which you can rattle them and you hold the strings.",
    triggers: [
      "counterparty whose decisions degrade under emotional pressure",
      "negotiation where their composure is their advantage",
      "operator about to be drawn into their emotional frame",
    ],
    actions: [
      "Refuse the emotional frame; reply with calm specificity",
      "Use small probes that rattle without exposing your hand",
      "Let their anger reveal information they would not have shared",
      "Never lose your own composure — that's the whole edge",
    ],
    relatedKeys: ["law_3", "law_14", "strategy_counter"],
    applicabilityPrompt:
      "Is the operator dealing with a counterparty whose composure is their advantage? If yes, Law 39 applies.",
  },
  {
    key: "law_40",
    book: "48LP",
    type: "law",
    number: 40,
    title: "Despise the free lunch",
    summary: "What's free has a hidden price.",
    fullText:
      "What is offered for free is dangerous — it usually involves either a trick or a hidden obligation. What has worth is worth paying for. By paying your own way, you stay clear of gratitude, guilt, and deceit. It is also often wise to pay the full price — there is no cutting corners with excellence.",
    triggers: [
      "person offering a free favor that creates implicit obligation",
      "free-trial or sample whose lock-in is the real product",
      "operator about to accept a 'gift' that compromises future leverage",
    ],
    actions: [
      "Pay the going rate for valuable work — preserve negotiating posture",
      "Convert any meaningful favor into an explicit trade",
      "Walk away from 'free' offerings whose lock-in isn't clear",
      "Recognize that gratitude is a real currency",
    ],
    relatedKeys: ["law_13", "law_42", "strategy_alliance"],
    applicabilityPrompt:
      "Is someone offering operator a 'free' favor whose obligation could constrain a future move? If yes, Law 40 applies.",
  },
  {
    key: "law_41",
    book: "48LP",
    type: "law",
    number: 41,
    title: "Avoid stepping into a great man's shoes",
    summary: "Establish your own name; don't live in someone else's shadow.",
    fullText:
      "What happens first always appears better and more original than what comes after. If you succeed a great man or have a famous parent, you will have to accomplish double their achievements to outshine them. Do not get lost in their shadow, or stuck in a past not of your own making: establish your own name and identity by changing course.",
    triggers: [
      "operator inheriting a role or business with a famous predecessor",
      "comparison to the previous occupant being the default conversation",
      "trying to recreate a past success in a new chapter",
    ],
    actions: [
      "Don't try to outdo the predecessor on their terms",
      "Rebrand the role around what only you can do",
      "Cut visible continuity to the past where it constrains you",
      "Run the unique play, not the inherited one",
    ],
    relatedKeys: ["law_25", "law_5", "mastery_creative"],
    applicabilityPrompt:
      "Has the operator inherited a role or chapter from a notable predecessor? If yes, Law 41 applies.",
  },
  {
    key: "law_42",
    book: "48LP",
    type: "law",
    number: 42,
    title: "Strike the shepherd and the sheep will scatter",
    summary: "Find the source of trouble; remove that one.",
    fullText:
      "Trouble can often be traced to a single strong individual — the stirrer, the arrogant underling, the poisoner of goodwill. If you allow such people room to operate, others will succumb to their influence. Do not wait for the troubles they cause to multiply; do not try to negotiate with them. Neutralize their influence by isolating or banishing them.",
    triggers: [
      "team or group with a single hostile influence driving most friction",
      "operator's environment poisoned by one bad actor",
      "incidents tracing back to a common source",
    ],
    actions: [
      "Trace incidents to their source rather than treating symptoms",
      "Address the source directly; don't try group remedies",
      "Be willing to remove or isolate the single influence",
      "Watch the rest of the group recover once the source is handled",
    ],
    relatedKeys: ["law_15", "law_19", "strategy_severance"],
    applicabilityPrompt:
      "Is the operator's environment being poisoned by a single bad actor? If yes, Law 42 applies — verify the source carefully before acting.",
  },
  {
    key: "law_43",
    book: "48LP",
    type: "law",
    number: 43,
    title: "Work on the hearts and minds of others",
    summary: "Coercion creates a reaction that will eventually work against you.",
    fullText:
      "You must seduce others into wanting to move in your direction. A person whom you have seduced becomes your loyal pawn. Work on emotions and individual psychology to bring people into your orbit.",
    triggers: [
      "person.role === 'mentor', 'mentee', 'friend', or 'close_friend'",
      "context where coercion would damage long-term value",
      "alignment over compliance is the goal",
    ],
    actions: [
      "Lead with what they already want and link to your direction",
      "Use stories and emotional anchors, not pressure",
      "Earn alignment one conversation at a time",
      "Refuse coercion even when it's available",
    ],
    relatedKeys: ["law_13", "law_27", "law_33"],
    applicabilityPrompt:
      "Is this a high-trust role where coercion would damage long-term value? If yes, Law 43 always applies.",
  },
  {
    key: "law_44",
    book: "48LP",
    type: "law",
    number: 44,
    title: "Disarm and infuriate with the mirror effect",
    summary: "Reflect their behavior back; teach them a lesson without saying a word.",
    fullText:
      "The mirror reflects reality, but it is also the perfect tool for deception: when you mirror your enemies, doing exactly as they do, they cannot figure out your strategy. The Mirror Effect mocks and humiliates them, making them overreact. By holding up a mirror to their psyches, you seduce them with the illusion that you share their values; by holding up a mirror to their actions, you teach them a lesson.",
    triggers: [
      "person's pattern is so persistent that words have failed to change it",
      "operator wants them to feel what they do to others",
      "low-cost tactical reflection moment",
    ],
    actions: [
      "Use their own move back at them at a measured intensity",
      "Stay calm; let the mirror do the work",
      "Don't escalate beyond the mirror angle",
      "Withdraw the mirror once the message lands",
    ],
    relatedKeys: ["law_14", "law_39", "strategy_counter"],
    applicabilityPrompt:
      "Has a person's pattern persisted despite operator's direct feedback? If yes, Law 44's mirror tactic may apply.",
  },
  {
    key: "law_45",
    book: "48LP",
    type: "law",
    number: 45,
    title: "Preach the need for change, but never reform too much at once",
    summary: "Change feels safer when framed as continuity.",
    fullText:
      "Everyone understands the need for change in the abstract, but on the day-to-day level people are creatures of habit. Too much innovation is traumatic, and will lead to revolt. If you are new to a position of power, or an outsider trying to build a power base, make a show of respecting the old way of doing things. If change is necessary, make it feel like a gentle improvement on the past.",
    triggers: [
      "operator newly arrived in a position with reform mandate",
      "audience resistant to step-change despite agreeing in principle",
      "transformation that risks losing the room",
    ],
    actions: [
      "Frame the change as a continuation of values, not a break",
      "Ship reforms in small visible increments",
      "Honor what the legacy got right before changing it",
      "Phase the radical moves over months, not weeks",
    ],
    relatedKeys: ["law_38", "law_25", "mastery_apprenticeship"],
    applicabilityPrompt:
      "Has the operator newly arrived in a role where they're expected to reform but the audience resists pace? If yes, Law 45 applies.",
  },
  {
    key: "law_46",
    book: "48LP",
    type: "law",
    number: 46,
    title: "Never appear too perfect",
    summary: "Display a few flaws — perfection breeds envy and silent enemies.",
    fullText:
      "Appearing better than others is always dangerous, but most dangerous of all is to appear to have no faults or weaknesses. Envy creates silent enemies. It is smart to occasionally display defects and admit to harmless vices, in order to deflect envy and appear more human and approachable. Only gods and the dead can seem perfect with impunity.",
    triggers: [
      "operator's public persona becoming polished to the point of envy",
      "peer group where envy already shows in cold-shoulder signals",
      "audience that connects with humanity over perfection",
    ],
    actions: [
      "Share one honest, non-strategic vulnerability",
      "Drop a self-deprecating note that's funny but true",
      "Show the work behind a win — once — to dispel the magic",
      "Don't manufacture flaws; surface the real, small ones",
    ],
    relatedKeys: ["law_5", "law_1", "dark_envious"],
    applicabilityPrompt:
      "Is the operator's persona reading as perfect to the point of inviting envy? If yes, Law 46 applies.",
  },
  {
    key: "law_47",
    book: "48LP",
    type: "law",
    number: 47,
    title: "In victory, learn when to stop",
    summary: "Don't go past the mark you aimed for.",
    fullText:
      "The moment of victory is often the moment of greatest peril. In the heat of victory, arrogance and overconfidence can push you past the goal you had aimed for, and by going too far, you make more enemies than you defeat. Do not allow success to go to your head.",
    triggers: [
      "operator recently 'won' an interaction (favor granted, argument resolved in your favor)",
      "post-win urge to press for more",
      "victory lap building unnecessary enmity",
    ],
    actions: [
      "Restrain the urge to press further after the goal is reached",
      "Document the win and walk away from the table",
      "Don't extract a second concession that wasn't planned",
      "Give the loser a face-saving exit",
    ],
    relatedKeys: ["law_15", "law_22", "strategy_wait"],
    applicabilityPrompt:
      "Has the operator recently 'won' an interaction with this person? If yes, Law 47 applies — restrain the urge to press further.",
  },
  {
    key: "law_48",
    book: "48LP",
    type: "law",
    number: 48,
    title: "Assume formlessness",
    summary: "Be water — adapt to the shape that wins.",
    fullText:
      "By taking a shape, by having a visible plan, you open yourself to attack. Instead of taking a form for your enemy to grasp, keep yourself adaptable and on the move. Accept the fact that nothing is certain and no law is fixed. The best way to protect yourself is to be as fluid and formless as water; never bet on stability or lasting order. Everything changes.",
    triggers: [
      "environment shifting faster than your fixed plan can absorb",
      "competitive context where your strategy has become readable",
      "operator clinging to a model that no longer fits",
    ],
    actions: [
      "Treat your strategy as a draft, not a contract",
      "Build optionality into every commitment",
      "Read the change before it forces you",
      "Hold goals fixed, change methods fluidly",
    ],
    relatedKeys: ["law_17", "law_20", "strategy_recon"],
    applicabilityPrompt:
      "Is the operator's plan becoming readable or stuck against a faster-moving environment? If yes, Law 48 applies.",
  },
];
