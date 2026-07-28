/**
 * Greene corpus · chat-side match phrases · 2026-07-27.
 *
 * WHY THIS FILE EXISTS
 *
 * `greene-message-matcher` scores by literal substring against the
 * operator's message. The corpus's `triggers` arrays are analyst-facing
 * condition sentences ("person.power_balance > +0.4 (operator weaker)")
 * authored for the Sunday digest cron's AI applicability check — prose the
 * cron READS, not text a human ever TYPES. Matching on them could only ever
 * hit by accident, so the documented primary retrieval path never fired.
 *
 * The proof that this is a defect rather than a design choice: the
 * dark-psychology matcher is the same code shape reading a different
 * category, and its entries use short keyword triggers
 * (`["price", "negotiate", "offer", "deal", ...]`). It works. This map is
 * that same proven convention applied to the Greene corpus, kept in a
 * separate module so the per-book files retain sentence-form `triggers`
 * for the cron that genuinely depends on them.
 *
 * AUTHORING RULES
 *   · lowercase — the matcher lowercases the message, not the phrase
 *   · prefer 2+ words; bare common nouns match everything and add noise
 *   · 6-10 per entry — `minScore` defaults to 2, so an entry needs two
 *     independent hits before it fires
 *   · phrase the way the operator actually types, not the way Greene wrote
 *
 * Overlap between entries is FINE and expected. Scores do not split:
 * each entry counts only its own hits, so a shared phrase means both
 * entries can fire and the higher-scoring one still sorts first. The
 * guard in the test caps how MANY entries may share one phrase, which
 * bounds noise without forcing artificial uniqueness.
 *
 * The nine Book V creative strategies carry `matchPhrases` inline on the
 * entry itself (see ./mastery.ts) and are intentionally absent here.
 */

export const GREENE_MATCH_PHRASES: Record<string, string[]> = {
  // ── The 48 Laws of Power ────────────────────────────────────────
  law_1: ["my boss", "outshine", "make him look bad", "smarter than my boss", "showing up my", "upstage", "look better than him"],
  law_2: ["hire my friend", "business with a friend", "work with a friend", "former rival", "old enemy", "trust my friend", "friend wants in"],
  law_3: ["should i tell them", "reveal my plan", "keep it quiet", "tip my hand", "what i'm planning", "announce it", "show my cards"],
  law_4: ["say less", "talk too much", "over explain", "overexplaining", "how much should i say", "long message", "rambling"],
  law_5: ["my reputation", "bad review", "damage control", "what people think of me", "credibility", "my name is on"],
  law_6: ["get noticed", "nobody knows we exist", "more visibility", "stand out", "get eyes on", "attention"],
  law_7: ["do it myself", "should i delegate", "take the credit", "outsource this", "hire someone to", "off my plate"],
  law_8: ["chasing them", "chase the customer", "reach out again", "make them come", "pull them in", "keep following up"],
  law_9: ["convince them", "win the argument", "explain why", "prove my point", "justify myself", "arguing with"],
  law_10: ["toxic", "drains me", "always complaining", "bad energy", "negative person", "constant drama"],
  law_11: ["they need me", "depend on me", "irreplaceable", "leverage over", "indispensable", "only one who can"],
  law_12: ["build trust", "win them over", "good faith", "disarm", "gesture", "gain their trust"],
  law_13: ["ask for a favor", "what's in it for", "why would they", "get them to help", "appeal to", "convince them to"],
  law_14: ["what are they doing", "competitor is doing", "find out what", "gather intel", "scout", "check on the competition"],
  law_15: ["half measure", "let it go", "let them off", "finish it", "settle with", "leave it unfinished"],
  law_16: ["always available", "respond immediately", "go quiet", "too available", "step back", "always on call"],
  law_17: ["predictable", "they expect", "same move every", "keep them guessing", "my pattern"],
  law_18: ["on my own", "by myself", "go it alone", "cut off", "isolated", "lone wolf", "no one to ask"],
  law_19: ["wrong person", "offended", "misread", "who am i dealing with", "pushed back hard", "took it badly"],
  law_20: ["commit to", "pick a side", "exclusive deal", "locked in", "tied down", "sign with"],
  law_21: ["let them think", "underestimate", "play dumb", "lower their guard", "seem naive"],
  law_22: ["back down", "concede", "give in", "surrender", "retreat", "not worth the fight"],
  law_23: ["spread thin", "too many projects", "focus on one", "scattered", "juggling", "spreading myself"],
  law_24: ["office politics", "navigate this", "diplomatic", "read the room", "handle him carefully", "delicate situation"],
  law_25: ["reinvent myself", "new version of me", "who i am", "rebrand", "change my identity", "start fresh"],
  law_26: ["take the blame", "who does it", "distance myself", "deniability", "hands clean", "not my name on"],
  law_27: ["loyal following", "believe in", "build a community", "movement", "true fans", "evangelists"],
  law_28: ["half in", "hesitating", "timid", "go all in", "be bold", "commit fully", "tentative", "playing it safe"],
  law_29: ["what does done look like", "endgame", "long game", "plan it out", "second order", "downstream consequences"],
  law_30: ["how hard i worked", "show the effort", "make it look easy", "effortless", "behind the scenes"],
  law_31: ["give them options", "two choices", "either or", "let them pick", "frame the choice", "which one"],
  law_32: ["what they want to hear", "sell the vision", "the dream", "aspiration", "fantasy"],
  law_33: ["their weakness", "what they care about", "pressure point", "what motivates", "the lever", "soft spot"],
  law_34: ["carry myself", "own the room", "self respect", "act the part", "premium", "charge more"],
  law_35: ["when should i", "right time", "too early", "too late", "wait or act", "bad timing"],
  law_36: ["ignore them", "respond to the hate", "give it attention", "beneath me", "petty", "dignify that"],
  law_37: ["show them", "a demo", "make it visible", "visual proof", "before and after", "spectacle"],
  law_38: ["fit in", "rock the boat", "conform", "unconventional", "everyone does it that way"],
  law_39: ["under their skin", "rattle them", "provoke", "lose their cool", "get emotional", "tilt them"],
  law_40: ["for free", "big discount", "no cost", "hidden cost", "too good to be true", "free trial"],
  law_41: ["my father", "the last owner", "predecessor", "in the shadow of", "compared to him", "took over from"],
  law_42: ["ringleader", "one person is", "the instigator", "source of the problem", "root of it", "who started"],
  law_43: ["force them", "make them do", "mandate", "buy in", "team resistance", "pushing back on the process"],
  law_44: ["give them a taste", "do it back", "same treatment", "mirror", "reflect it back"],
  law_45: ["big change", "overhaul", "resistance to change", "too much at once", "roll it out", "sweeping change"],
  law_46: ["too perfect", "envy", "resent me", "showing off", "humble brag", "flex"],
  law_47: ["keep pushing", "push further", "when to stop", "overreach", "getting greedy", "one more round"],
  law_48: ["stuck in my ways", "rigid", "need to adapt", "stay flexible", "pivot", "change approach"],

  // ── The 33 Strategies of War ────────────────────────────────────
  strategy_polarity: ["what am i fighting", "who is the enemy", "declare war", "rally against", "the villain"],
  strategy_guerrilla_mind: ["worked last time", "same playbook", "how we've always", "old strategy", "stale approach", "fighting the last war"],
  strategy_present_mind: ["losing my cool", "panicking", "everything is on fire", "stay calm", "spiraling", "keep my head"],
  strategy_urgency: ["no urgency", "dragging on", "no deadline", "back against the wall", "comfortable", "burn the boats"],
  strategy_command: ["groupthink", "committee", "too many opinions", "design by committee", "who decides", "everyone agrees"],
  strategy_segment: ["too centralized", "bottleneck on me", "small teams", "autonomous", "everything goes through me"],
  strategy_morale: ["team morale", "motivate the team", "why we do this", "mission", "buy into the vision", "team is flat"],
  strategy_perfect_economy: ["fight everything", "pick my battles", "worth fighting", "let this one go", "spending energy on"],
  strategy_counterattack: ["let them move first", "counter", "wait for them to", "absorb the hit", "react to their move"],
  strategy_deterrence: ["deter", "scare them off", "show strength", "make them think twice", "reputation for"],
  strategy_exchange: ["give up ground", "buy time", "concede space", "stall", "trade time"],
  strategy_grand_strategy: ["lose this one", "bigger picture", "win the war", "long term play", "short term loss"],
  strategy_intelligence: ["research them", "know my enemy", "before i approach", "do my homework", "background on"],
  strategy_lightning: ["move fast", "before they react", "speed", "strike first", "beat them to it", "move quickly"],
  strategy_control_dynamic: ["set the tempo", "control the pace", "make them react", "on my terms", "dictate"],
  strategy_center_of_gravity: ["where it hurts", "their weak point", "load bearing", "the linchpin", "what holds them up"],
  strategy_divide_conquer: ["break it up", "one at a time", "divide", "split them", "piece by piece"],
  strategy_void: ["escalate", "make it bigger", "raise the stakes", "force their hand", "call their bluff"],
  strategy_fait_accompli: ["small bites", "just do it", "ask forgiveness", "already done", "incremental", "before anyone notices"],
  strategy_diplomatic_war: ["they don't get it", "speak their language", "meet them where", "not landing", "talking past"],
  strategy_attack_self_destructive: ["they're imploding", "self destructing", "falling apart on their own", "do nothing", "let them"],
  strategy_disinformation: ["their legitimacy", "moral high ground", "undermine", "credibility attack", "expose them"],
  strategy_panic: ["all or nothing", "half committed", "either commit", "in or out", "fully commit"],
  strategy_uncertainty: ["keep them guessing", "unreadable", "sow doubt", "unpredictable", "don't reveal"],
  strategy_engage: ["invest in this relationship", "more contact", "stay close", "keep in touch", "nurture"],
  strategy_defend: ["maintain the relationship", "keep it steady", "preserve", "hold the line", "not much effort"],
  strategy_withdraw: ["pull back", "reduce contact", "less time with", "distance", "back off from"],
  strategy_counter: ["push back", "call them out", "confront", "they crossed a line", "address it directly"],
  strategy_wait: ["do nothing", "wait and see", "hold off", "observe", "not yet"],
  strategy_alliance: ["partner with", "team up", "joint venture", "alliance", "work together", "mutual"],
  strategy_recon: ["feel them out", "test the waters", "gather more info", "before committing", "scope it out"],
  strategy_severance: ["cut them off", "end the relationship", "fire the client", "clean break", "walk away from"],
  strategy_envelopment: ["head on", "hit a wall", "go around", "back door", "side entrance", "another way in", "frontal assault"],
  strategy_annihilation: ["on my terms", "their home turf", "bad ground", "out of their depth", "where they're weak"],
  strategy_unhinge: ["how it's perceived", "the narrative", "how it lands", "shape the story", "framing", "perception"],
  strategy_inner_front: ["from the inside", "infiltrate", "someone on the inside", "internal", "within their camp"],
  strategy_passive_aggression: ["seem to agree", "appear to go along", "soft surface", "yes but", "quietly resist"],
  strategy_chain_reaction: ["small crack", "one thing snowballs", "exploit the opening", "cascade", "domino"],
  strategy_alliance_realpolitik: ["negotiate while", "coalition", "who else benefits", "line up support", "cold calculation"],
  strategy_polarity_two: ["when to exit", "leave on a high", "get out now", "wind it down", "sell while", "quit while ahead"],
  strategy_holiness: ["for the greater good", "frame it as helping", "shared cause", "everyone benefits", "for the customer"],

  // ── The 50th Law ────────────────────────────────────────────────
  fearless_1: ["kidding myself", "face reality", "be honest with myself", "wishful thinking", "the real situation", "brutal truth"],
  fearless_2: ["depend on them", "own it myself", "self reliant", "in my control", "waiting on someone", "own my fate"],
  fearless_3: ["setback", "went wrong", "turn this around", "silver lining", "make it work for me", "opportunity in"],
  fearless_4: ["stalled", "stagnant", "keep moving", "momentum", "spinning my wheels", "stuck in place"],
  fearless_5: ["walked on", "too nice", "pushover", "stand up for myself", "be more aggressive", "taken advantage of"],
  fearless_6: ["lead by example", "ask the team to", "wouldn't do myself", "front line", "in the trenches"],
  fearless_7: ["out of touch", "on the ground", "what's really happening", "close to the floor", "removed from"],
  fearless_8: ["shortcut", "skip ahead", "fast track", "put in the reps", "trust the process", "rush it"],
  fearless_9: ["not good enough", "self doubt", "out of my league", "can i really", "imposter", "push past"],
  fearless_10: ["running out of time", "how long do i have", "urgency of life", "wasting time", "mortality", "life is short"],

  // ── Mastery · phases + mentorship (Book V lives inline) ─────────
  mastery_apprenticeship: ["new to this", "learning the basics", "beginner", "don't know enough yet", "fundamentals", "over my head"],
  mastery_creative: ["ready to do my own", "original work", "my own approach", "break the rules", "past the basics"],
  mastery_invisible: ["years of doing this", "second nature", "just know", "instinct", "without thinking"],
  mentor_true: ["my mentor", "learn from him", "someone ahead of me", "guidance from", "coach me"],
  mentor_peer: ["peer", "someone at my level", "trade skills", "accountability partner", "mastermind"],
  mentor_anti: ["waste of time with", "generic advice", "not getting anything", "always talking", "no real value"],
  mentor_apprentice: ["teaching him", "training someone", "my apprentice", "bring him up", "developing them"],
  mentor_none: ["just a friend", "not about work", "no real dynamic"],

  // ── The Art of Seduction ────────────────────────────────────────
  seducer_siren: ["magnetic", "presence", "draws people in", "commands attention", "captivating"],
  seducer_rake: ["intense attention", "pursue relentlessly", "all in on them", "obsessive attention", "lays it on thick", "sweeps them off", "relentless pursuit", "over the top attention"],
  seducer_ideal_lover: ["what they need", "become what", "fill the gap", "exactly what they wanted", "mirrors what", "tells them what they want", "adapts to whoever", "shape shifts"],
  seducer_dandy: ["hard to pin down", "doesn't fit a type", "ambiguous", "unconventional style", "breaks the mold", "defies categories", "won't be labeled", "one of a kind"],
  seducer_natural: ["genuine", "unstudied", "no pretense", "disarming", "childlike"],
  seducer_coquette: ["hot and cold", "push pull", "keep them wanting", "advance and retreat", "mixed signals"],
  seducer_charmer: ["makes you feel seen", "flatters", "smooth", "puts people at ease", "charming"],
  seducer_charismatic: ["conviction", "people follow", "inner belief", "magnetic mission", "rally behind"],
  seducer_star: ["aloof", "slightly removed", "mysterious", "hard to read", "projects onto"],
  victim_reformed_rake: ["used to be wild", "misses the old days", "buttoned up now", "nostalgia for", "back in the day"],
  victim_disappointed_dreamer: ["gave up on the dream", "unrealized", "wanted to be", "settled for", "never happened"],
  victim_pampered_royal: ["used to comfort", "spoiled", "wants to break out", "gilded cage", "privileged"],
  victim_new_prude: ["rejected that life", "cleaned up", "swore it off", "reformed", "hides the hunger"],
  victim_aging_baby: ["won't grow up", "acts like a kid", "immature", "indulge him", "peter pan"],
  victim_rescuer: ["always helping", "wants to save", "sucker for a sob story", "takes in strays", "fixer"],
  victim_roue: ["seen it all", "jaded", "nothing impresses", "cynical", "been around"],
  victim_idol_worshipper: ["puts them on a pedestal", "worships", "hero worship", "reveres", "idolizes"],
  victim_lonely_leader: ["lonely at the top", "no one to talk to", "isolated by the role", "everyone wants something", "no real peers", "surrounded by yes men", "can't confide in", "nobody treats me as an equal"],

  // ── The Laws of Human Nature ────────────────────────────────────
  dark_narcissist: ["all about them", "can't take criticism", "makes it about himself", "needs constant praise", "self absorbed"],
  dark_envious: ["resents my", "cold when i win", "jealous", "backhanded", "digs after my"],
  dark_grandiose: ["exaggerates", "inflated", "talks big", "claims he", "stories keep growing", "overstates"],
  dark_defensive: ["can't take feedback", "gets defensive", "takes everything as an attack", "won't hear it", "shuts down when", "makes excuses", "deflects", "never admits"],
  dark_manipulator: ["guilt trip", "manipulating", "obligation", "playing me", "emotional leverage", "guilts me"],
  dark_passive_aggressive: ["passive aggressive", "forgets on purpose", "silent treatment", "little digs", "conveniently forgot"],
  dark_drainer: ["exhausted after", "drains me", "leaves me tired", "energy vampire", "wiped out after"],
  dark_saint: ["holier than thou", "moral high ground", "performs virtue", "judgmental", "sanctimonious"],
  dark_status_obsessed: ["obsessed with status", "who's watching", "how it looks", "optics", "keeping up appearances"],
  dark_fault_finder: ["never says anything good", "always criticizing", "finds the flaw", "nitpicks", "never satisfied"],
  dark_drama: ["always a crisis", "creates drama", "thrives on chaos", "stirs things up", "manufactured emergency"],
  dark_chronic_victim: ["always the victim", "nothing is their fault", "poor me", "blames everyone", "never their doing"],
  dark_short_sighted: ["short sighted", "next ten minutes", "quick win", "kicks the can", "mortgaging the future"],
  principle_irrationality_law: ["emotional decision", "reacting", "let my emotions", "worked up", "not thinking straight", "heated"],
  principle_role_playing: ["says one thing", "mask", "real intentions", "who they actually are", "reading between the lines"],
  principle_repressed_self: ["projecting", "triggers me", "shadow", "what i hate in", "compulsive"],
  principle_grandiosity_law: ["rigid", "one mode only", "underdeveloped side", "hard edge", "softer approach"],
  principle_aimlessness: ["no direction", "drifting", "what's the point", "aimless", "no clear purpose", "lost the thread"],
  principle_group_pull: ["everyone else is", "the group", "peer pressure", "going along with", "lowest common denominator", "team norm"],
};
