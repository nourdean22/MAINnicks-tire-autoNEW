/**
 * Nick's Tire & Auto — Brand context, content templates, hashtag library, and CTA library.
 * Used by content generation API routes and AI tools.
 */

// ---------------------------------------------------------------------------
// Brand Context
// ---------------------------------------------------------------------------

export const BRAND_CONTEXT = {
  name: "Nick's Tire & Auto",
  tagline: "Your Neighborhood Tire & Auto Experts",
  location: "Cleveland / Euclid, Ohio",
  vibe: "Family-owned, honest service, fair prices, community-driven",
  services: [
    "Tire sales & installation",
    "Oil changes",
    "Brake inspection & repair",
    "Wheel alignment",
    "Suspension work",
    "General auto repair",
    "Tire rotation & balancing",
    "Diagnostic services",
  ],
  differentiators: [
    "Family-owned and operated",
    "Honest, no-upsell approach",
    "Serving Cleveland/Euclid for years",
    "Fair pricing — no dealer markups",
    "Fast turnaround — most services same-day",
    "Real people, real service",
  ],
  audience: "Local car owners in Cleveland/Euclid area who want trustworthy, affordable auto service",
} as const;

export function getBrandPromptContext(): string {
  return `Business: ${BRAND_CONTEXT.name}
Location: ${BRAND_CONTEXT.location}
Type: ${BRAND_CONTEXT.vibe}
Services: ${BRAND_CONTEXT.services.join(", ")}
What makes us different: ${BRAND_CONTEXT.differentiators.join(". ")}
Target audience: ${BRAND_CONTEXT.audience}`;
}

// ---------------------------------------------------------------------------
// Seasonal Templates
// ---------------------------------------------------------------------------

export interface ContentTemplate {
  name: string;
  category: "seasonal" | "service" | "engagement";
  topics: string[];
  promptHint: string;
  suggestedHashtags: string[];
}

export const SEASONAL_TEMPLATES: ContentTemplate[] = [
  {
    name: "Winter Tires",
    category: "seasonal",
    topics: ["winter tire swap", "snow tire safety", "winter driving tips"],
    promptHint: "Winter is coming — time to switch to snow tires. Emphasize safety on icy Cleveland roads.",
    suggestedHashtags: ["#WinterTires", "#ClevelandWinter", "#SnowTires", "#WinterReady", "#StaySafe"],
  },
  {
    name: "Summer Road Trip Prep",
    category: "seasonal",
    topics: ["road trip checklist", "summer tire check", "AC inspection"],
    promptHint: "Summer road trip season — get your car checked before hitting the highway. Fun, adventurous tone.",
    suggestedHashtags: ["#RoadTripReady", "#SummerDriving", "#TireCheck", "#ClevelandSummer"],
  },
  {
    name: "Back to School",
    category: "seasonal",
    topics: ["back to school car prep", "teen driver safety", "reliable car for school runs"],
    promptHint: "Back to school — make sure your car is safe for daily school runs. Family-focused tone.",
    suggestedHashtags: ["#BackToSchool", "#SafeRides", "#ParentLife", "#ClevelandFamilies"],
  },
  {
    name: "Holiday Specials",
    category: "seasonal",
    topics: ["holiday travel prep", "gift of car care", "year-end specials"],
    promptHint: "Holiday season — travel safely to see family. Warm, community-driven tone.",
    suggestedHashtags: ["#HolidayTravel", "#GiftOfSafety", "#YearEndDeals", "#ClevelandHolidays"],
  },
  {
    name: "Spring Maintenance",
    category: "seasonal",
    topics: ["spring car checkup", "pothole damage repair", "alignment after winter"],
    promptHint: "Spring — time to undo winter damage. Potholes, salt damage, alignment. Fresh start tone.",
    suggestedHashtags: ["#SpringMaintenance", "#PotholeRepair", "#FreshStart", "#ClevelandSpring"],
  },
];

// ---------------------------------------------------------------------------
// Service Templates
// ---------------------------------------------------------------------------

export const SERVICE_TEMPLATES: ContentTemplate[] = [
  {
    name: "Oil Change",
    category: "service",
    topics: ["oil change importance", "how often to change oil", "synthetic vs conventional"],
    promptHint: "Quick, affordable oil changes. Emphasize convenience and engine health.",
    suggestedHashtags: ["#OilChange", "#CarMaintenance", "#EngineHealth", "#QuickService"],
  },
  {
    name: "Tire Rotation",
    category: "service",
    topics: ["tire rotation benefits", "extend tire life", "even tire wear"],
    promptHint: "Regular tire rotation extends tire life and saves money. Practical, money-saving tone.",
    suggestedHashtags: ["#TireRotation", "#SaveMoney", "#TireCare", "#ExtendTireLife"],
  },
  {
    name: "Brake Inspection",
    category: "service",
    topics: ["brake warning signs", "brake safety", "when to replace brakes"],
    promptHint: "Brakes = safety. Warning signs to watch for. Urgent but not scary tone.",
    suggestedHashtags: ["#BrakeSafety", "#BrakeCheck", "#StopSafe", "#AutoSafety"],
  },
  {
    name: "Alignment",
    category: "service",
    topics: ["wheel alignment benefits", "pulling to one side", "uneven tire wear"],
    promptHint: "Alignment saves tires and improves handling. Educational, practical tone.",
    suggestedHashtags: ["#WheelAlignment", "#SmoothRide", "#TireSaver", "#DriveRight"],
  },
];

// ---------------------------------------------------------------------------
// Engagement Templates
// ---------------------------------------------------------------------------

export const ENGAGEMENT_TEMPLATES: ContentTemplate[] = [
  {
    name: "Customer Testimonial",
    category: "engagement",
    topics: ["happy customer story", "5-star review highlight", "customer spotlight"],
    promptHint: "Share a customer success story. Warm, grateful, community tone.",
    suggestedHashtags: ["#HappyCustomer", "#5Stars", "#CustomerLove", "#TrustNicks"],
  },
  {
    name: "Behind the Scenes",
    category: "engagement",
    topics: ["day in the shop", "team at work", "how we do it"],
    promptHint: "Show the real work happening in the shop. Authentic, hardworking vibe.",
    suggestedHashtags: ["#BehindTheScenes", "#ShopLife", "#RealWork", "#MeetTheTeam"],
  },
  {
    name: "Team Spotlight",
    category: "engagement",
    topics: ["meet our tech", "employee of the month", "team introduction"],
    promptHint: "Introduce a team member. Personal, warm, humanizing tone.",
    suggestedHashtags: ["#MeetTheTeam", "#OurCrew", "#TeamSpotlight", "#NicksTireFamily"],
  },
  {
    name: "Tips & Tricks",
    category: "engagement",
    topics: ["car care tips", "DIY maintenance", "when to see a mechanic"],
    promptHint: "Share practical car care advice. Educational, helpful, builds trust.",
    suggestedHashtags: ["#CarCareTips", "#AutoTips", "#DIYCar", "#KnowYourCar"],
  },
];

export const ALL_TEMPLATES = [
  ...SEASONAL_TEMPLATES,
  ...SERVICE_TEMPLATES,
  ...ENGAGEMENT_TEMPLATES,
];

export function getTemplateByName(name: string): ContentTemplate | undefined {
  return ALL_TEMPLATES.find(
    (t) => t.name.toLowerCase() === name.toLowerCase()
  );
}

export function getTemplatesByCategory(category: ContentTemplate["category"]): ContentTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.category === category);
}

// ---------------------------------------------------------------------------
// Hashtag Library
// ---------------------------------------------------------------------------

export const HASHTAG_LIBRARY = {
  brand: ["#NicksTireAndAuto", "#NicksTire", "#ClevelandAutoShop", "#EuclidOhio"],
  tires: ["#Tires", "#NewTires", "#TireShop", "#TireSale", "#TireService"],
  service: ["#AutoRepair", "#CarService", "#MechanicLife", "#AutoShop"],
  trust: ["#HonestMechanic", "#FairPrices", "#FamilyOwned", "#TrustedService"],
  local: ["#Cleveland", "#ClevelandOH", "#EuclidOH", "#NEOhio", "#SupportLocal"],
  safety: ["#RoadSafety", "#DriveSafe", "#CarSafety", "#SafeDriving"],
  seasonal: ["#WinterReady", "#SummerDriving", "#SpringMaintenance"],
} as const;

export function getHashtags(
  categories: (keyof typeof HASHTAG_LIBRARY)[],
  max = 15
): string[] {
  const tags: string[] = [];
  for (const cat of categories) {
    tags.push(...HASHTAG_LIBRARY[cat]);
  }
  // Always include brand tags
  if (!categories.includes("brand")) {
    tags.push(...HASHTAG_LIBRARY.brand.slice(0, 2));
  }
  // Dedupe and limit
  return [...new Set(tags)].slice(0, max);
}

// ---------------------------------------------------------------------------
// CTA Library
// ---------------------------------------------------------------------------

export const CTA_LIBRARY = {
  book: [
    "Book your appointment today!",
    "Schedule your service — call or DM us!",
    "Ready to book? Link in bio!",
  ],
  call: [
    "Call us today!",
    "Give us a call — we're here to help!",
    "Questions? Call Nick's Tire & Auto!",
  ],
  visit: [
    "Stop by our shop in Euclid!",
    "Visit us — walk-ins welcome!",
    "Come see us on the boulevard!",
  ],
  dm: [
    "DM us for a quick quote!",
    "Send us a message — we respond fast!",
    "Got questions? Drop us a DM!",
  ],
  website: [
    "Visit our website for more info!",
    "Check out our services at the link in bio!",
  ],
} as const;

export type CtaGoal = keyof typeof CTA_LIBRARY;

export function getCta(goal: CtaGoal = "book"): string {
  const options = CTA_LIBRARY[goal];
  return options[Math.floor(Math.random() * options.length)];
}

// ---------------------------------------------------------------------------
// Platform formatting
// ---------------------------------------------------------------------------

export const PLATFORM_LIMITS = {
  instagram: { maxChars: 2200, maxHashtags: 30, imageRequired: true },
  facebook: { maxChars: 500, maxHashtags: 5, imageRequired: false },
  twitter: { maxChars: 280, maxHashtags: 3, imageRequired: false },
  tiktok: { maxChars: 2200, maxHashtags: 5, imageRequired: false },
  google: { maxChars: 1500, maxHashtags: 0, imageRequired: false },
} as const;

export type Platform = keyof typeof PLATFORM_LIMITS;

export function getPostSystemPrompt(platform: Platform, tone: string): string {
  const limits = PLATFORM_LIMITS[platform];
  return `You are a social media content writer for ${BRAND_CONTEXT.name}.

${getBrandPromptContext()}

Platform: ${platform}
Tone: ${tone}
Max characters: ${limits.maxChars}
Max hashtags: ${limits.maxHashtags}

Write a single social media post. Return ONLY valid JSON with this structure:
{
  "text": "the post text (no hashtags here)",
  "hashtags": ["#Tag1", "#Tag2"],
  "cta": "call to action sentence"
}

Rules:
- Keep it authentic, not corporate
- Mention Cleveland/Euclid area naturally
- Use the specified tone
- Stay within character and hashtag limits
- Make it engaging and shareable`;
}
