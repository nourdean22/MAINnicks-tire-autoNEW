# Customer Emotional Journey — Nick's Tire & Auto

> The emotional sequence customers travel from arrival to conversion,
> mapped to specific pages, sections, and design elements that engineer
> each transition. Generated 2026-05-07 (wave-42) via the
> emotional-arc-designer skill.

---

## The arc, end-to-end

```
┌──────────────────────────────────────────────────────────────────┐
│ ARRIVAL: SKEPTICAL / URGENT / RESEARCHING                        │
│ ↓                                                                │
│ HERO LANDING: Recognize-real (8s) → Trust handoff (10-15s)       │
│ ↓                                                                │
│ TRUST STRIP: Confidence build (5s)                               │
│ ↓                                                                │
│ ─── BRANCH BY USER TYPE ───                                      │
│                                                                  │
│ A. URGENT user → fast-path to CTA                                │
│ B. SKEPTICAL user → comparison content                           │
│ C. RESEARCHING user → pillar content + supporting articles       │
│                                                                  │
│ ─── ALL PATHS RECONVERGE ───                                     │
│ ↓                                                                │
│ DROP-OFF FLYWHEEL section: Friction-removal moment               │
│ ↓                                                                │
│ COMPARISON TABLE / SOCIAL PROOF: Final ratification              │
│ ↓                                                                │
│ CTA DECISION: Commit-with-relief                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: ARRIVAL (the second they land)

### Customer state

The skeptical-burned customer is the highest-value lead and the dominant
arrival type. They have been told something at a chain shop they don't
believe ("you also need a new alternator, that'll be $850"). They came
to your site to verify or get a second opinion. Their default mental
posture is: "I expect this site to also try to sell me something I don't
need."

The urgent customer is in panic mode. Tire blew on Euclid Ave 6 minutes
ago. They Googled "tire shop near me open now" and clicked the highest
result. Their default mental posture is: "I just need to know I can drive
to a shop in the next 15 minutes that will help me."

The researching customer is comparison shopping. Bookmarking. Reading
multiple shops' sites. Their default posture is: "I'm not deciding today.
Show me the tradeoffs honestly."

### What the arrival hero MUST do (in 0-3 seconds)

For all three customer types, the hero needs to communicate:

1. **This is a real shop on a real street.** The brand-sign photo carries
   this. Not a stock photo. Not a marketing render. A photographed sign.
2. **The brand voice isn't trying to manipulate you.** "Pull up for tires.
   Drop off for repairs." reads as casual / honest. Not "World-Class
   Service for Your Vehicle."
3. **The action options are visible without scrolling.** Three CTAs visible
   above the fold. SCHEDULE DROP-OFF (yellow, primary), CALL NOW (red,
   urgent), GET DIRECTIONS (outline, navigational).

### Emotional transition target (3-8 seconds)

Skeptical → "OK, this might actually be different"
Urgent → "I can call this number RIGHT NOW"
Researching → "OK, I should keep reading"

### Engineering this stage

Already shipped (waves 22-31): the hero has all of this codified. Don't
break it. Specifically protect:

- The yellow + dark contrast on the H1
- The CTA priority order (yellow primary, red secondary, outline tertiary)
- The 4-layer text-shadow on the H1 (legibility = trust)
- The photo crop + grain overlay (real-shop signal)

---

## Stage 2: TRUST STRIP (5 seconds in)

The strip running below the hero ratifies the trust signal: 4.9★ rating,
1700+ reviews, FCFS confirmation, $60 floor, payment-programs, open 7
days, Sunday hours.

### Customer state shift

- Skeptical: "Numbers + specifics are showing up = this is real-er than I
  expected."
- Urgent: "I can drive there NOW (open 7 days). Call now."
- Researching: "Pricing floor exists. Payment programs exist. Adding to
  shortlist."

### Engineering goal

The strip is data dense and rhythmic. NOT promotional. Mono numbers,
microcopy, bullet rhythm. The skill `social-proof-architect` later in the
plan will sharpen this further (single curated quote vs carousel,
star-widget proximity to CTA, etc.).

---

## Stage 3: BRANCH BY USER TYPE (15-90 seconds in)

The middle of the page diverges by intent. The site does this implicitly
through scroll-driven information architecture.

### Path A: URGENT user

- They likely stop scrolling and call the phone number visible in the nav
  (sticky) or click CALL NOW.
- The trust strip alone got them to commit. The deeper page content isn't
  for them.
- VAPI receptionist answers ("Nick"). Within 60 seconds they're either
  scheduled or routed to a human.

**Engineering note:** the site shouldn't make this customer scroll for the
phone number. Phone visible in navbar AND in trust strip AND in hero CTA
stack. Wave-22's CTA reorder put SCHEDULE DROP-OFF first which is correct
because urgent customers go to phone, while skeptical customers (the
larger pool) prefer drop-off-without-talking.

### Path B: SKEPTICAL user

- They scroll past the hero looking for evidence the shop is honest.
- They land on:
  - The "DON'T TRUST SHOPS YOU CAN'T SEE" full-bleed band (PullUpBand)
    — names the skeptical pattern explicitly
  - The "THE SIGN YOU'VE DRIVEN PAST" SignFeature — concrete-place
    reinforcement
  - The Services breakdown
  - The ComparisonTable (now linked to the comparison hub)
- Best case: they click through to a competitor comparison page
  (`/conrads-tire-alternative-cleveland` etc.).

**Engineering note:** Wave-39's home-page link to the comparison hub is
the bridge for this user type. Without it, this user reads the home page,
agrees Nick's seems honest, but has no path to verify. The comparison
hub is the verification surface.

### Path C: RESEARCHING user

- They want depth. They land on the blog or a pillar article.
- Three pillars now serve this user type:
  - `/blog/complete-cleveland-tire-guide` (broad tire authority)
  - `/blog/cleveland-auto-repair-owners-manual` (broad repair authority)
  - `/blog/cleveland-pothole-salt-damage-guide` (Cleveland-specific authority)
- Each pillar links to ~5 supporting articles + back to the comparison
  hub via relatedServices.
- Engagement time on this path: 5-30 minutes typical. Conversion
  timeline: weeks.

**Engineering note:** Wave-38's PillarCallout component activates the
hub-and-spoke topology — supporting articles link UP to pillars,
pillars link DOWN to services + comparison hub. Information density is
the trust signal for this customer.

---

## Stage 4: RECONVERGENCE (the drop-off flywheel section)

All three user types eventually hit the bottom of their respective scroll
paths and find the **Drop-Off Flywheel** section ("DROP THE CAR. KEEP YOUR
DAY."). This is the friction-removal moment.

### Customer state

By this point in the journey:
- Skeptical user: convinced or close to it
- Researching user: assessed
- Urgent user: already called (or didn't reach this section)

### What the section needs to do

Remove the last residual friction: "but I can't be without my car for 3
hours." The Uber drop-off + pickup mechanic eliminates that friction in
plain language.

### Engineering goal

Already shipped. The Drop-Off Flywheel section names the exact friction
("3 different shops, 3 different prices") and explains the resolution
("drop it, we Uber you back"). Brand voice ratio: 80% concrete value, 20%
voice flourish.

---

## Stage 5: FINAL RATIFICATION (90-120 seconds)

Just before the closing CTA, the customer does a final scan: "anything
that contradicts what I've absorbed so far?"

### Engineering targets

- **The ComparisonTable + named comparison link (wave-39):** if user is
  still skeptical, they have a one-click verification path to the named
  comparison hub.
- **The Reviews section:** real customer quotes, not generic.
- **The closing CTA section:** "Skip the [chain] wait. Pull up to Nick's."
  with phone + directions + drop-off triple.

---

## Stage 6: COMMIT-WITH-RELIEF

Conversion is a relief moment, not a sales moment. The customer's
internal monologue at the click:

- "This is the honest one."
- "I can stop comparison shopping."
- "I know what I'm getting before I get there."

### Engineering targets

- **Booking form** (next session — `signup-flow-cro` skill audit pending):
  fewest fields possible. Single CTA. Confirmation copy reads as relief
  ("Done. Pull up any time. Walk-ins always welcome.").
- **Phone CTA**: VAPI Nick assistant warm and on-brand. No "Press 1 for
  service, press 2 for billing." The first response is "Hey, this is
  Nick's Tire & Auto, what's going on with your car?"

---

## The "feels right" test

After every page change, ask:

1. **Does this section maintain the customer's current emotional state, or
   does it disrupt it?** (Disruption = bad unless intentional escalation
   to action moment.)
2. **Does this section's emotional tone match the surrounding sections?**
   (Tonal whiplash = trust loss.)
3. **If the customer paused here, would they want to keep reading?**
   (If no → cut or revise.)
4. **Is the friction at this stage proportional to what's expected?**
   (More friction at booking ≠ less friction at hero. Each stage has its
   own friction budget.)

---

## Anti-patterns specific to journey design

- ❌ **Generic "About Us" page that doesn't reinforce the brand voice** —
  About is high-trust real estate; don't waste it on stock corporate copy.
- ❌ **Repeating the hero pitch verbatim deeper on the page** — variation
  signals craft; repetition signals AI-template.
- ❌ **Long scroll without progress signals** — wave-32's grain layer + the
  ScrollProgressBar handle this; preserve them.
- ❌ **Asks before gives** — every form field needs to be earned by prior
  trust-building.
- ❌ **CTA fatigue** — only 3 CTAs per major section; never 5 stacked
  vertically.

---

## Living document

This map gets updated when:
- New user-type evidence emerges (heatmaps, session recordings)
- A section is found to disrupt the emotional flow in conversion data
- A new path is added (e.g., a podcast page, video content)

Last updated: 2026-05-07 (wave-42).
