// Third blog-seeding batch (4 posts, 2026-04-24 — topic-cluster build).
//
// Strategy: Google rewards sites that demonstrate DEPTH in a topic. By
// publishing 3-4 blog posts per topic AND linking them together through
// a service-page pillar, we signal topical authority. These 4 complete
// two clusters:
//
// BRAKES CLUSTER (pillar: /brakes)
//   existing: /blog/brakes-grinding-what-to-do
//   existing: /blog/how-long-should-brakes-last
//   NEW:      /blog/why-are-my-brakes-squeaking
//   NEW:      /blog/brake-fluid-flush-when-needed
//
// TIRES CLUSTER (pillar: /tire-shop-near-me)
//   existing: /blog/tire-shop-near-me-open-now
//   existing: /blog/signs-you-need-new-tires
//   NEW:      /blog/winter-tires-vs-all-season-cleveland
//   NEW:      /blog/tire-pressure-warning-light-what-to-do

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const DATABASE_URL = env.split("\n").find(l => l.startsWith("DATABASE_URL=")).replace("DATABASE_URL=", "");

const HERO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

const posts = [
  // ─── BRAKES CLUSTER ──────────────────────────────────
  {
    slug: "why-are-my-brakes-squeaking",
    title: "Why Are My Brakes Squeaking? 5 Real Causes (Not All Mean Replacement)",
    metaTitle: "Brakes Squeaking? 5 Causes + When You Need Repair | Nick's Tire",
    metaDescription: "Brakes squeaking in Cleveland? Here are the 5 real causes, which ones require replacement, and honest costs. Free brake inspection at Nick's.",
    category: "Brakes",
    readTime: "4 min",
    heroImage: HERO,
    excerpt: "Not every brake squeak means you need new pads. Here are the five actual causes, which are urgent, which you can safely ignore, and what each one costs to fix at a shop that won't scare you into unnecessary work.",
    sections: [
      { heading: "Wear Indicators Are the #1 Cause", content: "Your brake pads have a tiny metal tab built in that contacts the rotor when the pad thickness drops below 3mm. The contact makes a high-pitched squeal specifically designed to annoy you into getting service. If the squeal happens on every brake application and is most noticeable at light pressure, this is almost certainly it. You have maybe 500-1,500 miles before you're down to the backing plate. Cost to fix: $149-$199 pad replacement at Nick's." },
      { heading: "Cold Morning Squeaks Are Usually Just Moisture", content: "If the squeal happens only in the first few stops after a night of rain or heavy dew, that's rust flash on the rotor. Pad pressure clears it in the first couple of stops and the noise goes away. Completely harmless. If it persists after warming up, see cause #1 above." },
      { heading: "Glazed Pads From Overheating", content: "Aggressive braking, long downhill grades with the pedal held, or driving with a dragging caliper can overheat pads. The friction material glazes over (becomes glass-smooth), losing grip and making a continuous squeak under medium pressure. Fix: in mild cases we can resurface the pads (called 'bedding') for $40. In severe cases, pads AND rotors need replacement — $329-$429 per axle." },
      { heading: "Cheap Pads or Wrong Compound", content: "If you got a $99 brake job that squeaks from day 1, you got bottom-tier pads. Most chain shops use the cheapest material available (basic semi-metallic or organic pads) to hit the low price point. Higher-end ceramic pads cost $20-$40 more per axle but run quieter, produce less dust, and wear longer. Nick's standard pads are quality ceramic or semi-metallic matched to vehicle spec — not the cheapest option, but they don't squeak." },
      { heading: "Debris Between Pad and Rotor", content: "A small rock, leaf fragment, or piece of road debris can lodge between the pad and rotor, making an intermittent scraping or squealing sound. Usually clears itself after a few strong brake applications. If it persists, we pull the wheel, clean everything, and check for damage — $40 inspection if we find nothing wrong." },
      { heading: "When to Ignore and When to Come In", content: "IGNORE: Quiet squeak after rain that goes away in 2-3 stops. Occasional squeak that doesn't return for days. COME IN: Squeal on every brake application. Grinding (that's metal-on-metal, emergency). Brake dust caked heavy on one wheel. Vibration through the pedal or steering wheel. Free inspection at Nick's, 17625 Euclid Ave, Cleveland OH — we'll measure actual pad thickness in 5 minutes. (216) 862-0005. Also check our related guides: /blog/how-long-should-brakes-last, /blog/brakes-grinding-what-to-do." },
    ],
    relatedServices: ["brakes", "diagnostics"],
    tags: ["brakes", "brake squeak", "brake maintenance", "squealing"],
  },
  {
    slug: "brake-fluid-flush-when-needed",
    title: "Brake Fluid Flush: Do You Really Need It? (Honest Answer)",
    metaTitle: "Brake Fluid Flush Cleveland — Do I Need It? | Nick's Tire & Auto",
    metaDescription: "Is a brake fluid flush needed or an upsell? Honest answer, real signs, actual cost. Brake fluid service from $89 at Nick's Tire & Auto, Cleveland.",
    category: "Brakes",
    readTime: "5 min",
    heroImage: HERO,
    excerpt: "Brake fluid flushes are one of the most common dealer upsells and also one of the most misunderstood services. Here's the truth: when it's real maintenance, when it's a money grab, and how to tell the difference.",
    sections: [
      { heading: "What Brake Fluid Actually Does", content: "When you press the brake pedal, you're pushing hydraulic fluid through lines to squeeze the caliper pistons against your rotors. Brake fluid is designed for this — it handles extreme heat, doesn't compress, and resists boiling. BUT it's hygroscopic, meaning it absorbs moisture from the air over time. Moisture-contaminated fluid boils at lower temperatures. Boiling fluid becomes gas, gas compresses, and your brake pedal goes mushy or falls to the floor. That's when flush matters." },
      { heading: "Manufacturer Recommendations", content: "Most manufacturers recommend brake fluid flush every 2-3 years or 30,000-45,000 miles. High-performance cars (M-series BMW, AMG, etc.) call for every 1-2 years because the system sees more heat. Check your owner's manual — it's the only authoritative source for your car. Nick's Tire pricing: $89 for a full flush on most vehicles, $120-$150 for vehicles with ABS requiring specialized bleed procedure." },
      { heading: "Real Signs You Need a Flush", content: "Dark or amber fluid (fresh fluid is light amber to clear). Mushy or spongy pedal feel. Pedal slowly sinks while stopped at a light. ABS warning light combined with a brake warning light. It's been 3+ years since your last flush. Squeaking calipers (contamination sometimes causes corrosion). If your car's brakes FEEL different than they used to under normal use, old fluid is a possible culprit." },
      { heading: "The Dealer-Upsell Red Flag", content: "If a shop says 'your fluid is black, you need a $200 flush today' but your car is 2 years old with 18,000 miles, they're fishing. Before approving any flush, ask: Can you show me the current fluid color? What's the manufacturer's recommended interval for my specific vehicle? Is my pedal firm or spongy right now? A legit tech will answer all three. We DO offer flushes — $89 when it's actually needed." },
      { heading: "What the Flush Actually Does", content: "Proper flush removes ALL the old fluid from the master cylinder, all brake lines, all caliper pistons. Replaces with fresh fluid matched to your car's spec (DOT 3, 4, or 5.1 — each has different moisture tolerance). Includes bleeding the lines to remove any air. Takes 30-45 minutes on most vehicles. Cheap shortcut flushes just suck fluid from the master cylinder reservoir — that's not a real flush, it's a top-off with a fresh-fluid rinse at the top." },
      { heading: "Related Brake Topics", content: "Is your pedal going to the floor? That's a bigger problem than fluid — could be a leaking line, failed master cylinder, or air in the system. Walk in for a free inspection at Nick's, 17625 Euclid Ave, Cleveland OH. We won't upsell a flush you don't need. For related guides: /blog/how-long-should-brakes-last, /blog/why-are-my-brakes-squeaking, /blog/brakes-grinding-what-to-do. Full brake service info at /brakes." },
    ],
    relatedServices: ["brakes", "diagnostics", "general-repair"],
    tags: ["brake fluid", "brake flush", "maintenance", "hydraulic", "brakes"],
  },
  // ─── TIRES CLUSTER ───────────────────────────────────
  {
    slug: "winter-tires-vs-all-season-cleveland",
    title: "Winter Tires vs All-Season in Cleveland: The Honest Decision",
    metaTitle: "Winter Tires or All-Season in Cleveland? | Nick's Tire & Auto",
    metaDescription: "Do you need winter tires in Cleveland? Real trade-offs, when all-season is fine, and when dedicated snow tires save lives. Tire sales & install from $60.",
    category: "Tires",
    readTime: "6 min",
    heroImage: HERO,
    excerpt: "Cleveland winters aren't Minnesota, but they're not Florida either. Whether you actually need dedicated winter tires depends on where you drive, not just where you live. Here's how to decide without getting upsold.",
    sections: [
      { heading: "The Quick Answer", content: "If you drive daily in Cleveland, live in a hilly suburb (Lyndhurst, Mayfield, Broadview), commute through unplowed residential streets, or your all-season tires are over 4 years old — you'll see a real difference with winter tires. If you rarely drive in heavy snow, stay on highways that get plowed, and have decent all-season tires in good condition, you can probably skip them. The split is usually safety vs cost: winter tires cost $400-$800 for a set of 4 plus a switchover fee twice a year, but they cut stopping distance in snow by 30-50%." },
      { heading: "What Winter Tires Actually Do Better", content: "Three things: rubber compound, tread pattern, and siping. Winter tire rubber stays flexible below 45°F — all-season rubber hardens up and grips worse. The tread pattern has deeper grooves to evacuate snow and slush. Siping (the tiny zigzag cuts across the tread blocks) creates hundreds of extra edges that bite into ice. The result: a Michelin X-Ice stopping from 30mph on packed snow in about 55ft; the same car on standard all-seasons stops in 95ft. That's the difference between a close call and hitting the car in front of you." },
      { heading: "When All-Seasons Are Fine", content: "You're a fair-weather driver. Your all-seasons are in year 1-3 and pass the quarter test (tread above 4/32\"). Most of your driving is on plowed highways. You have AWD or 4WD (traction HELPS you GO in snow but doesn't help you STOP — AWD with winter tires is still the gold standard). You park in a garage and can wait out the worst days. The 'all-weather' category (Michelin CrossClimate 2, Nokian WRG4) is a middle ground — snowflake-rated for severe snow, but wearable year-round. Worth considering as a single-set-per-year solution." },
      { heading: "Why Cleveland Specifically Matters", content: "Cleveland gets about 60 inches of snow per year, concentrated in January-February. Lake-effect storms dump 4-8 inches in a day regularly. I-90 and main arteries are plowed, but side streets often aren't for 12-24 hours. The East Side (Euclid, Cleveland Heights, Mayfield) gets MORE snow than the West Side due to lake-effect geography. Steep suburbs (Chagrin Falls, Hunting Valley, parts of Solon) punish all-season tires hard. If you're driving a daily commute that crosses any of this terrain, winter tires go from 'nice to have' to 'real safety equipment.'" },
      { heading: "The Cost Math", content: "A set of 4 winter tires: $400-$800 at Nick's depending on size and brand (Michelin X-Ice, Bridgestone Blizzak, General Altimax Arctic). Plus a wheel set (optional) so you don't pay tire-dismount fees twice a year: $200-$400 for steel wheels. Switchover fee: $80 twice a year without dedicated wheels ($40 if you have your own wheels, just a mount/balance). Total first year: $600-$1,200. Every subsequent year: $80-$160 switchover only. Winter tires last 3-4 seasons with proper storage. Over 3 years, that's $300-$450/year for substantially better winter safety." },
      { heading: "Should You Buy Now or Wait?", content: "If it's before Thanksgiving, prices are lower and inventory is fully stocked. Between Thanksgiving and January, prices climb 10-20% and some sizes sell out. After the first big storm, everyone scrambles at once and tires become hard to find at any price. If you're going to do it, do it early. Nick's Tire & Auto stocks popular sizes of Michelin X-Ice, Bridgestone Blizzak WS90, and General Altimax Arctic 12 November-March. Call ahead for your size: (216) 862-0005. Related: /tires, /tire-shop-near-me, /blog/signs-you-need-new-tires." },
    ],
    relatedServices: ["tires", "tire-shop-near-me"],
    tags: ["winter tires", "snow tires", "all-season", "tire safety", "cleveland winter"],
  },
  {
    slug: "tire-pressure-warning-light-what-to-do",
    title: "Tire Pressure Warning Light On? What It Means and What to Do",
    metaTitle: "Tire Pressure Light On? TPMS Diagnosis | Nick's Tire Cleveland",
    metaDescription: "Tire pressure warning light on? Here's what it means, whether it's safe to drive, how to check pressure, and when to come in. Free TPMS check at Nick's.",
    category: "Tires",
    readTime: "4 min",
    heroImage: HERO,
    excerpt: "That yellow horseshoe on your dash isn't a suggestion — it means one or more tires is at least 25% below proper pressure. Here's what causes it, whether you can drive, and how to fix it cheaply.",
    sections: [
      { heading: "What the Light Actually Means", content: "By law, the tire pressure monitoring system (TPMS) warning triggers when any tire drops 25% below the recommended pressure. For a typical car spec'd at 32 PSI, the light comes on around 24 PSI. That's low enough to hurt handling, fuel economy, and tire life — plus drive at highway speed on an under-inflated tire long enough and you can overheat the sidewall and fail it. The light staying solid means it's currently low. A blinking light that then stays solid = a sensor failure, not a pressure issue." },
      { heading: "First Check: Is It Actually Cold Weather?", content: "Air contracts when it's cold. A 30°F drop overnight can reduce tire pressure by 3-4 PSI. If your light comes on after the first cold snap in fall/winter and goes away after a few miles of highway driving (the tires warm up, pressure rises), this is the cause. Add air to bring them back to spec. Cleveland-specific tip: check pressure every 3-4 weeks in winter, once a month the rest of the year." },
      { heading: "How to Check Pressure Yourself", content: "You need a tire pressure gauge ($5-$15 at any auto parts store). The proper pressure is on a sticker inside the driver-side door frame — NOT on the sidewall of the tire (that's the maximum pressure, not the recommended). Check when the tires are cold (before driving, or at least 3 hours after). Unscrew the valve cap, press the gauge firmly, read the number. If it's below spec, add air at any gas station ($1-$2) or free at many places. Don't over-inflate — over-pressure causes center-wear and rough ride." },
      { heading: "If It's Not Temperature — Finding the Leak", content: "Look at each tire visually — is one obviously flatter than the others? That's your culprit. Check for visible damage: nails, screws, sidewall cuts, valve-stem damage. If you can't see anything, spray soapy water around the tread — bubbles show where air is escaping. A slow leak (10-15 PSI/week) is usually a small puncture; we can plug/patch from the inside for $25-$35. A fast leak means bigger damage, possibly sidewall — often requires replacement." },
      { heading: "The TPMS Sensor Itself Might Be Dead", content: "TPMS sensors live inside each wheel and run on a small battery that lasts 5-10 years. If your car is 7+ years old and you get a TPMS light with CORRECT pressure readings on all four tires, a sensor is probably dead. Cost: $60-$120 per sensor installed. Usually just replace the failed one, unless multiple are dead and you want to do them all together. After replacement we have to 'train' the car to recognize the new sensor (called TPMS relearn) — takes 10 minutes." },
      { heading: "Is It Safe to Drive?", content: "Short distance at low speed (under 5 miles to a gas station or tire shop)? Yes, as long as pressure is still above 20 PSI and the tire isn't visibly flat. Highway driving with the light on? NO — under-inflation at 65+ mph can overheat and cause blowout. Come in to Nick's Tire & Auto for a free TPMS diagnosis at 17625 Euclid Ave, Cleveland OH. Flat repair $25-$35, sensor replacement $60-$120, everything while you wait. (216) 862-0005. Related: /tires, /tire-shop-near-me." },
    ],
    relatedServices: ["tires", "diagnostics"],
    tags: ["tire pressure", "TPMS", "warning light", "flat tire", "tire maintenance"],
  },
];

const conn = await mysql.createConnection(DATABASE_URL);
let inserted = 0;
let updated = 0;
for (const p of posts) {
  const [existing] = await conn.execute("SELECT id FROM dynamic_articles WHERE slug = ?", [p.slug]);
  const values = {
    slug: p.slug,
    title: p.title,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    category: p.category,
    readTime: p.readTime,
    heroImage: p.heroImage,
    excerpt: p.excerpt,
    sectionsJson: JSON.stringify(p.sections),
    relatedServicesJson: JSON.stringify(p.relatedServices),
    tagsJson: JSON.stringify(p.tags),
    status: "published",
    generatedBy: "manual",
    publishDate: new Date().toISOString().slice(0, 10),
  };
  if (existing.length > 0) {
    const setSql = Object.keys(values).map(k => `${k} = ?`).join(", ");
    await conn.execute(`UPDATE dynamic_articles SET ${setSql} WHERE slug = ?`, [...Object.values(values), p.slug]);
    updated++;
    console.log(`UPDATE ${p.slug}`);
  } else {
    const cols = Object.keys(values).join(", ");
    const placeholders = Object.keys(values).map(() => "?").join(", ");
    await conn.execute(`INSERT INTO dynamic_articles (${cols}) VALUES (${placeholders})`, Object.values(values));
    inserted++;
    console.log(`INSERT ${p.slug}`);
  }
}
console.log(`\nTotal: ${inserted} inserted, ${updated} updated`);

const [total] = await conn.execute("SELECT COUNT(*) as n FROM dynamic_articles WHERE status='published'");
console.log(`Published posts now in DB: ${total[0].n}`);
await conn.end();
