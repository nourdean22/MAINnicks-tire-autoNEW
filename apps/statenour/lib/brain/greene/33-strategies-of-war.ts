/**
 * 2026-05-28 · Power Atlas · The 33 Strategies of War · full set.
 *
 * Robert Greene's strategic taxonomy. Each strategy is authored as one
 * GreeneEntry with operator-schema triggers + imperative actions +
 * cross-book related keys.
 *
 * Source: Robert Greene, "The 33 Strategies of War" (2006).
 */

import type { GreeneEntry } from "./schema";

export const WAR_STRATEGIES: GreeneEntry[] = [
  // ── Part 1 · Self-Directed Warfare ─────────────────────────────
  {
    key: "strategy_polarity",
    book: "33SW",
    type: "strategy",
    number: 1,
    title: "Declare war on your enemies — the polarity strategy",
    summary: "Knowing what you're fighting against sharpens what you're fighting for.",
    fullText:
      "Life is a battle. Even when you don't think you're at war, you have enemies — people who block you, undermine you, or simply benefit from your standing still. Identify them. Naming an enemy clarifies your direction; the opposition becomes the mirror that defines your edge.",
    triggers: [
      "operator drifting without a clear adversarial force in mind",
      "lack of urgency in pursuing a goal",
      "competitive blind spot — operator doesn't know who's eating their lunch",
    ],
    actions: [
      "Name one specific adversary (person, force, or stagnant version of self)",
      "Use the opposition to clarify what you stand for by contrast",
      "Sharpen weekly priorities against the named opposition",
      "Avoid the trap of fighting a vague 'everyone'",
    ],
    relatedKeys: ["law_25", "mastery_creative", "strategy_engage"],
    applicabilityPrompt:
      "Is the operator drifting without a clear adversary or contrast that sharpens direction? If yes, Strategy 1 applies.",
  },
  {
    key: "strategy_guerrilla_mind",
    book: "33SW",
    type: "strategy",
    number: 2,
    title: "Do not fight the last war — the guerrilla-war-of-the-mind strategy",
    summary: "Refuse stale playbooks; assume every situation is novel.",
    fullText:
      "The past is the dead hand on the present. Strategies that worked once become the cage that loses you the next war. Treat every problem as if seen for the first time; refuse the comfortable map.",
    triggers: [
      "operator running the same playbook that won last cycle",
      "context has shifted but tactics haven't",
      "advice that starts with 'we always do it this way'",
    ],
    actions: [
      "Force a first-principles re-derivation each quarter",
      "Audit which beliefs are still earning their keep",
      "Talk to people outside the usual circle",
      "Make experiments cheap and frequent",
    ],
    relatedKeys: ["law_48", "law_25", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator applying a stale playbook to a changed context? If yes, Strategy 2 applies.",
  },
  {
    key: "strategy_present_mind",
    book: "33SW",
    type: "strategy",
    number: 3,
    title: "Amid the turmoil of events, do not lose your presence of mind",
    summary: "Calm in chaos is its own weapon.",
    fullText:
      "Loss of composure compounds losses. In moments of fear or crisis, the leader who keeps their mind clear acts while others freeze. Cultivate presence as a strategic asset.",
    triggers: [
      "operator entering a high-stakes / high-emotion moment",
      "team or counterparty escalating intensity",
      "sleep-deprived or HALT-state decision pending",
    ],
    actions: [
      "Force one deep breath before any reactive message",
      "Postpone irreversible decisions until presence returns",
      "Lower visible volume; raise observable steadiness",
      "Run the day on rituals, not reactions",
    ],
    relatedKeys: ["law_35", "law_39", "mastery_invisible"],
    applicabilityPrompt:
      "Is the operator in a high-emotion moment where composure is the edge? If yes, Strategy 3 applies.",
  },
  {
    key: "strategy_urgency",
    book: "33SW",
    type: "strategy",
    number: 4,
    title: "Create a sense of urgency and desperation — the death-ground strategy",
    summary: "Backed against the wall, you fight twice as hard.",
    fullText:
      "Comfort breeds passivity. Putting yourself in a position where retreat is not an option forces clarity and commitment. Engineer the death-ground state when you need to break through plateau.",
    triggers: [
      "operator coasting on past wins, no real downside",
      "comfortable plateau that's hiding a slow decline",
      "decision deferred indefinitely because cost of waiting is invisible",
    ],
    actions: [
      "Announce a deadline publicly so retreat costs face",
      "Commit capital that can't be recovered without follow-through",
      "Burn one fallback option that was secretly keeping you soft",
      "Use the urgency to clarify, not to panic",
    ],
    relatedKeys: ["law_28", "fearless_2", "mastery_apprenticeship"],
    applicabilityPrompt:
      "Is the operator stuck on a comfortable plateau where pain-free options are blocking momentum? If yes, Strategy 4 applies.",
  },
  // ── Part 2 · Organizational (Team) Warfare ─────────────────────
  {
    key: "strategy_command",
    book: "33SW",
    type: "strategy",
    number: 5,
    title: "Avoid the snares of groupthink — the command-and-control strategy",
    summary: "Decisions must come from one clear mind, not committee.",
    fullText:
      "Group consensus dilutes responsibility and produces lowest-common-denominator action. Establish clear command: one decider, broad input, swift execution.",
    triggers: [
      "decision being made by committee with diffuse accountability",
      "operator team confused about who owns the call",
      "consensus being mistaken for clarity",
    ],
    actions: [
      "Name the single decider for each call",
      "Solicit input from all; reserve the decision to one",
      "Make accountability visible after the call lands",
      "Avoid the consensus dilution trap",
    ],
    relatedKeys: ["law_24", "mastery_apprenticeship", "strategy_engage"],
    applicabilityPrompt:
      "Is the operator's team blurring ownership through consensus? If yes, Strategy 5 applies.",
  },
  {
    key: "strategy_segment",
    book: "33SW",
    type: "strategy",
    number: 6,
    title: "Segment your forces — the controlled-chaos strategy",
    summary: "Small autonomous units beat slow monoliths.",
    fullText:
      "Break your forces into smaller, autonomous units that can move independently. Each unit feels ownership, moves faster, and adapts to local conditions without waiting for headquarters.",
    triggers: [
      "operator running a monolithic project that's slowing under its own weight",
      "team friction from too-many-cooks coordination overhead",
      "experiments queued behind a single bottleneck",
    ],
    actions: [
      "Split the big initiative into 2-3 autonomous tracks",
      "Give each track a clear owner with real decision authority",
      "Reconverge at a shared cadence, not in real time",
      "Reward local initiative, not just headquarters approval",
    ],
    relatedKeys: ["law_23", "mastery_apprenticeship", "strategy_command"],
    applicabilityPrompt:
      "Is a single monolithic initiative slowing under coordination overhead? If yes, Strategy 6 applies.",
  },
  {
    key: "strategy_morale",
    book: "33SW",
    type: "strategy",
    number: 7,
    title: "Transform your war into a crusade — the morale strategies",
    summary: "People fight for meaning more than for money.",
    fullText:
      "Material incentives are limited; the spirit of a cause has no ceiling. Frame your effort as a crusade. People will sacrifice for meaning what they would never offer for pay.",
    triggers: [
      "team motivation flagging despite adequate compensation",
      "operator's pitch landing as transactional instead of transformative",
      "audience tired of cost/benefit framings",
    ],
    actions: [
      "Anchor the mission in a story bigger than the product",
      "Surface the higher-order purpose in every weekly touchpoint",
      "Connect each contributor's work to the larger arc",
      "Don't fake the cause — surface the real meaning you already act on",
    ],
    relatedKeys: ["law_27", "law_32", "seducer_charismatic"],
    applicabilityPrompt:
      "Is the operator's effort framed transactionally when it could be a cause? If yes, Strategy 7 applies.",
  },
  // ── Part 3 · Defensive Warfare ──────────────────────────────────
  {
    key: "strategy_perfect_economy",
    book: "33SW",
    type: "strategy",
    number: 8,
    title: "Pick your battles — the perfect economy strategy",
    summary: "Don't fight everything; fight what matters.",
    fullText:
      "You cannot win every battle. Resources spent on small fights deplete what's available for the decisive ones. Be ruthless about declining the fights that don't change the outcome.",
    triggers: [
      "operator dragged into multiple small conflicts",
      "outrage budget being spent on low-leverage skirmishes",
      "energy depleted before the big move begins",
    ],
    actions: [
      "Maintain a 'do not engage' list for noise fights",
      "Save energy for the decisive battle",
      "Walk away from arguments that don't change outcomes",
      "Audit weekly: was each battle worth the cost?",
    ],
    relatedKeys: ["law_36", "law_23", "strategy_wait"],
    applicabilityPrompt:
      "Is the operator being drawn into small fights that drain energy from the decisive one? If yes, Strategy 8 applies.",
  },
  {
    key: "strategy_counterattack",
    book: "33SW",
    type: "strategy",
    number: 9,
    title: "Turn the tables — the counterattack strategy",
    summary: "Let them strike first; absorb; then strike where they're exposed.",
    fullText:
      "The aggressor over-commits. Wait, absorb the first blow, then counter at the moment they have over-extended. Reactive force can be more decisive than initiating force.",
    triggers: [
      "person has just attacked or violated boundary",
      "their move was over-committed and over-visible",
      "counter-response is more decisive than escalation",
    ],
    actions: [
      "Absorb the first strike without immediate response",
      "Identify the angle they left exposed in over-committing",
      "Counter with proportional, visible response",
      "Don't escalate beyond the proportional return",
    ],
    relatedKeys: ["law_15", "law_44", "strategy_wait"],
    applicabilityPrompt:
      "Has someone just struck the operator from an over-committed position? If yes, Strategy 9 applies — wait, then counter.",
  },
  {
    key: "strategy_deterrence",
    book: "33SW",
    type: "strategy",
    number: 10,
    title: "Create a threatening presence — the deterrence strategies",
    summary: "Visible capability deters attack.",
    fullText:
      "The strongest deterrent is the visible ability to retaliate. You don't have to use it — the credible threat changes behavior. Cultivate a reputation that makes attack unattractive.",
    triggers: [
      "low-status detractors testing operator's response",
      "competitive context where soft posture invites probing",
      "reputation gaps inviting opportunistic moves",
    ],
    actions: [
      "Demonstrate capability decisively once when tested",
      "Let the demonstration carry forward as deterrent",
      "Don't bluff — only signal capability you actually have",
      "Save the use for the rare necessary moment",
    ],
    relatedKeys: ["law_5", "law_15", "strategy_counterattack"],
    applicabilityPrompt:
      "Are detractors probing operator's posture because there's no visible deterrent? If yes, Strategy 10 applies.",
  },
  {
    key: "strategy_exchange",
    book: "33SW",
    type: "strategy",
    number: 11,
    title: "Trade space for time — the non-engagement strategies",
    summary: "Give up ground to gain time. Time defeats over-commitment.",
    fullText:
      "When you cannot win immediately, retreat strategically. Give up land you'll reclaim later. Time spent in tactical withdrawal preserves the force for the decisive moment.",
    triggers: [
      "operator pressured to engage from a weaker position",
      "winnable opportunity exists later if survival is preserved now",
      "ego is the only reason to fight today",
    ],
    actions: [
      "Yield the contested ground without yielding the war",
      "Use the time to rebuild leverage",
      "Don't celebrate the surrender; just shift the battlefield",
      "Re-engage only when conditions favor you",
    ],
    relatedKeys: ["law_22", "law_35", "strategy_withdraw"],
    applicabilityPrompt:
      "Is the operator pressured to fight today from a weaker position when waiting compounds? If yes, Strategy 11 applies.",
  },
  // ── Part 4 · Offensive Warfare ──────────────────────────────────
  {
    key: "strategy_grand_strategy",
    book: "33SW",
    type: "strategy",
    number: 12,
    title: "Lose battles but win the war — the grand strategy",
    summary: "Optimize for the war, not the round.",
    fullText:
      "Tactical losses can serve strategic wins. Don't confuse winning a meeting with winning the role. Keep the long-arc objective in view; spend wins where they matter.",
    triggers: [
      "operator obsessed with winning each round at the cost of the arc",
      "tactical wins making the war harder",
      "losing sight of the actual goal in the heat of conflict",
    ],
    actions: [
      "Define the war in writing; revisit weekly",
      "Audit which battles served the war and which were ego",
      "Concede gracefully where it advances the larger play",
      "Let the long arc shape the daily move",
    ],
    relatedKeys: ["law_29", "law_47", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator winning rounds but losing the long arc? If yes, Strategy 12 applies.",
  },
  {
    key: "strategy_intelligence",
    book: "33SW",
    type: "strategy",
    number: 13,
    title: "Know your enemy — the intelligence strategy",
    summary: "Spy first; act second.",
    fullText:
      "Most failed offensives launch on assumptions. Real intelligence — observing what they do, not what they say — separates winners from confident losers. Profile before you press.",
    triggers: [
      "operator about to confront someone whose patterns are unread",
      "high-stakes negotiation without recon",
      "decision riding on understanding their motive",
    ],
    actions: [
      "Map their pattern across the last 6 months",
      "Talk to people who've worked with them before",
      "Note what they consistently avoid",
      "Don't move until you can predict their response",
    ],
    relatedKeys: ["law_14", "law_19", "strategy_recon"],
    applicabilityPrompt:
      "Is the operator about to press a move without adequate intelligence on the counterparty? If yes, Strategy 13 applies.",
  },
  {
    key: "strategy_lightning",
    book: "33SW",
    type: "strategy",
    number: 14,
    title: "Overwhelm resistance with speed and suddenness — the blitzkrieg strategy",
    summary: "Move before they can respond.",
    fullText:
      "Speed plus surprise plus mass at one point breaks resistance. Don't telegraph; don't hesitate; commit fully when the moment arrives. The opponent who saw it coming is already too late.",
    triggers: [
      "decisive opportunity with narrow window",
      "competitive context where the slower party loses by default",
      "operator's preparation complete but committing is the gap",
    ],
    actions: [
      "Compress the decision-to-execution gap to hours, not weeks",
      "Reserve resources for one decisive concentration",
      "Don't telegraph; don't pre-announce",
      "Move at full commitment once the moment is right",
    ],
    relatedKeys: ["law_28", "law_15", "strategy_perfect_economy"],
    applicabilityPrompt:
      "Is there a decisive narrow-window opportunity where speed of execution is the constraint? If yes, Strategy 14 applies.",
  },
  {
    key: "strategy_control_dynamic",
    book: "33SW",
    type: "strategy",
    number: 15,
    title: "Control the dynamic — the forcing strategy",
    summary: "Set the tempo. Make them react to you.",
    fullText:
      "The party that sets the tempo controls the engagement. Don't let them define the field, timing, or terms. Force them onto your ground; make every move a reaction to you.",
    triggers: [
      "operator reacting to counterparty's tempo and terms",
      "engagement shaped by their constraints not yours",
      "constant defensive footing",
    ],
    actions: [
      "Propose terms first; don't react to theirs",
      "Set the meeting time, format, and agenda",
      "Choose the field of battle deliberately",
      "Make your move; they respond — not the reverse",
    ],
    relatedKeys: ["law_8", "law_17", "strategy_engage"],
    applicabilityPrompt:
      "Is the operator perpetually reacting to the counterparty's tempo? If yes, Strategy 15 applies.",
  },
  {
    key: "strategy_center_of_gravity",
    book: "33SW",
    type: "strategy",
    number: 16,
    title: "Hit them where it hurts — the center-of-gravity strategy",
    summary: "Find the load-bearing pillar; collapse it.",
    fullText:
      "Every adversary has a center of gravity — the one thing that, if removed, causes the rest to collapse. Find it. Apply force there rather than spreading attacks across the periphery.",
    triggers: [
      "operator spreading effort across multiple weak points",
      "competitor whose architecture depends on a single pillar",
      "negotiation where one concession unlocks everything",
    ],
    actions: [
      "Identify the load-bearing pillar of their position",
      "Concentrate effort there, not on peripheral skirmishes",
      "Don't get distracted by smaller wins along the way",
      "Once it collapses, the rest follows",
    ],
    relatedKeys: ["law_33", "law_23", "strategy_lightning"],
    applicabilityPrompt:
      "Is operator spreading force across peripheral points when one center-of-gravity hit would collapse the structure? If yes, Strategy 16 applies.",
  },
  {
    key: "strategy_divide_conquer",
    book: "33SW",
    type: "strategy",
    number: 17,
    title: "Defeat them in detail — the divide-and-conquer strategy",
    summary: "Break a strong whole into manageable parts.",
    fullText:
      "You cannot defeat a strong unified opposition head-on. Divide them: isolate sub-groups, exploit internal friction, defeat them one piece at a time. Unity is the strength to dissolve first.",
    triggers: [
      "unified opposition too strong for direct confrontation",
      "factions inside the opposition already misaligned",
      "exploitable internal friction visible",
    ],
    actions: [
      "Identify the natural fault lines within the opposition",
      "Don't try to defeat them as a bloc",
      "Engage one faction at a time on its specific concerns",
      "Use their internal friction; don't manufacture deceit",
    ],
    relatedKeys: ["law_42", "strategy_recon", "law_3"],
    applicabilityPrompt:
      "Is the operator facing unified opposition that could be divided into manageable parts? If yes, Strategy 17 applies.",
  },
  {
    key: "strategy_envelopment",
    book: "33SW",
    type: "strategy",
    number: 18,
    title: "Expose and attack your opponent's soft flank — the envelopment strategy",
    summary: "Don't hit the wall. Go around it.",
    fullText:
      "The frontal approach meets prepared defense. The envelopment finds the soft side, the flank, the angle they haven't fortified. Cost less. Decide more.",
    triggers: [
      "frontal approach being met with prepared resistance",
      "operator stuck head-down against a fortified position",
      "lateral angle visible but underused",
    ],
    actions: [
      "Stop the frontal push; map the flanks",
      "Identify the unfortified angle",
      "Move laterally before pressing forward",
      "Win by changing the angle, not by escalating the force",
    ],
    relatedKeys: ["law_31", "strategy_center_of_gravity", "strategy_lightning"],
    applicabilityPrompt:
      "Is the operator stuck pushing frontally against a prepared defense when a flank angle exists? If yes, Strategy 18 applies.",
  },
  {
    key: "strategy_annihilation",
    book: "33SW",
    type: "strategy",
    number: 19,
    title: "Maneuver them into weakness — the annihilation strategy",
    summary: "Drive them to terrain where they cannot fight effectively.",
    fullText:
      "Make them fight on ground that suits you. Lure them into terrain where their strengths don't apply. The battle is won before it's joined — by where, not just how.",
    triggers: [
      "operator able to choose the field of engagement",
      "opponent's strength domain-specific and exploitable",
      "off-domain terrain available where they're vulnerable",
    ],
    actions: [
      "Pick the field where their strengths don't operate",
      "Move slowly so they follow; commit when they're displaced",
      "Use language, format, or platform that disadvantages them",
      "Don't fight them where they're strongest",
    ],
    relatedKeys: ["strategy_envelopment", "law_19", "strategy_center_of_gravity"],
    applicabilityPrompt:
      "Can the operator choose the field of engagement to neutralize the opponent's strengths? If yes, Strategy 19 applies.",
  },
  // ── Part 5 · Unconventional (Dirty) War ─────────────────────────
  {
    key: "strategy_unhinge",
    book: "33SW",
    type: "strategy",
    number: 20,
    title: "Win through their minds — the communication strategy",
    summary: "Shape the perception; the action follows.",
    fullText:
      "The battle is half perception. Shape what they see, hear, and infer; the action you want follows naturally from the perception you've built. Communication is a weapon.",
    triggers: [
      "operator's actual position misread by the audience",
      "perception gap creating unnecessary friction",
      "narrative being shaped by someone other than operator",
    ],
    actions: [
      "Define the narrative explicitly before others do",
      "Speak in vivid, concrete language people can remember",
      "Repeat the core frame across surfaces",
      "Notice and correct misperceptions early",
    ],
    relatedKeys: ["law_32", "law_27", "seducer_charmer"],
    applicabilityPrompt:
      "Is the operator's actual position being misread because someone else is shaping the narrative? If yes, Strategy 20 applies.",
  },
  {
    key: "strategy_inner_front",
    book: "33SW",
    type: "strategy",
    number: 21,
    title: "Destroy from within — the inner-front strategy",
    summary: "Infiltrate; weaken from inside.",
    fullText:
      "External siege costs everything. Internal corrosion costs little. Where direct contest fails, position yourself as a friendly insider, then let alignment quietly shift from within.",
    triggers: [
      "external opposition too strong for direct contest",
      "insider position available without deception",
      "decisions being made inside a room operator isn't yet in",
    ],
    actions: [
      "Get inside the relevant room first",
      "Build trust before attempting any shift",
      "Move alignment gradually, not in one push",
      "Don't burn the cover for a small win",
    ],
    relatedKeys: ["law_14", "strategy_intelligence", "law_24"],
    applicabilityPrompt:
      "Is the operator outside a critical room where decisions are made? If yes, Strategy 21 applies.",
  },
  {
    key: "strategy_passive_aggression",
    book: "33SW",
    type: "strategy",
    number: 22,
    title: "Dominate while seeming to submit — the passive-aggression strategy",
    summary: "Soft surface, hard substance.",
    fullText:
      "Pure resistance invites counter. Apparent compliance lets the move complete unobserved. Operate just below the line of overt opposition while continuing toward your goal.",
    triggers: [
      "direct resistance triggers active counter-response",
      "operator's authority insufficient for open opposition",
      "long-arc objective achievable through quiet persistence",
    ],
    actions: [
      "Agree publicly; act independently",
      "Avoid visible defiance; preserve quiet momentum",
      "Use compliance as the cover for the move",
      "Don't escalate into open defiance unless necessary",
    ],
    relatedKeys: ["law_22", "law_44", "dark_passive_aggressive"],
    applicabilityPrompt:
      "Is direct opposition impossible but the goal still pursuable through soft surface? If yes, Strategy 22 applies — and watch for dark mirror in self.",
  },
  {
    key: "strategy_chain_reaction",
    book: "33SW",
    type: "strategy",
    number: 23,
    title: "Sow uncertainty and panic — the chain-reaction strategy",
    summary: "One small disturbance, fully exploited, becomes their crisis.",
    fullText:
      "Confidence is fragile. A small, well-placed disturbance can cascade through the opposition once it loses orientation. Don't add force; add uncertainty.",
    triggers: [
      "opposition's confidence is the load-bearing wall",
      "operator can introduce one disorienting move at low cost",
      "context where uncertainty propagates quickly",
    ],
    actions: [
      "Introduce one well-placed unexpected move",
      "Let the doubt propagate before adding more pressure",
      "Don't escalate while disorientation is doing the work",
      "Reserve this for moments where the cascade is real",
    ],
    relatedKeys: ["law_17", "law_39", "strategy_lightning"],
    applicabilityPrompt:
      "Is the opposition's confidence brittle enough that one disturbance would cascade? If yes, Strategy 23 applies.",
  },
  {
    key: "strategy_alliance_realpolitik",
    book: "33SW",
    type: "strategy",
    number: 24,
    title: "Negotiate while advancing — the alliance strategy",
    summary: "Coalitions multiply force; choose them coldly.",
    fullText:
      "Solo force has limits. Strategic coalitions multiply reach. Choose allies for the leverage they bring, not for affinity. Maintain the alliance as long as the math works.",
    triggers: [
      "operator's solo capacity insufficient for the move",
      "potential allies with complementary leverage available",
      "coalition would shift the balance",
    ],
    actions: [
      "Identify the 2-3 allies whose interests align with yours",
      "Make the trade explicit; don't rely on goodwill",
      "Honor the alliance as long as the math works",
      "Be ready to graduate to neutrality when it stops paying",
    ],
    relatedKeys: ["law_13", "law_40", "strategy_alliance"],
    applicabilityPrompt:
      "Could a strategic coalition multiply the operator's leverage for the next move? If yes, Strategy 24 applies.",
  },
  {
    key: "strategy_polarity_two",
    book: "33SW",
    type: "strategy",
    number: 25,
    title: "End on a high note — the exit strategy",
    summary: "Leave when the curve is still rising.",
    fullText:
      "Most people exit too late. The greatest reputations end at the peak, leaving impressions and demand intact. Exit while they still want more.",
    triggers: [
      "operator at peak performance in a role with declining marginal return",
      "diminishing returns visible but not yet measured",
      "next chapter ready but exit not yet planned",
    ],
    actions: [
      "Define the exit point before you arrive at it",
      "Leave while demand is still rising, not after it peaks",
      "Don't extract one extra round at the cost of the legacy",
      "Make the next chapter visible before the current ends",
    ],
    relatedKeys: ["law_47", "law_25", "strategy_withdraw"],
    applicabilityPrompt:
      "Is the operator at peak in a context where marginal return is starting to decline? If yes, Strategy 25 applies.",
  },
  {
    key: "strategy_holiness",
    book: "33SW",
    type: "strategy",
    number: 26,
    title: "Seem to work for the interests of others — the moral strategy",
    summary: "Cloak self-interest in shared cause.",
    fullText:
      "Naked self-interest invites resistance. The same move framed as service receives cooperation. Don't fake the cause; surface the alignment between your move and their interest.",
    triggers: [
      "operator's move read as purely self-serving",
      "actual alignment exists with broader interest but isn't visible",
      "audience reading transactional framing as cynical",
    ],
    actions: [
      "Surface the genuine third-party benefit in your framing",
      "Avoid claiming pure altruism (people see through it)",
      "Make the alignment math transparent",
      "Don't manufacture a cause that isn't real",
    ],
    relatedKeys: ["law_27", "law_43", "seducer_charismatic"],
    applicabilityPrompt:
      "Is the operator's move actually aligned with broader interest but framed transactionally? If yes, Strategy 26 applies.",
  },
  {
    key: "strategy_void",
    book: "33SW",
    type: "strategy",
    number: 27,
    title: "Make small things big — the strategy of escalation",
    summary: "Force them to commit at a level you set.",
    fullText:
      "Small provocations, if responded to disproportionately, force the opposition to overcommit at a level they can't sustain. Choose carefully — only use when the escalation cost is yours to absorb.",
    triggers: [
      "opposition probing with small provocations",
      "operator able to absorb escalation cost the opposition can't",
      "decisive issue that needs forcing function",
    ],
    actions: [
      "Choose one small provocation worth escalating",
      "Make the escalation visible and disproportionate",
      "Force them to either over-commit or back down",
      "Don't use this when you can't afford the response",
    ],
    relatedKeys: ["law_15", "strategy_chain_reaction", "strategy_lightning"],
    applicabilityPrompt:
      "Is opposition probing with low-cost provocations and operator can absorb escalation they can't? If yes, Strategy 27 applies.",
  },
  {
    key: "strategy_fait_accompli",
    book: "33SW",
    type: "strategy",
    number: 28,
    title: "Take small bites — the fait-accompli strategy",
    summary: "Small irreversible moves that reshape the landscape.",
    fullText:
      "A series of small moves, each individually too minor to fight, ends in a transformed landscape. Reform invisibly; reshape one increment at a time.",
    triggers: [
      "large change blocked by political resistance",
      "smaller increments each defensible individually",
      "long-arc reshaping more durable than big-bang reform",
    ],
    actions: [
      "Break the change into increments small enough to slip through",
      "Make each step quietly irreversible",
      "Sequence so the cumulative reshape compounds",
      "Don't reveal the long-arc plan until it's structurally complete",
    ],
    relatedKeys: ["law_45", "law_3", "mastery_apprenticeship"],
    applicabilityPrompt:
      "Is a large change blocked by political resistance that small irreversible steps could accomplish? If yes, Strategy 28 applies.",
  },
  {
    key: "strategy_diplomatic_war",
    book: "33SW",
    type: "strategy",
    number: 29,
    title: "Penetrate their minds — the communication strategy two",
    summary: "Speak to where they actually are, not where you wish they were.",
    fullText:
      "Persuasion that ignores the audience's emotional reality fails. Meet them in the state they're in; build the bridge from there. Otherwise you're broadcasting, not connecting.",
    triggers: [
      "operator's message landing flat or misread",
      "audience's emotional state ignored in the framing",
      "rapport gap before any persuasion can begin",
    ],
    actions: [
      "Acknowledge their current frame before introducing yours",
      "Find one shared starting point",
      "Build the argument from where they are, not where you stand",
      "Don't assume rationality; assume meaning",
    ],
    relatedKeys: ["law_43", "law_33", "seducer_charmer"],
    applicabilityPrompt:
      "Is the operator's persuasion landing flat because the audience's frame is ignored? If yes, Strategy 29 applies.",
  },
  {
    key: "strategy_attack_self_destructive",
    book: "33SW",
    type: "strategy",
    number: 30,
    title: "Destroy from within — the inner-front extension",
    summary: "When the opposition is destroying itself, do less and let it.",
    fullText:
      "Some opposition collapses through its own dynamics. Adding pressure interrupts the collapse. Identify the self-destructive momentum; step back; let it complete.",
    triggers: [
      "opposition showing self-destructive pattern",
      "operator's intervention would interrupt their collapse",
      "doing less produces a better outcome than doing more",
    ],
    actions: [
      "Step back; observe; don't intervene reflexively",
      "Let internal dynamics complete their work",
      "Resist the urge to take credit for the collapse",
      "Re-engage only when the dust settles",
    ],
    relatedKeys: ["law_36", "law_22", "strategy_wait"],
    applicabilityPrompt:
      "Is the opposition collapsing through its own dynamics where doing less is better than doing more? If yes, Strategy 30 applies.",
  },
  {
    key: "strategy_disinformation",
    book: "33SW",
    type: "strategy",
    number: 31,
    title: "Strike at the center of the spirit — the moral attack",
    summary: "Undermine the legitimacy, not just the position.",
    fullText:
      "Opposition with strong moral certainty is hardest to defeat by force. Question the legitimacy; surface the contradictions; weaken the spirit that holds them up. Force becomes less necessary.",
    triggers: [
      "opposition's strength is moral certainty",
      "legitimate contradictions exist in their position",
      "force-based contest would be expensive and inconclusive",
    ],
    actions: [
      "Surface the legitimate contradictions calmly",
      "Don't manufacture flaws; reveal the real ones",
      "Let the legitimacy gap do the work over time",
      "Stay above the moral high ground tactics yourself",
    ],
    relatedKeys: ["law_44", "law_9", "strategy_inner_front"],
    applicabilityPrompt:
      "Is the opposition's strength moral certainty, with legitimate contradictions available to surface? If yes, Strategy 31 applies.",
  },
  {
    key: "strategy_panic",
    book: "33SW",
    type: "strategy",
    number: 32,
    title: "Choose your battles carefully — the all-or-nothing principle",
    summary: "When you fight, commit. When you don't, stay clear.",
    fullText:
      "Half-commitment costs nearly the same as full commitment with fraction of the return. Either fight fully or stay completely clear. The middle ground burns resources without changing outcomes.",
    triggers: [
      "operator engaged at half-commitment in multiple fronts",
      "resources spread thin across battles that need full commitment to win",
      "fights happening 'just enough' to lose them slowly",
    ],
    actions: [
      "Pick the battles you'll commit to fully",
      "Withdraw completely from the others",
      "Don't fight at 30% effort and complain about losing",
      "Match commitment level to actual decisiveness of the battle",
    ],
    relatedKeys: ["law_23", "law_28", "strategy_perfect_economy"],
    applicabilityPrompt:
      "Is the operator engaged at half-commitment in battles that need full commitment to win? If yes, Strategy 32 applies.",
  },
  {
    key: "strategy_uncertainty",
    book: "33SW",
    type: "strategy",
    number: 33,
    title: "Sow doubt — the strategy of uncertainty",
    summary: "Be unreadable; the adversary tires of guessing.",
    fullText:
      "An adversary who can't predict you can't plan against you. Vary your patterns; reveal selectively; let them spend energy trying to read what you'll do next. They tire before you do.",
    triggers: [
      "adversary has read operator's pattern",
      "predictability creating exploitable openings",
      "operator's transparency benefiting the wrong party",
    ],
    actions: [
      "Vary timing, response patterns, and visibility",
      "Reveal selectively; conceal selectively",
      "Don't telegraph the next move",
      "Make pattern-reading exhausting for them",
    ],
    relatedKeys: ["law_17", "law_48", "strategy_intelligence"],
    applicabilityPrompt:
      "Has the operator's pattern been read by the adversary in a way creating exploitable openings? If yes, Strategy 33 applies.",
  },

  // ── Legacy meta-strategies kept from 2026-05-27 corpus for back-compat ──
  // The Sunday digest cron + GreeneLawSidebar still reference these
  // higher-order tactical primitives. They overlap with numbered
  // strategies above but are kept as their own keys so existing
  // BrainMemory rows don't orphan.
  {
    key: "strategy_engage",
    book: "33SW",
    type: "strategy",
    title: "Engage",
    summary: "Active investment + frequent contact.",
    fullText:
      "Engage strategy reserves serious investment in this relationship. Cadence is short; effort compounds.",
    triggers: [
      "high-trust + high-value relationship",
      "short-cadence rhythm appropriate",
      "operator capacity to sustain the investment",
    ],
    actions: [
      "Commit to weekly meaningful touchpoint",
      "Surface investment without inflating it",
      "Track for compounding signals",
      "Re-evaluate quarterly",
    ],
    relatedKeys: ["strategy_alliance", "law_43", "strategy_command"],
    applicabilityPrompt:
      "High-trust + high-value relationship · short cadence is appropriate.",
  },
  {
    key: "strategy_defend",
    book: "33SW",
    type: "strategy",
    title: "Defend",
    summary: "Maintain contact but preserve resources.",
    fullText:
      "Defensive strategy maintains the relationship at minimum-viable cadence without further investment. Energy goes elsewhere.",
    triggers: [
      "operator must preserve resources for higher-leverage relationships",
      "maintain-only mode appropriate",
      "no clear compounding signal yet",
    ],
    actions: [
      "Hold cadence at minimum-viable rate",
      "Don't expand investment",
      "Be polite and reliable; don't be intimate",
      "Re-evaluate if dynamics shift",
    ],
    relatedKeys: ["strategy_wait", "law_5"],
    applicabilityPrompt:
      "Operator must preserve resources for higher-leverage relationships · maintain only.",
  },
  {
    key: "strategy_withdraw",
    book: "33SW",
    type: "strategy",
    title: "Withdraw",
    summary: "Reduce contact deliberately; use absence as signal.",
    fullText:
      "Withdraw strategy uses absence as a power signal · Law 16 applies. Cadence extends deliberately.",
    triggers: [
      "operator over-invested",
      "power balance needs reset",
      "scarcity will reshape the dynamic",
    ],
    actions: [
      "Extend cadence by 2-3x",
      "Don't explain the withdrawal",
      "Let the absence speak",
      "Re-engage on your terms when ready",
    ],
    relatedKeys: ["law_16", "law_8", "strategy_exchange"],
    applicabilityPrompt:
      "Operator over-invested + needs to reset power balance · extend cadence.",
  },
  {
    key: "strategy_counter",
    book: "33SW",
    type: "strategy",
    title: "Counter-attack",
    summary: "Active push-back after a violation.",
    fullText:
      "Counter-attack strategy responds to a specific offense with proportional + visible response. Mirrors Strategy 9.",
    triggers: [
      "specific recent violation",
      "proportional response cost-effective",
      "calibrated counter would reset the dynamic",
    ],
    actions: [
      "Respond with proportional, visible counter",
      "Don't escalate beyond the offense",
      "Make the response read clearly",
      "Return to baseline cadence after the counter lands",
    ],
    relatedKeys: ["strategy_counterattack", "law_44", "law_15"],
    applicabilityPrompt:
      "This person has recently violated trust or boundary · response is calibrated counter.",
  },
  {
    key: "strategy_wait",
    book: "33SW",
    type: "strategy",
    title: "Wait",
    summary: "Take no action; observe.",
    fullText:
      "Wait strategy takes no action and observes. Time reveals the situation.",
    triggers: [
      "situation unclear",
      "more information needed",
      "patience compounds",
    ],
    actions: [
      "Take no action this week",
      "Document what you observe",
      "Re-evaluate at a set future date",
      "Resist the urge to fill silence",
    ],
    relatedKeys: ["law_35", "strategy_intelligence"],
    applicabilityPrompt: "Situation is unclear · gather information before acting.",
  },
  {
    key: "strategy_alliance",
    book: "33SW",
    type: "strategy",
    title: "Alliance",
    summary: "Formal pact + mutual support.",
    fullText:
      "Alliance strategy creates an explicit mutual-aid arrangement. Both parties know they can call on each other.",
    triggers: [
      "compatible long-term interests",
      "both parties value the arrangement",
      "explicit framing improves the dynamic",
    ],
    actions: [
      "Make the alliance terms explicit",
      "Define what each side will and won't deliver",
      "Honor the alliance proactively",
      "Re-evaluate annually",
    ],
    relatedKeys: ["strategy_alliance_realpolitik", "law_13", "law_40"],
    applicabilityPrompt:
      "This person is positioned for explicit mutual-aid relationship · formalize.",
  },
  {
    key: "strategy_recon",
    book: "33SW",
    type: "strategy",
    title: "Reconnaissance",
    summary: "Gather intelligence before deciding strategy.",
    fullText:
      "Reconnaissance strategy probes for information without committing. Asks indirect questions, observes patterns.",
    triggers: [
      "relationship is new",
      "intel-gathering is warranted",
      "commitment cost high",
    ],
    actions: [
      "Ask indirect questions in low-stakes contexts",
      "Talk to others who've worked with them",
      "Watch what they do, not what they say",
      "Don't commit until you can predict",
    ],
    relatedKeys: ["strategy_intelligence", "law_14", "law_19"],
    applicabilityPrompt:
      "Relationship is new + intel-gathering is warranted before strategy lock-in.",
  },
  {
    key: "strategy_severance",
    book: "33SW",
    type: "strategy",
    title: "Severance",
    summary: "End the relationship; clean break.",
    fullText:
      "Severance strategy ends the relationship deliberately. No lingering · clean break.",
    triggers: [
      "relationship has reached terminal state",
      "continued contact compounds the damage",
      "operator's wellbeing requires it",
    ],
    actions: [
      "Communicate the end clearly and briefly",
      "Cut off all channels of contact",
      "Don't litigate the past; just end the present",
      "Move on without revisiting",
    ],
    relatedKeys: ["law_15", "law_42", "fearless_4"],
    applicabilityPrompt:
      "Relationship has reached terminal state · execute formal severance.",
  },
];
