/**
 * 2026-05-28 · Power Atlas · The Art of Seduction · seducer + victim types.
 *
 * Greene's seduction taxonomy. 9 seducer archetypes (who you might be
 * facing) + 9 victim archetypes (which susceptibility this person has)
 * + 4 phase markers (where in the seduction arc the relationship is).
 *
 * Source: Robert Greene, "The Art of Seduction" (2001).
 */

import type { GreeneEntry } from "./schema";

export const SEDUCTION_ENTRIES: GreeneEntry[] = [
  // ── 9 Seducer types ────────────────────────────────────────────
  {
    key: "seducer_siren",
    book: "Seduction",
    type: "seducer_type",
    title: "Siren",
    summary: "Magnetic sexual presence + theater of imperfection.",
    fullText:
      "The Siren projects a sexual presence that promises pleasure and adventure. Her power lies in being slightly inaccessible and dramatic. The Siren operates by creating a public spectacle around herself; you feel chosen by being noticed.",
    triggers: [
      "person commands attention through dramatic presence",
      "sexual magnetism part of the operating identity",
      "public spectacle pattern around their persona",
    ],
    actions: [
      "Recognize the pull without being captured by it",
      "Keep your own center of gravity",
      "Engage on substance, not the spectacle",
      "Don't compete with the theater",
    ],
    relatedKeys: ["law_32", "law_25", "seducer_star"],
    applicabilityPrompt:
      "Does this person command attention through dramatic presence + sexual magnetism? Tag as Siren.",
  },
  {
    key: "seducer_rake",
    book: "Seduction",
    type: "seducer_type",
    title: "Rake",
    summary: "Promises uncompromising desire + extravagant attention.",
    fullText:
      "The Rake worships at the altar of romance. They focus all attention and desire on the target, making them feel uniquely chosen. The intensity is real in the moment; whether it lasts is another question.",
    triggers: [
      "person specializes in dedicated romantic pursuit",
      "verbal worship and extravagant attention pattern",
      "intensity calibrated to feel uniquely-chosen",
    ],
    actions: [
      "Enjoy the attention without confusing intensity for depth",
      "Watch the consistency over time, not the peak moments",
      "Don't make decisions during the worship phase",
      "Calibrate expectations to the pattern, not the speech",
    ],
    relatedKeys: ["law_32", "law_27", "seducer_charmer"],
    applicabilityPrompt:
      "Does this person specialize in dedicated romantic pursuit + verbal worship? Tag as Rake.",
  },
  {
    key: "seducer_ideal_lover",
    book: "Seduction",
    type: "seducer_type",
    title: "Ideal Lover",
    summary: "Becomes whatever you most need.",
    fullText:
      "The Ideal Lover senses what the target is missing and becomes that. They are chameleons of unmet need. The danger isn't insincerity — it's that the version you fell for may not exist when the need shifts.",
    triggers: [
      "person mirrors back operator's unstated needs perfectly",
      "perfect fit that feels almost too good",
      "absence of friction or independent identity",
    ],
    actions: [
      "Notice what they reveal about themselves independent of you",
      "Test for independent identity by introducing friction",
      "Don't commit before you've seen them outside the mirror role",
      "Look for the moments their fit slips",
    ],
    relatedKeys: ["law_33", "seducer_charmer", "dark_manipulator"],
    applicabilityPrompt:
      "Does this person mirror back the operator's unstated needs? Tag as Ideal Lover.",
  },
  {
    key: "seducer_dandy",
    book: "Seduction",
    type: "seducer_type",
    title: "Dandy",
    summary: "Fluid, ambiguous, refuses to commit to a single type.",
    fullText:
      "The Dandy refuses to be pinned down. They display traits across gender, role, and category, signaling unattainable freedom. The seduction is the suggestion that proximity to them grants the same freedom.",
    triggers: [
      "person resists being categorized",
      "fluid identity-display across contexts",
      "magnetism rooted in apparent unattainability",
    ],
    actions: [
      "Accept the unfixed identity as the actual identity",
      "Don't try to pin them into one frame",
      "Engage on what's stable underneath the display",
      "Keep your own grounded center if drawn into their orbit",
    ],
    relatedKeys: ["law_25", "law_48", "seducer_star"],
    applicabilityPrompt:
      "Does this person resist being categorized + fluidly shift identity-display? Tag as Dandy.",
  },
  {
    key: "seducer_natural",
    book: "Seduction",
    type: "seducer_type",
    title: "Natural",
    summary: "Disarming, unstudied, childlike.",
    fullText:
      "The Natural seems incapable of artifice. Their power comes from triggering protective instinct in others. The unstudied quality lowers others' guard immediately.",
    triggers: [
      "person disarms with apparent un-self-conscious naturalness",
      "operator's guard drops without conscious decision",
      "protective instinct activated by their presence",
    ],
    actions: [
      "Notice when your guard drops without reason",
      "Engage normally rather than over-protectively",
      "Don't confuse apparent simplicity for safety",
      "Calibrate based on patterns, not just charm",
    ],
    relatedKeys: ["law_21", "law_46", "seducer_charmer"],
    applicabilityPrompt:
      "Does this person disarm with apparent un-self-conscious naturalness? Tag as Natural.",
  },
  {
    key: "seducer_coquette",
    book: "Seduction",
    type: "seducer_type",
    title: "Coquette",
    summary: "Hot/cold, advance/retreat tempo.",
    fullText:
      "The Coquette controls through alternating heat and cold — granting attention then withdrawing it. The intermittent reinforcement keeps the target chasing the next warm moment.",
    triggers: [
      "person operates on intermittent reinforcement cycles",
      "warm phases followed by sudden cold without explanation",
      "operator chasing the next warm moment",
    ],
    actions: [
      "Don't reward the cold phase by escalating pursuit",
      "Maintain steady cadence regardless of their tempo",
      "Notice the pattern + name it to yourself",
      "Disengage gracefully if the pattern is the relationship",
    ],
    relatedKeys: ["law_8", "law_16", "strategy_withdraw"],
    applicabilityPrompt:
      "Does this person operate on intermittent reinforcement / hot-cold cycles? Tag as Coquette.",
  },
  {
    key: "seducer_charmer",
    book: "Seduction",
    type: "seducer_type",
    title: "Charmer",
    summary: "Soothes, flatters, makes you feel uniquely seen.",
    fullText:
      "The Charmer focuses entirely on you — your concerns, your ambitions, your worries. They draw out and reflect back. The seduction is the experience of being deeply listened-to in a world that mostly doesn't listen.",
    triggers: [
      "person makes operator feel uniquely listened-to",
      "their attention quality exceeds peer-group baseline",
      "operator finds self over-sharing without intending to",
    ],
    actions: [
      "Enjoy being listened-to without confusing it for alignment",
      "Notice what they reveal about themselves (often little)",
      "Don't over-share strategic info in the warm glow",
      "Calibrate trust on independent evidence",
    ],
    relatedKeys: ["law_12", "law_33", "seducer_ideal_lover"],
    applicabilityPrompt:
      "Does this person make the operator feel uniquely listened-to + understood? Tag as Charmer.",
  },
  {
    key: "seducer_charismatic",
    book: "Seduction",
    type: "seducer_type",
    title: "Charismatic",
    summary: "Conveys an inner conviction or mission others want to follow.",
    fullText:
      "The Charismatic radiates conviction about a higher purpose. People follow them because they make the followers' lives feel meaningful. The mission is real even if some of the trappings are theater.",
    triggers: [
      "person operates from visible mission + conviction",
      "their presence makes others' lives feel more meaningful",
      "movement-style traction forming around them",
    ],
    actions: [
      "Evaluate the mission on its merits, separate from the magnetism",
      "Don't join the mission unless you'd join it without the magnetism",
      "Cultivate your own conviction; don't borrow theirs",
      "Maintain independent judgment in their orbit",
    ],
    relatedKeys: ["law_27", "law_32", "strategy_morale"],
    applicabilityPrompt:
      "Does this person operate from visible mission + conviction? Tag as Charismatic.",
  },
  {
    key: "seducer_star",
    book: "Seduction",
    type: "seducer_type",
    title: "Star",
    summary: "Ethereal, slightly removed, projects a screen for projection.",
    fullText:
      "The Star is luminous but slightly distant — close enough to be magnetic, far enough to remain an object of projection. Like a film star, they let others fill in the gaps; the projection is half the appeal.",
    triggers: [
      "person maintains glamour + slight distance",
      "operator filling in attributes that haven't been demonstrated",
      "magnetism heightened by their unattainability",
    ],
    actions: [
      "Recognize what you're projecting vs what they've shown",
      "Engage with the demonstrated person, not the projected one",
      "Watch out for over-investment in the projection",
      "Test the gap between projection and reality before committing",
    ],
    relatedKeys: ["law_25", "law_6", "law_37"],
    applicabilityPrompt:
      "Does this person maintain glamour + slight distance that invites projection? Tag as Star.",
  },
  // ── 9 Victim types ────────────────────────────────────────────
  {
    key: "victim_reformed_rake",
    book: "Seduction",
    type: "victim_type",
    title: "Reformed Rake/Siren",
    summary: "Buttoned-up exterior hiding nostalgia for the wild self.",
    fullText:
      "The Reformed Rake or Siren presents a respectable, settled exterior. Underneath sits the suppressed memory of the wild self. Someone offering a controlled return to that energy holds disproportionate sway.",
    triggers: [
      "operator's current persona is the reformed version of an earlier wilder self",
      "nostalgia for the earlier self surfacing under stress",
      "someone offering safe access to the suppressed energy",
    ],
    actions: [
      "Notice the pull and name it",
      "Don't confuse nostalgia with present desire",
      "Honor the integration: bring chosen aspects of the wild self into the current life",
      "Be wary of people offering 'permission' that wasn't earned",
    ],
    relatedKeys: ["law_25", "seducer_rake", "law_33"],
    applicabilityPrompt:
      "Is operator a reformed wilder-self type vulnerable to someone offering controlled return? If yes, tag victim_reformed_rake.",
  },
  {
    key: "victim_disappointed_dreamer",
    book: "Seduction",
    type: "victim_type",
    title: "Disappointed Dreamer",
    summary: "Carries an unrealized fantasy; needs someone to embody it.",
    fullText:
      "The Disappointed Dreamer carries a specific unrealized fantasy. Anyone who appears to embody it captures attention out of proportion to actual fit. Reality fact-checking is the defense.",
    triggers: [
      "operator carries a specific unrealized fantasy or aspiration",
      "someone appearing to embody it draws disproportionate attention",
      "evaluation suspended in their presence",
    ],
    actions: [
      "Name the fantasy explicitly to yourself",
      "Audit whether they actually embody it or just hint at it",
      "Don't make decisions while the fantasy is active",
      "Keep evaluation engaged",
    ],
    relatedKeys: ["law_32", "seducer_charismatic", "fearless_1"],
    applicabilityPrompt:
      "Does operator carry an unrealized fantasy that a seducer could appear to embody? If yes, tag victim_disappointed_dreamer.",
  },
  {
    key: "victim_pampered_royal",
    book: "Seduction",
    type: "victim_type",
    title: "Pampered Royal",
    summary: "Used to comfort; rebels privately against the cage.",
    fullText:
      "The Pampered Royal lives a comfortable, cushioned life and resents it secretly. Someone offering rough edge, danger, or escape from comfort holds outsize appeal.",
    triggers: [
      "operator's life is well-cushioned with limited friction",
      "private resentment of comfort surfacing",
      "someone offering rough edge or danger draws attention",
    ],
    actions: [
      "Bring chosen edge into the current life — don't outsource it to someone else",
      "Audit whether 'escape' offered is escape from your own role",
      "Build the spice yourself; don't let someone else be your danger",
    ],
    relatedKeys: ["fearless_5", "law_25", "strategy_urgency"],
    applicabilityPrompt:
      "Is operator in a comfortable life with private edge-seeking? If yes, tag victim_pampered_royal.",
  },
  {
    key: "victim_new_prude",
    book: "Seduction",
    type: "victim_type",
    title: "New Prude",
    summary: "Has rejected past indulgence; hides a hunger.",
    fullText:
      "The New Prude has rejected past indulgences and adopted a strict frame. Someone tempting them with a 'safe' return to the old behavior finds disproportionate traction.",
    triggers: [
      "operator has adopted a strict frame against a past pattern",
      "hunger for the old pattern surfacing",
      "tempter offering safe return",
    ],
    actions: [
      "Distinguish lasting commitment from temporary suppression",
      "If the strictness is right, hold; if it's not, evolve consciously",
      "Don't let a tempter's frame override your own choice",
    ],
    relatedKeys: ["law_38", "fearless_4", "seducer_rake"],
    applicabilityPrompt:
      "Has operator adopted strict frame against a past pattern where someone could offer safe return? If yes, tag victim_new_prude.",
  },
  {
    key: "victim_aging_baby",
    book: "Seduction",
    type: "victim_type",
    title: "Aging Baby",
    summary: "Refuses to grow up; wants someone to indulge the childishness.",
    fullText:
      "The Aging Baby resists adulthood. They want someone to indulge the childish part, take care of practicalities, and let them remain young. Indulgers gain easy traction.",
    triggers: [
      "operator avoids adult responsibilities chronically",
      "looking for someone to manage practicalities",
      "childish frame being indulged by current relationships",
    ],
    actions: [
      "Take ownership of the adult responsibilities you're avoiding",
      "Be wary of indulgers — they want you dependent",
      "Grow into the adult version without losing playfulness",
    ],
    relatedKeys: ["fearless_2", "law_11", "mentor_apprentice"],
    applicabilityPrompt:
      "Is operator avoiding adult responsibilities chronically and looking to be indulged? If yes, tag victim_aging_baby.",
  },
  {
    key: "victim_rescuer",
    book: "Seduction",
    type: "victim_type",
    title: "Rescuer",
    summary: "Wired to help; vulnerable to fake distress.",
    fullText:
      "The Rescuer is wired to help. Their identity hangs on being needed. A counterparty performing distress finds traction; the Rescuer's help arrives faster than evaluation.",
    triggers: [
      "operator identity organized around being-helpful",
      "someone presenting performance of need",
      "rescue impulse engaging before evaluation completes",
    ],
    actions: [
      "Engage evaluation before rescue",
      "Audit whether the need is real or performed",
      "Help from chosen position, not reflexive identity",
      "Resist relationships where rescue is the only currency",
    ],
    relatedKeys: ["law_10", "dark_chronic_victim", "dark_manipulator"],
    applicabilityPrompt:
      "Is operator's identity organized around being-helpful in a way that could be exploited? If yes, tag victim_rescuer.",
  },
  {
    key: "victim_roue",
    book: "Seduction",
    type: "victim_type",
    title: "Roué",
    summary: "Has seen it all; only purity catches their interest.",
    fullText:
      "The Roué is jaded — has seen most patterns and lost interest. The seducer who catches them appears genuinely pure, innocent, or unguarded. The Roué's defense is the very thing the right counterparty bypasses.",
    triggers: [
      "operator jaded by repeated patterns in past relationships",
      "someone appearing genuinely pure or innocent draws disproportionate attention",
      "jadedness being the only filter",
    ],
    actions: [
      "Test the genuine purity against actual behavior",
      "Don't outsource trust evaluation to your jaded filter",
      "Engage on substance, not the contrast effect",
    ],
    relatedKeys: ["seducer_natural", "law_48", "strategy_intelligence"],
    applicabilityPrompt:
      "Is operator's jadedness creating a filter that genuine-seeming purity could bypass? If yes, tag victim_roue.",
  },
  {
    key: "victim_idol_worshipper",
    book: "Seduction",
    type: "victim_type",
    title: "Idol Worshipper",
    summary: "Needs someone to revere; projects too much onto the wrong person.",
    fullText:
      "The Idol Worshipper needs someone to look up to. They project mastery, virtue, or genius onto a counterparty who may not actually warrant it. The projection sustains the relationship beyond what the reality supports.",
    triggers: [
      "operator looking for someone to revere",
      "projecting attributes that haven't been demonstrated",
      "relationship sustained by projection rather than evidence",
    ],
    actions: [
      "Audit what you've projected vs what they've shown",
      "Cultivate your own internal authority",
      "Don't let projection make your decisions",
    ],
    relatedKeys: ["seducer_star", "seducer_charismatic", "law_46"],
    applicabilityPrompt:
      "Is operator projecting attributes onto a counterparty that haven't been demonstrated? If yes, tag victim_idol_worshipper.",
  },
  {
    key: "victim_lonely_leader",
    book: "Seduction",
    type: "victim_type",
    title: "Lonely Leader",
    summary: "Power-isolated; vulnerable to someone offering rare equality.",
    fullText:
      "The Lonely Leader's position creates distance. Few people relate as equals. Someone offering authentic peer-to-peer connection without agenda holds outsize appeal — and may have agenda.",
    triggers: [
      "operator's position creates distance from peer-level connection",
      "someone offering rare equality without visible agenda",
      "lonely leader pattern showing in operator's relationships",
    ],
    actions: [
      "Cultivate genuine peer relationships intentionally",
      "Be wary when 'equality' is offered too easily",
      "Test motive over time, not in the warm first meetings",
      "Don't make strategic decisions from loneliness",
    ],
    relatedKeys: ["law_18", "mentor_peer", "seducer_charmer"],
    applicabilityPrompt:
      "Is operator power-isolated and vulnerable to someone offering rare equal connection? If yes, tag victim_lonely_leader.",
  },
];
