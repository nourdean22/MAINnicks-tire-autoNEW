/**
 * ChatGPT Knowledge Extraction — Pre-processed insights
 *
 * Manually extracted from the 463 ChatGPT conversations.
 * These are the highest-value patterns, decisions, preferences,
 * and lessons that Nick should KNOW about Nour.
 *
 * This is a STATIC knowledge file — it doesn't query the DB.
 * It's injected into the system prompt for Nick to reference.
 *
 * Categories extracted:
 * 1. BUSINESS DECISIONS — choices Nour made about the shop
 * 2. MARKETING STRATEGIES — content, ads, campaigns that worked
 * 3. PERSONAL DEVELOPMENT — mindset, goals, philosophy
 * 4. HEALTH DECISIONS — workout, supplements, ADHD management
 * 5. RELATIONSHIP CONTEXT — marriage, family, social dynamics
 * 6. FINANCIAL MINDSET — investing, saving, spending patterns
 * 7. BRAND VOICE — how Nour wants to sound
 * 8. RECURRING PATTERNS — themes that appear across many conversations
 */

/**
 * Get ChatGPT-extracted knowledge for system prompt.
 * Returns a formatted context string.
 */
export function getChatGPTKnowledge(): string {
  const lines: string[] = [
    `# CHATGPT CONVERSATION ARCHIVE (463 conversations analyzed)`,
    ``,
    `## BUSINESS DECISIONS & STRATEGIES`,
    `- Rebranded from Moe's Euclid to Nick's Tire & Auto — competitors forced the name change, Nour turned it into a power move ("they tried to slow us down, all they did was push us to level up")`,
    `- Revenue analysis approach: demands executive-grade, numbers-first analysis with specific $ totals, % mix, margins, ARO, concentration risk — no generic advice`,
    `- Customer list analysis: built custom prompt for CRM audit — Data Health Score, 4-segment model (VIP/Reliable/At-Risk/One-and-done), 30-day reactivation plan`,
    `- Pricing strategy: remove exact prices from website (creates curiosity), keep used tires $60 as hook, financing $0 down messaging`,
    `- Free inspections under 1 hour = STRATEGY not charity — gets car on lift, finds problems, presents solutions`,
    `- $50 inspection fee for longer jobs — comes off repair if customer accepts (removes risk for customer)`,
    `- DoorDash/rideshare driver targeting — special deals to capture gig economy fleet customers`,
    `- Viral giveaway model: "Stormblazer $800 Winter Survival Giveaway" — Like + Share + Tag = forced local reach amplification`,
    `- Website conversion: needs real hero block, trust bar (badges), clear CTAs (Call + Directions + Text Us)`,
    `- Estimate follow-up strategy: ALG estimate with no matching invoice = DECLINED WORK = recovery opportunity at day 7 and day 30`,
    `- SEO: has suspension repair image for SEO, investing in Google Ads, tracking gclid for offline conversions`,
    ``,
    `## MARKETING & BRAND VOICE`,
    `- 48 Laws of Power style marketing — subtle, strategic jabs at competitors without naming them directly`,
    `- "Euclid Monopoly" strategy — position Nick's as THE dominant shop in the area through community events and strategic giveaways`,
    `- Instagram content themes: behind-the-scenes shop footage, before/after repairs, customer testimonials, seasonal safety tips`,
    `- Content style: bold, punchy, street-smart, confident but not arrogant, community-first messaging`,
    `- Multiple conversations about Instagram post ideas, shop post creation, ad strategy — Nour is HEAVY on social media marketing`,
    `- Reel strategy: 12-15 seconds, 9:16, fast cuts, bold text, aggressive music, Cleveland local angle`,
    `- Caption formula: hook → story → proof → CTA. No generic lines.`,
    `- Shop window design discussions — cares deeply about physical brand presentation`,
    ``,
    `## PERSONAL DEVELOPMENT & PHILOSOPHY`,
    `- Core philosophy: "Systems over motivation, consistency over intensity, execution over overthinking"`,
    `- Stoic framework actively studied: Memento Mori, Amor Fati, Premeditatio Malorum`,
    `- 48 Laws of Power is the operational manual — references it constantly for business AND personal decisions`,
    `- Growth goals: "1% improvement every day", "chase the uncomfortable until comfortable with uncomfortable"`,
    `- Anti-nice-guy stance: "No more Mr Nice Guy", studies self-respect and self-discipline`,
    `- Focus obsession: multiple conversations about "achieving absolute focus", "shutting down overstimulated brain", "breaking autopilot reactions"`,
    `- "Skills to Master" conversation — actively pursuing mastery across multiple domains`,
    `- Social confidence studied: "approaching girls in person", "social confidence and charisma tips", "active listening techniques"`,
    `- "Breaking Shallow Mindset" — actively fighting against surface-level living`,
    `- "Let go of others' opinions" — deliberate practice of not caring what people think`,
    `- "Focus Over Chasing" — learned that stillness and focus beats scattered pursuit`,
    `- Late-night rumination identified as a pattern: "Shutting Down Overstimulated Brain" was a specific ChatGPT session`,
    `- Faith matters: "Let all insults and rejection motivate me", references to Allah and gratitude, Quran reading goals`,
    ``,
    `## HEALTH & BODY`,
    `- Weight target: 180 lbs (currently ~230, history of tracking)`,
    `- ADHD management: Adderall IR 10mg, studied "Adderall IR Yawning Causes", "Overthinking ADHD morning plan"`,
    `- Morning routine specifically designed around ADHD and Adderall timing`,
    `- Caffeine tolerance studied — working on reducing dependence, increasing willpower`,
    `- AG1 vs multivitamin researched — supplements matter to him`,
    `- Breathing techniques studied: "Breathing Light Without Pausing" — not just fitness, breathwork for mental control`,
    `- Boxing at Strong Style gym — chose boxing as primary sport`,
    `- Jiu Jitsu explored: "Jiu Jitsu First Class Tips" — tried it at least once`,
    `- "Fight Strategy Breakdown" — studies fighting tactics analytically`,
    `- Goals: "Mat Bag Workout Plan", "Fight camp plan" — takes training seriously`,
    `- Skincare studied: dark circles, eye cream, hydroquinone — cares about appearance`,
    `- Vaping reduction goal: "Lower vaping to morning and night, quit smoking"`,
    ``,
    `## FINANCIAL MINDSET`,
    `- Saving $100K was a 2025 goal`,
    `- "Pay all credit cards" — debt reduction is a stated priority`,
    `- Credit card churning explored — financially curious and optimization-minded`,
    `- Car flipping and Turo rental investigated — always looking for side revenue streams`,
    `- Investment properties on the radar — second business + real estate = stated goals`,
    `- "Financial Discipline & Investing Tips" — studied this specifically`,
    `- $5K/day shop revenue goal ("5k a day at the shop")`,
    `- Budget-conscious: "gonna be disciplined and get the smaller more affordable house"`,
    ``,
    `## RELATIONSHIP & FAMILY`,
    `- Married to Dania — marriage is foundational, not secondary`,
    `- Trying for children 4+ years — a deep, private pressure`,
    `- Second business + baby = simultaneous goals (high ambition, high stress)`,
    `- Mother's health is a concern — responds with strength, not vulnerability`,
    `- "Keeping people at arms length" — intentional about social boundaries`,
    `- Studies persuasion and social dynamics — not just business, personal relationships too`,
    ``,
    `## RECURRING PATTERNS (across 463 conversations)`,
    `- INSTAGRAM CONTENT: 8+ conversations about shop Instagram posts — this is his primary marketing channel`,
    `- FOOD/NUTRITION: 15+ conversations about calories, ingredients, recipes — health-conscious but enjoys food`,
    `- FIGHTING/COMBAT: 5+ conversations about boxing, UFC, fight strategy — competitive mindset extends to sport`,
    `- SELF-IMPROVEMENT: 20+ conversations about mindset, discipline, focus, confidence — constant growth pursuit`,
    `- BUSINESS STRATEGY: 10+ conversations about revenue, customers, pricing, marketing — always thinking about the shop`,
    `- QUICK LOOKUPS: 100+ conversations are simple questions (measurements, explanations, comparisons) — uses AI as a fast reference tool`,
    `- BUILD-DRIFT EVIDENCE: conversations range from deeply strategic to random trivia — matches the ADHD Build-Drift-Reset cycle identified in mastery data`,
    ``,
    `## NOUR'S DECISION STYLE (from conversation patterns)`,
    `- Asks for multiple options, then picks one fast ("picking", "going with")`,
    `- Wants data before deciding but decides quickly once data is in`,
    `- Prefers bold, aggressive options over safe ones`,
    `- Asks follow-up questions that add complexity ("also add in X", "what about Y")`,
    `- Uses ALL CAPS for emphasis (NOT anger)`,
    `- Packs multiple requests into single messages`,
    `- Often revisits topics from different angles across multiple sessions`,
  ];

  return lines.join("\n");
}
