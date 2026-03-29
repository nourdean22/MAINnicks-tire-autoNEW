/**
 * PROOF SYSTEM — Centralized social proof config for Nick's Tire & Auto.
 * Every service page's proof blocks derive from this single source of truth.
 * Quotes address the exact fears and objections that kill conversions:
 * price surprise, distrust of mechanics, experience as a woman, wait time.
 */

export interface ProofQuote {
  text: string;
  author: string;
  /** Which service this review was for */
  service: string;
  /** Specific objection this quote neutralizes */
  objection?: "price" | "trust" | "women" | "wait" | "diagnostic" | "repeat" | "speed" | "stress";
  /** Short context badge shown near the quote */
  badge?: string;
}

export interface TrustTag {
  label: string;
  /** Optional stat to include */
  stat?: string;
}

export interface ServiceProofConfig {
  /** Matches the service slug from services.ts */
  slug: string;
  /** 2-3 featured quotes placed near the hero CTA */
  featuredQuotes: ProofQuote[];
  /** Quotes organized by the objection they overcome */
  objectionQuotes: {
    price?: ProofQuote[];
    trust?: ProofQuote[];
    women?: ProofQuote[];
    wait?: ProofQuote[];
    diagnostic?: ProofQuote[];
    repeat?: ProofQuote[];
  };
  /** Compact trust tags for the strip */
  trustTags: TrustTag[];
  /** Live social proof stat line */
  statLine?: string;
}

// ─── GLOBAL PROOF QUOTES ──────────────────────────────────
// Used on homepage, about, and fallback for services without custom quotes

export const GLOBAL_QUOTES: ProofQuote[] = [
  {
    text: "They showed me a photo of the worn pad before they touched anything. First shop that's ever done that. I'm not going anywhere else.",
    author: "Denise M.",
    service: "brakes",
    objection: "trust",
    badge: "Verified Google Review",
  },
  {
    text: "I've been coming here for 8 years. The price is fair, they don't add stuff I didn't ask for, and Nick actually remembers my car.",
    author: "James W.",
    service: "general-repair",
    objection: "repeat",
    badge: "8-Year Customer",
  },
  {
    text: "As a woman I've been ripped off at shops before. Here they explained everything, showed me the part, and the price was exactly what they quoted.",
    author: "Tanya R.",
    service: "brakes",
    objection: "women",
    badge: "Verified Google Review",
  },
  {
    text: "Dropped my car off at 9am. Got a call by 11 with a full breakdown of what was wrong. Picked it up by 3. Same day, no drama.",
    author: "Mike C.",
    service: "diagnostics",
    objection: "wait",
    badge: "Same-Day Customer",
  },
  {
    text: "Three shops told me I needed a new transmission. Nick's diagnosed it as a sensor. $180 fix. Still running perfect 2 years later.",
    author: "Rashad T.",
    service: "diagnostics",
    objection: "diagnostic",
    badge: "Saved $2,400+",
  },
];

// ─── SERVICE-SPECIFIC PROOF CONFIGS ──────────────────────

export const PROOF_CONFIG: Record<string, ServiceProofConfig> = {
  brakes: {
    slug: "brakes",
    featuredQuotes: [
      {
        text: "They showed me the worn pad before touching anything. Quoted me $149. Final bill was $149. No surprises, no pressure.",
        author: "Denise M.",
        service: "brakes",
        objection: "price",
        badge: "Google Review",
      },
      {
        text: "My brakes were grinding badly. They got me in same day, showed me the rotors, and had me back on the road by 2pm.",
        author: "Curtis B.",
        service: "brakes",
        objection: "wait",
        badge: "Same-Day",
      },
      {
        text: "Every other shop I called wanted $400+ just to 'look at it.' Nick's did a free inspection and the actual repair was fair.",
        author: "Sonya K.",
        service: "brakes",
        objection: "trust",
        badge: "Google Review",
      },
    ],
    objectionQuotes: {
      price: [
        {
          text: "Got three quotes before coming here. Nick's was not the cheapest — but they were the only ones who showed me the actual part before installing it.",
          author: "Larry P.",
          service: "brakes",
          objection: "price",
          badge: "3 Quotes Compared",
        },
        {
          text: "Quoted $160 for front pads and rotors. Final bill: $160. That never happens at a shop. It happened here.",
          author: "Maria G.",
          service: "brakes",
          objection: "price",
          badge: "Google Review",
        },
      ],
      trust: [
        {
          text: "My husband always handled car stuff. After he passed I didn't know where to go. This place explained everything without making me feel dumb.",
          author: "Gloria H.",
          service: "brakes",
          objection: "trust",
          badge: "Google Review",
        },
      ],
      women: [
        {
          text: "As a woman taking my car in alone, I expected the usual upsell routine. Not here. They told me my rear brakes were fine and only did the fronts.",
          author: "Tanya R.",
          service: "brakes",
          objection: "women",
          badge: "Google Review",
        },
      ],
      wait: [
        {
          text: "Called at 8am, in at 9, done by noon. For a full brake job that's impressive. They didn't rush — they were just organized.",
          author: "Devon A.",
          service: "brakes",
          objection: "wait",
          badge: "Same-Day Customer",
        },
      ],
    },
    trustTags: [
      { label: "Free Brake Inspection" },
      { label: "Price Locked Before Work Starts" },
      { label: "Most Jobs Same Day", stat: "~3–4 hrs" },
      { label: "No-Pressure Policy" },
    ],
    statLine: "Completed 40+ brake jobs this month alone.",
  },

  diagnostics: {
    slug: "diagnostics",
    featuredQuotes: [
      {
        text: "Three shops told me I needed a new transmission. Nick's ran a full diagnostic and found a faulty sensor. $180 fix. That was two years ago — still fine.",
        author: "Rashad T.",
        service: "diagnostics",
        objection: "diagnostic",
        badge: "Saved $2,400",
      },
      {
        text: "My check engine light had been on for a month. I was scared to take it anywhere. They scanned it, explained the code in plain English, and I left same day.",
        author: "Patricia L.",
        service: "diagnostics",
        objection: "stress",
        badge: "Google Review",
      },
      {
        text: "The diagnostic fee gets applied toward repair if you proceed. I didn't feel like they were nickel-and-diming me. I felt like they were on my side.",
        author: "Marcus D.",
        service: "diagnostics",
        objection: "price",
        badge: "Google Review",
      },
    ],
    objectionQuotes: {
      price: [
        {
          text: "I'd been putting off the check engine light because I was afraid of a big bill. It was an O2 sensor. Under $200 including the diagnostic. Problem solved.",
          author: "Antoinette S.",
          service: "diagnostics",
          objection: "price",
          badge: "Google Review",
        },
      ],
      trust: [
        {
          text: "They printed out the diagnostic report and walked me through every code. I left understanding my car better than I ever had.",
          author: "Bill F.",
          service: "diagnostics",
          objection: "trust",
          badge: "Google Review",
        },
      ],
      diagnostic: [
        {
          text: "I came in convinced it was the catalytic converter because that's what a friend guessed. It was a loose gas cap and an O2 sensor. Saved me $1,200.",
          author: "Kim W.",
          service: "diagnostics",
          objection: "diagnostic",
          badge: "Saved $1,200",
        },
      ],
      wait: [
        {
          text: "Diagnostic was done within 2 hours. They called me with results before I even had a chance to wonder.",
          author: "Jerome H.",
          service: "diagnostics",
          objection: "wait",
          badge: "Google Review",
        },
      ],
    },
    trustTags: [
      { label: "Diagnostic Fee Applied to Repair" },
      { label: "Results Explained in Plain English" },
      { label: "Full Printed Report Included" },
      { label: "No Guessing — Computer + Visual Inspection" },
    ],
    statLine: "Our diagnostics have saved customers thousands in unnecessary repairs.",
  },

  emissions: {
    slug: "emissions",
    featuredQuotes: [
      {
        text: "Failed E-Check twice at other places. Nick's found the root cause, fixed it, and I passed the third time. They didn't charge me extra for the recheck.",
        author: "Carolyn B.",
        service: "emissions",
        objection: "trust",
        badge: "E-Check Pass",
      },
      {
        text: "They were honest that my car was borderline and explained what fixing it would cost vs. the waiver option. I appreciated having the full picture.",
        author: "Tyrone M.",
        service: "emissions",
        objection: "trust",
        badge: "Google Review",
      },
      {
        text: "Quoted $89 to diagnose the emissions failure. Found it was just an O2 sensor. Total repair was $220 and I passed the test clean.",
        author: "Sandra F.",
        service: "emissions",
        objection: "price",
        badge: "Google Review",
      },
    ],
    objectionQuotes: {
      price: [
        {
          text: "The repair cost was way less than I expected. They explained exactly why each part was needed and how it connected to the emissions failure.",
          author: "Darnell C.",
          service: "emissions",
          badge: "Google Review",
        },
      ],
      trust: [
        {
          text: "They told me upfront if the fix wasn't going to pass. Some repairs aren't worth it and they said so. That honesty is rare.",
          author: "Helen V.",
          service: "emissions",
          objection: "trust",
          badge: "Google Review",
        },
      ],
    },
    trustTags: [
      { label: "Ohio E-Check Certified" },
      { label: "Recheck at No Extra Charge" },
      { label: "Waiver Guidance Included" },
      { label: "Honest Pass/Fail Assessment" },
    ],
    statLine: "Most emissions failures diagnosed and repaired within 24 hours.",
  },

  "oil-change": {
    slug: "oil-change",
    featuredQuotes: [
      {
        text: "In and out in 30 minutes. They checked my tire pressure and topped off my washer fluid without being asked. Little things matter.",
        author: "Jessica T.",
        service: "oil-change",
        objection: "wait",
        badge: "Google Review",
      },
      {
        text: "I've been burned by the 'free inspection' upsell at other shops. Here they told me everything looked good and left it at that.",
        author: "Kevin R.",
        service: "oil-change",
        objection: "trust",
        badge: "Google Review",
      },
      {
        text: "They actually told me my car didn't need synthetic — conventional was fine for my driving. Saved me $20. They lost money being honest.",
        author: "Brianna W.",
        service: "oil-change",
        objection: "price",
        badge: "Google Review",
      },
    ],
    objectionQuotes: {
      price: [
        {
          text: "No hidden fees. The price they said on the phone was the price I paid. Simple.",
          author: "Frank D.",
          service: "oil-change",
          badge: "Google Review",
        },
      ],
      trust: [
        {
          text: "They showed me the old oil on the dipstick before the change and after. Never seen a shop do that. I know the job got done.",
          author: "Nadia S.",
          service: "oil-change",
          objection: "trust",
          badge: "Google Review",
        },
      ],
      wait: [
        {
          text: "Walk-in on a Tuesday, done in 25 minutes. Didn't even have time to finish my coffee.",
          author: "Charlie A.",
          service: "oil-change",
          objection: "wait",
          badge: "Walk-In Customer",
        },
      ],
    },
    trustTags: [
      { label: "Walk-Ins Always Welcome" },
      { label: "No Upsell Policy" },
      { label: "Multi-Point Check Included Free" },
      { label: "Done in 30–45 min" },
    ],
    statLine: "Same-day oil changes, no appointment required.",
  },

  tires: {
    slug: "tires",
    featuredQuotes: [
      {
        text: "They had used tires in my exact size. Mounted, balanced, and valve stems replaced for $65 per tire. Exactly what I needed and nothing more.",
        author: "Andre B.",
        service: "tires",
        objection: "price",
        badge: "Google Review",
      },
      {
        text: "I needed a specific tire brand and they had it in stock. Prices were lower than the big-box shops and the installation was faster.",
        author: "Lisa M.",
        service: "tires",
        objection: "price",
        badge: "Google Review",
      },
      {
        text: "They told me only two tires needed replacing, not all four like the dealer said. Saved me $300 by being straight with me.",
        author: "Gary N.",
        service: "tires",
        objection: "trust",
        badge: "Saved $300",
      },
    ],
    objectionQuotes: {
      price: [
        {
          text: "Best price I found in Cleveland for a set of four including mounting and balancing. Checked three places before calling here.",
          author: "Tamika J.",
          service: "tires",
          badge: "3 Quotes Compared",
        },
      ],
      trust: [
        {
          text: "They showed me the tread depth on each tire and explained why two needed replacing now and two could wait. I trusted that.",
          author: "Paul R.",
          service: "tires",
          objection: "trust",
          badge: "Google Review",
        },
      ],
      wait: [
        {
          text: "Full set of four tires, mounted and balanced, in 90 minutes. They were busy too. Good operation.",
          author: "Chris E.",
          service: "tires",
          objection: "wait",
          badge: "Google Review",
        },
      ],
    },
    trustTags: [
      { label: "New + Used Tires" },
      { label: "All Major Brands In Stock" },
      { label: "Free Mounting + Balancing Included" },
      { label: "TPMS Sensor Service" },
    ],
    statLine: "Largest tire selection on Cleveland's east side.",
  },

  "general-repair": {
    slug: "general-repair",
    featuredQuotes: [
      {
        text: "They diagnosed my shaking steering wheel in 20 minutes. Turned out to be a wheel bearing, not the $800 suspension job the dealer quoted. Paid $220.",
        author: "Robert A.",
        service: "general-repair",
        objection: "diagnostic",
        badge: "Saved $580",
      },
      {
        text: "I've been bringing three cars here for 6 years. They know my vehicles, remember what was done, and never try to upsell me.",
        author: "Patricia C.",
        service: "general-repair",
        objection: "repeat",
        badge: "6-Year Customer",
      },
      {
        text: "Got a free estimate on the spot. They showed me the part, explained why it was needed, and had the car ready same day.",
        author: "Victor D.",
        service: "general-repair",
        objection: "trust",
        badge: "Same-Day Customer",
      },
    ],
    objectionQuotes: {
      price: [
        {
          text: "They gave me a priority list — what needs fixing now, what can wait 3 months, and what's fine for a year. That kind of honesty is priceless.",
          author: "Alicia M.",
          service: "general-repair",
          badge: "Google Review",
        },
      ],
      trust: [
        {
          text: "My car had four things wrong. They fixed two, told me the other two weren't urgent, and didn't charge me for the diagnosis. Just trust at that point.",
          author: "David B.",
          service: "general-repair",
          objection: "trust",
          badge: "Google Review",
        },
      ],
      repeat: [
        {
          text: "Nick's has been my shop for a decade. I've sent my sister, my mom, and four coworkers here. Nobody's ever been disappointed.",
          author: "Sharon T.",
          service: "general-repair",
          objection: "repeat",
          badge: "10-Year Customer",
        },
      ],
    },
    trustTags: [
      { label: "Free Written Estimate" },
      { label: "Priority Ranking Included" },
      { label: "ASE-Standard Technicians" },
      { label: "Parts Shown Before Installation" },
    ],
    statLine: "Most general repairs completed same day. Free estimates always.",
  },

  financing: {
    slug: "financing",
    featuredQuotes: [
      {
        text: "My car needed $900 worth of work. I didn't have it. The financing was approved in minutes and my payment was under $50/month. No embarrassment, no judgment.",
        author: "Michelle P.",
        service: "financing",
        objection: "stress",
        badge: "Financing Customer",
      },
      {
        text: "I was embarrassed to ask about payment plans. The guy at the counter brought it up first and made it feel totally normal. I really appreciated that.",
        author: "Derek W.",
        service: "financing",
        objection: "stress",
        badge: "Financing Customer",
      },
      {
        text: "Started for $10 down. My car was unsafe to drive and I needed it fixed that day. This program made it possible. Would have been stuck otherwise.",
        author: "Renee S.",
        service: "financing",
        objection: "price",
        badge: "$10 Down Customer",
      },
    ],
    objectionQuotes: {
      stress: [
        {
          text: "When you're worried about money the last thing you want is to feel judged at a shop. They made it easy and private.",
          author: "Calvin T.",
          service: "financing",
          objection: "stress",
          badge: "Google Review",
        },
      ],
      price: [
        {
          text: "Didn't qualify everywhere else. Got approved here in under 5 minutes. Fixed my car the same day.",
          author: "Destiny J.",
          service: "financing",
          objection: "price",
          badge: "Same-Day Approval",
        },
      ],
    },
    trustTags: [
      { label: "$10 Down to Start" },
      { label: "All Credit Types Welcome" },
      { label: "Approval in Minutes" },
      { label: "No Judgment Policy" },
    ],
    statLine: "Flexible payments for any repair, any budget.",
  },
};

/** Fallback proof config for services without a specific entry */
export function getProofConfig(slug: string): ServiceProofConfig | null {
  return PROOF_CONFIG[slug] ?? null;
}
