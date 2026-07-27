/**
 * 2026-05-28 · Power Atlas · Mastery · mentorship roles + 3 phases.
 * 2026-07-27 · + the 9 creative strategies (Book V).
 *
 * Robert Greene's framework for the development arc of skill: the
 * apprenticeship phase, the creative-active phase, the mastery phase ·
 * plus the 5 mentorship roles that shape the operator's relational
 * field around skill-building.
 *
 * WHY THE BOOK V EXPANSION · the corpus carried 8 Mastery entries against
 * 48 for `48LP` and 41 for `33SW`, and the single entry covering original
 * work (`mastery_creative`) compressed Greene's entire creative-active
 * toolkit into four generic actions ("combine domains", "break the rules
 * you mastered"). That is the one chapter whose whole point is that
 * generic advice does not survive contact with a real problem. Greene
 * names NINE distinct strategies for the creative-active phase and each
 * one fires on a different observable stuck-state — the operator whose
 * work sounds like his influences needs The Authentic Voice, not the
 * operator who is drowning in low-end detail (The High End) or the one
 * averting his eyes from the number that does not fit (The Fact of Great
 * Yield). Collapsed into one entry they were unreachable. Split out, the
 * existing machinery routes them for free: `greene-message-matcher`
 * (chat), `contextual-greene-laws` (per-person sidebar), the Sunday
 * digest cron, and the `greene_law` vector namespace.
 *
 * Source: Robert Greene, "Mastery" (2012) — Book V, "Awaken the
 * Dimensional Mind: The Creative-Active."
 */

import type { GreeneEntry } from "./schema";

export const MASTERY_ENTRIES: GreeneEntry[] = [
  // ── Phases ──────────────────────────────────────────────────────
  {
    key: "mastery_apprenticeship",
    book: "Mastery",
    type: "phase",
    number: 1,
    title: "Apprenticeship Phase",
    summary: "Deep submission to the field's existing knowledge.",
    fullText:
      "The apprenticeship phase is about absorbing the existing knowledge of the field — observing, practicing, deferring to those further along. Premature self-expression in this phase produces shallow work. The goal is submission to the discipline until it becomes second nature.",
    triggers: [
      "operator new to a domain or chapter",
      "fundamentals not yet automatic",
      "urge to be original outpacing absorbed depth",
    ],
    actions: [
      "Find a master worth observing and imitate the practice",
      "Defer your own taste until the fundamentals are reflexive",
      "Log 10,000 reps before deciding what's outdated",
      "Resist the urge to teach what you haven't yet mastered",
    ],
    relatedKeys: ["mentor_true", "mentor_apprentice", "fearless_8"],
    applicabilityPrompt:
      "Is the operator early in a domain where submission to the discipline is the first task? If yes, Mastery Phase 1 applies.",
  },
  {
    key: "mastery_creative",
    book: "Mastery",
    type: "phase",
    number: 2,
    title: "Creative-Active Phase",
    summary: "Originality begins after deep absorption.",
    fullText:
      "Once the field's existing knowledge is internalized, the creative-active phase begins: combining, experimenting, breaking patterns the discipline didn't see. This is where original contribution happens — built on the foundation of absorbed mastery, not in place of it.",
    triggers: [
      "operator has reached fluency in a domain",
      "field's patterns now feel reflexive",
      "original questions surfacing that the discipline hasn't answered",
    ],
    actions: [
      "Combine domains in ways the field hasn't tried",
      "Break the rules you mastered, deliberately",
      "Publish your own POV with full commitment",
      "Build the unique work only you could build",
    ],
    relatedKeys: ["law_25", "law_48", "fearless_9"],
    applicabilityPrompt:
      "Has the operator reached fluency where original work is now the right move? If yes, Mastery Phase 2 applies.",
  },
  {
    key: "mastery_invisible",
    book: "Mastery",
    type: "phase",
    number: 3,
    title: "Mastery Phase",
    summary: "Effortless intuition built on decades of depth.",
    fullText:
      "True mastery is intuition built on depth — the apparent effortlessness of choices that flow from absorbed knowledge. The master sees patterns invisible to others; their work has a signature that no shortcut produces. This phase is not a destination but a stance.",
    triggers: [
      "operator has 10+ years of compounded depth in a domain",
      "intuition outpacing conscious reasoning",
      "signature work emerging that others recognize",
    ],
    actions: [
      "Trust the intuition that's been earned",
      "Synthesize across decades rather than chase the next trick",
      "Teach what only depth can teach",
      "Keep refining; mastery is not a static state",
    ],
    relatedKeys: ["mentor_true", "law_30", "mastery_creative"],
    applicabilityPrompt:
      "Has the operator reached depth in a domain where intuition leads conscious reasoning? If yes, Mastery Phase 3 applies.",
  },
  // ── Mentorship roles (already in v1; rewritten with new schema) ──
  {
    key: "mentor_true",
    book: "Mastery",
    type: "mentorship_role",
    title: "True Mentor",
    summary: "Compresses years of expertise into actionable lift.",
    fullText:
      "A true mentor compresses years of expertise into hours of guidance. The student's trajectory observably accelerates. The exchange involves real time, real risk, and real attention; advice is specific to your context, not generic.",
    triggers: [
      "operator's trajectory measurably accelerated by this person",
      "3+ validated leveraged moves attributable to their guidance in 90d",
      "person's expertise is 5-10 years ahead in operator's domain",
    ],
    actions: [
      "Protect the relationship as a top-tier asset",
      "Show up prepared to every session",
      "Reciprocate however asymmetrically appropriate (effort, attention, future help)",
      "Apply their advice; report back on outcomes",
    ],
    relatedKeys: ["mastery_apprenticeship", "law_11", "law_43"],
    applicabilityPrompt:
      "Has time spent with this person produced 3+ validated leveraged moves in the last 90 days? If yes, tag mentor_true.",
  },
  {
    key: "mentor_peer",
    book: "Mastery",
    type: "mentorship_role",
    title: "Peer Mentor",
    summary: "Lateral exchange of expertise + accountability.",
    fullText:
      "Peer mentors are at similar levels but specialize in non-overlapping domains. The exchange is two-way: each side teaches the other something the other can't easily acquire alone. Accountability flows in both directions.",
    triggers: [
      "person at operator's career level",
      "complementary expertise in non-overlapping domains",
      "exchange is observably two-way",
    ],
    actions: [
      "Schedule regular two-way exchanges (monthly or biweekly)",
      "Trade specific skills + frame each session for output",
      "Hold each other accountable to commitments",
      "Don't let it drift into pure socializing",
    ],
    relatedKeys: ["strategy_alliance", "law_13", "law_18"],
    applicabilityPrompt:
      "Is this person at operator's career level with complementary expertise, and is the exchange two-way? If yes, tag mentor_peer.",
  },
  {
    key: "mentor_anti",
    book: "Mastery",
    type: "mentorship_role",
    title: "Anti-mentor",
    summary: "Looks like a mentor but extracts more than gives.",
    fullText:
      "Anti-mentors hold the status of wise advisors but consume time without delivering proportionate value. Their advice tends toward generic, self-serving, or contradictory. The relationship feels mentorship-shaped but the trajectory doesn't move.",
    triggers: [
      "time spent with this person exceeds 5 hours/month",
      "<1 actionable leveraged move attributable to their guidance in 90d",
      "advice tends generic or self-referential",
    ],
    actions: [
      "Cut session frequency in half as a test",
      "Re-evaluate after 60d — if no shift, formalize distance",
      "Don't burn the relationship; just reduce footprint",
      "Replace the slot with a true mentor or peer",
    ],
    relatedKeys: ["law_10", "dark_drainer", "strategy_withdraw"],
    applicabilityPrompt:
      "Has time spent with this person exceeded 5 hours/month with <1 actionable leveraged move? If yes, tag mentor_anti.",
  },
  {
    key: "mentor_apprentice",
    book: "Mastery",
    type: "mentorship_role",
    title: "Apprentice",
    summary: "Operator is the source; investment compounds over years.",
    fullText:
      "Apprentices receive from the operator. Their development is a long-arc investment that pays back through alliance, reputation, and future collaboration. The right apprentice multiplies the operator's reach.",
    triggers: [
      "person reliably implements operator's advice + reports back",
      "their trajectory measurably accelerating from operator's input",
      "long-arc potential evident in their commitment",
    ],
    actions: [
      "Invest deeper in the few apprentices who show up fully",
      "Set clear expectations around feedback + reciprocity",
      "Don't teach in vain to people who don't apply",
      "Treat the apprentice relationship as a long-arc asset",
    ],
    relatedKeys: ["law_7", "law_11", "strategy_alliance"],
    applicabilityPrompt:
      "Does this person reliably implement operator's advice + return with progress? If yes, tag mentor_apprentice.",
  },
  {
    key: "mentor_none",
    book: "Mastery",
    type: "mentorship_role",
    title: "None",
    summary: "No mentorship dynamic; pure peer or non-domain relationship.",
    fullText:
      "Pure peer / non-domain relationship without mentor or apprentice angle. The relationship is valid on its own terms; just not a mastery-building one.",
    triggers: [
      "no clear mentor or apprentice pattern in either direction",
      "relationship sits in social or operational category instead",
      "skill-building isn't the throughline",
    ],
    actions: [
      "Don't force a mentorship frame that isn't there",
      "Evaluate the relationship on its actual basis",
      "Leave skill-building investment to mentor-tagged people",
    ],
    relatedKeys: [],
    applicabilityPrompt: "Default tag when no other mentorship pattern applies.",
  },

  // ── Book V · the 9 creative strategies ──────────────────────────
  // Greene's toolkit for the creative-active phase. Each fires on a
  // DIFFERENT stuck-state — that separation is the whole value, and it
  // is what the single `mastery_creative` entry destroyed. Ordered as
  // Greene lists them.
  {
    key: "mastery_authentic_voice",
    book: "Mastery",
    type: "creative_strategy",
    number: 1,
    title: "The Authentic Voice",
    summary: "Shed the borrowed style; endure the phase where your own sounds worse.",
    fullText:
      "Early work is inevitably an imitation of whoever you absorbed — that is the apprenticeship doing its job. But the influences must eventually be shed, and the transition is brutal: your own voice, at first, is demonstrably worse than your competent imitation of a master. Most people retreat here, because the imitation earns approval faster and the authentic version earns silence. Push through the ugly middle. The voice that is actually yours is the only thing in your work that cannot be copied by someone with more resources.",
    triggers: [
      "operator's output is fluent but indistinguishable from its influences",
      "work earns polite approval and zero strong reaction",
      "operator can name the source every stylistic choice came from",
      "recent output would be unchanged if a competitor had produced it",
    ],
    matchPhrases: [
      "sounds like everyone else",
      "sounds generic",
      "sounds like ai",
      "sounds corporate",
      "doesn't sound like me",
      "sound like me",
      "my own voice",
      "find my voice",
      "same as every other shop",
      "cookie cutter",
      "derivative",
      "not authentic",
      "copying",
    ],
    actions: [
      "Name the influence you are imitating out loud, then delete every choice that came from it",
      "Ship one piece in the voice that embarrasses you and measure the reaction, not your comfort",
      "Write the sentence a competitor could never write, and build the piece around it",
      "Stop consuming the influence for 30 days while you produce",
    ],
    relatedKeys: ["mastery_creative", "mastery_natural_powers", "law_25", "fearless_9"],
    applicabilityPrompt:
      "Is the operator producing fluent work that is stylistically indistinguishable from its sources? If yes, The Authentic Voice applies.",
  },
  {
    key: "mastery_great_yield",
    book: "Mastery",
    type: "creative_strategy",
    number: 2,
    title: "The Fact of Great Yield",
    summary: "Chase the one fact that breaks your theory; it is worth a hundred that confirm it.",
    fullText:
      "Darwin's breakthroughs came from the observations that refused to fit the theory he already held. Everyone else averted their eyes from those facts, because an anomaly is an accusation against the frame you have invested in. The single inconvenient detail — the customer who churned for a reason nobody logged, the number that contradicts the dashboard's story — is a door. Confirming evidence tells you what you already believe; the anomaly tells you what is actually true.",
    triggers: [
      "a metric contradicts the operator's stated narrative and was not investigated",
      "an outlier result was dismissed as noise without a root cause",
      "operator explains away a surprising outcome rather than chasing it",
      "a churned or lost deal has no logged reason",
    ],
    matchPhrases: [
      "doesn't add up",
      "doesn't make sense",
      "doesn't fit",
      "numbers don't match",
      "can't explain",
      "shouldn't be happening",
      "weird outlier",
      "anomaly",
      "that's strange",
      "unexpected result",
      "contradicts",
      "surprising",
      "one customer who",
    ],
    actions: [
      "Take the single result that does not fit and spend one full session on it before anything else",
      "Write down the explanation you are tempted to use, then go disprove it with data",
      "Interview the one churned customer whose reason you never logged",
      "Treat any 'that's just noise' as an unfinished investigation until proven",
    ],
    relatedKeys: ["mastery_dimensional_thinking", "fearless_1", "law_29"],
    applicabilityPrompt:
      "Has the operator encountered a result that contradicts their working theory and moved past it without investigation? If yes, The Fact of Great Yield applies.",
  },
  {
    key: "mastery_mechanical_intelligence",
    book: "Mastery",
    type: "creative_strategy",
    number: 3,
    title: "Mechanical Intelligence",
    summary: "Know the thing by handling it, not by diagramming it.",
    fullText:
      "The Wright brothers built and crashed gliders in the sand while Langley theorized with government funding and a superior budget. Mechanical intelligence is the understanding that arrives only through physical contact with the object — how the parts resist each other, where it actually breaks, what the diagram silently omitted. Paper knowledge detached from the machine is fragile knowledge; it fails at exactly the moment reality diverges from the spec. Build the ugly version and handle it.",
    triggers: [
      "operator is designing on paper without a working prototype",
      "a decision is being made from a dashboard rather than direct observation",
      "planning time on a build has exceeded hands-on time",
      "operator has not personally used the thing they are specifying",
    ],
    matchPhrases: [
      "on paper",
      "in theory",
      "haven't tried it yet",
      "before i build",
      "planning it out",
      "spec it out",
      "architecture first",
      "overthinking the design",
      "should i build",
      "just build it",
      "prototype",
      "hands on",
      "test it myself",
    ],
    actions: [
      "Build the crude working version this session; keep the diagram as a byproduct, not a prerequisite",
      "Use the thing yourself for a week before specifying its second version",
      "Walk the bays and watch the actual process before trusting the dashboard's version of it",
      "Break it deliberately to find where it actually fails, not where you assume it will",
    ],
    relatedKeys: ["mastery_apprenticeship", "mastery_high_end", "fearless_4"],
    applicabilityPrompt:
      "Is the operator reasoning about a system from specification or dashboard rather than direct hands-on contact? If yes, Mechanical Intelligence applies.",
  },
  {
    key: "mastery_natural_powers",
    book: "Mastery",
    type: "creative_strategy",
    number: 4,
    title: "Natural Powers",
    summary: "Return to your primal inclination; working against the grain yields forgettable work.",
    fullText:
      "Every field applies steady pressure toward what it already rewards, and that pressure will quietly reshape you into a competent version of someone else. Your leverage is the specific grain you were born with — the inclinations that showed up in childhood, before anyone told you what was practical. Work with that grain and effort compounds; work against it and you produce technically adequate work that no one remembers, including you. The question is never what the field wants but what only you are built to notice.",
    triggers: [
      "operator is pursuing a direction chosen for external approval rather than inclination",
      "energy is chronically low on work that is going well by external measures",
      "operator describes their real strength as a side interest",
      "advice from others is pushing toward a more conventional path",
    ],
    matchPhrases: [
      "should i just get a job",
      "everyone says i should",
      "supposed to",
      "the normal way",
      "am i wasting",
      "goes against my",
      "not my strength",
      "my actual strength",
      "comes naturally",
      "forcing myself",
      "playing to my strengths",
      "what worked for them",
      "what i'm actually good at",
    ],
    actions: [
      "Name the inclination that predates the business, and audit whether this quarter's work feeds or starves it",
      "Kill the one initiative that exists only because the field expects it",
      "Route the work you are naturally drawn to onto the critical path instead of the margins",
      "Stop taking advice from people optimizing for a life you did not choose",
    ],
    relatedKeys: ["mastery_authentic_voice", "mastery_open_field", "law_10"],
    applicabilityPrompt:
      "Is the operator drifting toward a conventional path that conflicts with their demonstrated natural inclination? If yes, Natural Powers applies.",
  },
  {
    key: "mastery_open_field",
    book: "Mastery",
    type: "creative_strategy",
    number: 5,
    title: "The Open Field",
    summary: "Do not fight in the crowded arena; invent the adjacent one where you set the standard.",
    fullText:
      "In a saturated field you are judged on the incumbents' terms, by criteria they defined and already dominate — even winning there is expensive and temporary. The open field is the adjacent space nobody has claimed, where you write the standard and every comparison flatters you by default. This is not avoidance of competition; it is refusing to accept someone else's scoreboard. Find the seam between two established fields and occupy it.",
    triggers: [
      "operator is competing head-on with established players on their metrics",
      "differentiation argument reduces to price or proximity",
      "the market is described as crowded or commoditized",
      "operator holds an unusual skill combination that nobody in the field shares",
    ],
    matchPhrases: [
      "everyone else is doing",
      "too much competition",
      "market is crowded",
      "saturated",
      "competing on price",
      "race to the bottom",
      "how do i compete",
      "beat the competition",
      "differentiate",
      "stand out",
      "no one else is doing",
      "same service as",
      "commoditized",
    ],
    actions: [
      "Write down the incumbents' scoreboard, then define the one you would rather be measured on",
      "Find the seam between two of your domains and name the category that lives there",
      "Stop competing on the axis where five competitors are already adequate",
      "Claim the standard publicly before anyone else defines it",
    ],
    relatedKeys: ["mastery_evolutionary_hijack", "mastery_natural_powers", "law_48"],
    applicabilityPrompt:
      "Is the operator competing on an incumbent-defined axis when an unclaimed adjacent field is available to them? If yes, The Open Field applies.",
  },
  {
    key: "mastery_high_end",
    book: "Mastery",
    type: "creative_strategy",
    number: 6,
    title: "The High End",
    summary: "Keep the highest purpose visible; it decides which details are worth the day.",
    fullText:
      "Granular work is necessary, but detail without a visible high end is just motion — you end up optimizing things that cannot move the outcome, and it feels like diligence the entire time. The master keeps the largest purpose in view while doing the smallest work, and lets that purpose decide which details earn attention. Losing the high end is the most comfortable failure mode available, because low-end work always provides the sensation of progress. Re-anchor before choosing the next task, not after the day is gone.",
    triggers: [
      "operator has spent a full session on work with no line to a stated goal",
      "polish or refactor work is displacing revenue-critical follow-through",
      "operator cannot state how the current task moves the quarter's objective",
      "task selection is being driven by what is interesting rather than what compounds",
    ],
    matchPhrases: [
      "in the weeds",
      "lost in the details",
      "rabbit hole",
      "does this even matter",
      "why am i doing this",
      "losing sight",
      "big picture",
      "spent all day on",
      "is this worth it",
      "bikeshedding",
      "polishing",
      "perfecting",
      "refactor",
    ],
    actions: [
      "State the high end in one sentence before selecting the next task, and drop anything that cannot be traced to it",
      "Cap the current detail work with a hard timebox and return to the critical path",
      "Compare hours spent this week on polish versus on the one thing that produces revenue",
      "Put the quarter's objective somewhere physically visible during build sessions",
    ],
    relatedKeys: ["mastery_mechanical_intelligence", "law_29", "fearless_8"],
    applicabilityPrompt:
      "Is the operator deep in low-end detail work that cannot be traced to a stated high-level objective? If yes, The High End applies.",
  },
  {
    key: "mastery_evolutionary_hijack",
    book: "Mastery",
    type: "creative_strategy",
    number: 7,
    title: "The Evolutionary Hijack",
    summary: "Repurpose an existing structure instead of inventing one; evolution never starts clean.",
    fullText:
      "Evolution does not design from scratch — it hijacks what already exists and repurposes it, turning a swim bladder into a lung. Adaptation of a proven structure is faster, cheaper, and more robust than invention, because the structure has already survived its own debugging. The creative move is to take a form, technology, or process that works in one domain and point it at a purpose it was never built for. Greenfield is a luxury; the hijack is the leverage.",
    triggers: [
      "operator is planning to build from scratch what an existing system nearly does",
      "a proven asset, channel, or process is sitting idle",
      "a solved problem in an adjacent industry maps onto the current one",
      "rebuild scope is expanding while an adaptable version already runs",
    ],
    matchPhrases: [
      "from scratch",
      "reinvent",
      "start over",
      "rebuild everything",
      "greenfield",
      "already have",
      "repurpose",
      "reuse",
      "existing system",
      "what if we used",
      "borrow from",
      "another industry",
      "adapt",
    ],
    actions: [
      "List what already runs and works before approving any build-from-scratch",
      "Point one existing asset at a purpose it was not designed for and test it this week",
      "Steal the solved mechanism from an adjacent industry rather than deriving your own",
      "Convert the rebuild into an adaptation and bank the difference in time",
    ],
    relatedKeys: ["mastery_open_field", "mastery_alchemical", "law_7"],
    applicabilityPrompt:
      "Is the operator about to build from scratch something an existing structure could be repurposed to do? If yes, The Evolutionary Hijack applies.",
  },
  {
    key: "mastery_dimensional_thinking",
    book: "Mastery",
    type: "creative_strategy",
    number: 8,
    title: "Dimensional Thinking",
    summary: "Rotate the problem through every angle; the specialist only ever sees one plane.",
    fullText:
      "Leonardo studied an object from every side, in motion, across time, and in relation to everything around it — the specialist sees a single plane and mistakes it for the whole. Dimensional thinking means deliberately rotating a problem: through the customer's view, the operator's view, the ledger's view, the five-year view. The answer that is invisible from one angle is usually obvious from another, and the block is almost never a lack of intelligence — it is a fixed vantage point. Widen the frame before working harder inside it.",
    triggers: [
      "operator has attacked the same problem repeatedly with one approach",
      "the analysis considers only the operator's own vantage point",
      "no time dimension in the reasoning — only the present state",
      "operator reports being stuck without having reframed the question",
    ],
    matchPhrases: [
      "another way to look",
      "different perspective",
      "one angle",
      "reframe",
      "zoom out",
      "what am i missing",
      "blind spot",
      "tunnel vision",
      "only see",
      "same approach",
      "not seeing it",
      "from the customer's side",
      "stuck on this problem",
    ],
    actions: [
      "Restate the problem from the customer's side, the team's side, and the P&L's side before solving it",
      "Ask what this decision looks like in five years, then in five days",
      "Hand the problem to someone whose domain is not yours and listen for the question you did not ask",
      "Change the medium — draw it, or say it out loud — and see which constraint disappears",
    ],
    relatedKeys: ["mastery_great_yield", "mastery_alchemical", "mastery_creative", "law_48"],
    applicabilityPrompt:
      "Is the operator stuck on a problem they have only examined from a single vantage point? If yes, Dimensional Thinking applies.",
  },
  {
    key: "mastery_alchemical",
    book: "Mastery",
    type: "creative_strategy",
    number: 9,
    title: "Alchemical Creativity and the Unconscious",
    summary: "Fuse forms that do not belong together; saturate, then release and let it finish.",
    fullText:
      "The alchemical move is to hold two things that do not belong together until the tension between them produces a third thing — a tire shop run like a software company, a personal operating system built with business-operations machinery. The second half is mechanical, not mystical: total immersion followed by genuine release, because the unconscious completes what conscious effort has saturated but cannot close. Forcing a solution during the tension phase produces the obvious answer, which is always someone else's. Immerse fully, then step entirely away, and the combination arrives.",
    triggers: [
      "operator has been grinding on one problem past the point of returns",
      "output has converged on the obvious and conventional solution",
      "no deliberate rest cycle between immersion and decision",
      "two unrelated domains are both live in the operator's attention",
    ],
    matchPhrases: [
      "can't figure it out",
      "banging my head",
      "creative block",
      "blocked",
      "been at this for hours",
      "burnt out on this",
      "need a break",
      "no idea",
      "brainstorm",
      "weird combination",
      "combine",
      "opposite",
      "shower thought",
      "stuck",
    ],
    actions: [
      "Stop the session now and do something physically different; decide after the release, not during the grind",
      "Force the pairing — name two domains you are in and state what their fusion would look like",
      "Write the conventional answer down, then require the next idea to contradict it",
      "Move between the shop and the code when either one stalls; the cross-pollination is the mechanism",
    ],
    relatedKeys: ["mastery_dimensional_thinking", "mastery_evolutionary_hijack", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator grinding past the point of returns, or holding two domains whose fusion has not been attempted? If yes, Alchemical Creativity applies.",
  },
];
