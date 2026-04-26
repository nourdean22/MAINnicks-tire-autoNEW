// Seed 5 high-intent blog posts into dynamic_articles.
// One-time run — safe to re-run (uses INSERT ... ON DUPLICATE KEY UPDATE
// keyed on slug).
//
// Content written to match buy-intent queries we already get impressions on:
//   "car making clicking noise"  — GSC shows this URL has imps
//   "check engine light cleveland"
//   "brakes grinding"
//   "tire shops near me open now"
//   "oil change vs synthetic"
//
// Each post is ~600-900 words of real content — not filler, not AI-slop.
// Sections stored as JSON matching the existing schema.

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
  {
    slug: "car-making-clicking-noise",
    title: "Car Making a Clicking Noise? What's Actually Wrong (And How Much It Costs)",
    metaTitle: "Clicking Noise When Turning or Starting? Cleveland Auto Repair | Nick's Tire",
    metaDescription: "Car clicking when turning, starting, or driving? Here's what each sound means + honest repair costs. Cleveland auto repair at Nick's Tire & Auto.",
    category: "Diagnostics",
    readTime: "6 min",
    heroImage: HERO,
    excerpt: "A clicking noise from your car isn't just annoying — it's telling you exactly what's wrong if you know how to listen. Here's the honest breakdown of what each type of click means and what it'll cost to fix.",
    sections: [
      { heading: "Clicking When Starting the Engine", body: "That fast 'click-click-click' when you turn the key usually means your battery is dying. The starter motor needs serious current to crank the engine, and a weak battery doesn't deliver enough. A single 'click' with no crank often means the starter solenoid itself is failing. Cost to fix: $120-$180 for a battery (parts + install), $250-$450 for a starter motor on most vehicles. A quick free test at Nick's takes 5 minutes — we check battery health AND charging system so you don't replace the wrong thing." },
      { heading: "Clicking When Turning the Steering Wheel", body: "Most common on front-wheel-drive cars. Clicking — especially during sharp turns at low speed — is almost always a worn CV joint (constant velocity joint). These sit in your front axles and let the wheel turn while power is transmitted. Over time the rubber boot cracks, grease leaks out, dirt gets in, and the joint fails. Left alone, a bad CV joint will strand you. Cost to fix: $250-$450 per side for a rebuilt axle (includes labor). If only the boot is torn but the joint's still tight, we can sometimes reboot it for $150." },
      { heading: "Clicking While Driving at Speed", body: "Clicking that gets faster as you accelerate is usually a wheel bearing or tire-related. Wheel bearings make a rhythmic click or hum that changes with turning direction. A small stone stuck in tire tread will click at a steady rate that matches wheel rotation. Bent wheels or separated tires also click. Cost: $0-$5 if it's a pebble, $300-$500 per wheel bearing, $100-$200 for tire re-balance or replacement." },
      { heading: "Clicking Under the Hood When Running", body: "If you hear ticking from the engine bay while the car idles, most likely suspects: worn valve lifters (needs thicker oil or hydraulic lifter replacement), low oil level or the wrong viscosity oil, or an exhaust manifold leak ('exhaust tick'). Each has different fix cost: fresh oil $45, valve train work $400-$1200, exhaust manifold gasket $250-$500. We diagnose free and tell you exactly what you're hearing before quoting repair." },
      { heading: "When to Drive It vs Call a Tow", body: "Clicking from the starter + no start: can tow if it won't start at all; if it does start and stays running, drive straight to the shop. Clicking CV joint at low speed: usually safe to drive short distances (to the shop, not cross-country). Clicking wheel bearing: drive cautiously, bearings can seize and lock the wheel. Engine tick with oil light on: DO NOT DRIVE — you can destroy the engine in minutes. Call us at (216) 862-0005, we can usually walk you through which it is in 2 minutes." },
      { heading: "Why Catching Clicks Early Saves Money", body: "Every noise in your car starts small and cheap to fix. A squeak becomes a grind. A click becomes a lock-up. The difference between a $200 brake pad and a $600 brake + rotor + caliper job is usually whether you came in when it started or waited until it got scary. Nick's Tire & Auto offers free diagnostic inspections — walk in at 530 E 185th St, Euclid, and we'll tell you exactly what's making that noise and what it'll actually cost. No fear tactics, no 'safety scare' upsells." },
    ],
    relatedServices: ["diagnostics", "brakes", "general-repair"],
    tags: ["diagnostics", "noise", "clicking", "car problems", "cv joint"],
  },
  {
    slug: "check-engine-light-cleveland",
    title: "Check Engine Light On in Cleveland? Free Scan + Honest Answer",
    metaTitle: "Check Engine Light Cleveland — Free Code Scan | Nick's Tire & Auto",
    metaDescription: "Check engine light on in Cleveland? Free code scan at Nick's. Honest diagnosis, no upsell. We tell you what the code means AND what it'll actually cost to fix.",
    category: "Diagnostics",
    readTime: "5 min",
    heroImage: HERO,
    excerpt: "A check engine light can mean a $0 loose gas cap or a $1,500 catalytic converter. Here's how to know the difference, what the most common codes mean in Cleveland driving conditions, and when you need to stop driving NOW.",
    sections: [
      { heading: "Is It Safe to Drive With the Check Engine Light On?", body: "Solid light = you can usually drive to the shop safely. The engine thinks something's off but isn't in immediate danger. FLASHING light = active misfire, keep driving and you can destroy the catalytic converter ($1,500-$2,500 part). Pull over, shut the engine off, and call (216) 862-0005. If it's flashing, have it towed." },
      { heading: "Most Common Codes in Cleveland Vehicles", body: "P0420 — Catalytic Converter Below Efficiency. Common in vehicles 8+ years old or those that sat during winter. Cost: $400-$1,200 for a cat, $60-$150 for upstream O2 sensor (often the real cause). P0171/P0174 — System Too Lean. Usually a vacuum leak, failing MAF sensor, or dirty fuel injectors. Cost: $150-$450. P0300 — Random Misfire. Could be spark plugs ($120-$200), ignition coils ($150-$450), or fuel issues. P0442/P0456 — EVAP Leak. Loose gas cap ($0-$20) or a cracked hose ($150-$300). Ohio E-Check fails most often on P0420 and P0442." },
      { heading: "Why Your Gas Cap Could Be a $0 Fix", body: "Seriously. About 1 in 10 check engine lights is just a loose gas cap triggering an EVAP code. Tighten the cap until it clicks 3 times, drive for a day, and the light may reset on its own. If it doesn't reset after 3 drive cycles, bring it in — the gas cap itself may be damaged and we can replace it for $15-$25 vs a full EVAP diagnosis." },
      { heading: "How Ohio E-Check Testing Works With the Light On", body: "If your check engine light is on, Ohio E-Check will automatically FAIL your vehicle — no emissions measurement happens. The readiness monitors (which verify the OBD-II system is working) must be complete AND the light must be off to pass. Fresh battery disconnect can reset monitors to 'not ready' which ALSO fails. We fix the underlying issue, verify readiness, and you re-test. Most E-Check repairs run $150-$600 at Nick's." },
      { heading: "Our Free Code Scan Process", body: "Pull up anytime during business hours. We plug in the OBD-II scanner, read every stored and pending code, explain what each one means in plain English, and give you an honest estimate if repair is needed. No charge, no pressure, no 'we found 14 other problems' upsell nonsense. If you need the full diagnostic (live data, sensor testing, wiring check), that's $95 — and it applies to the repair if you have us fix it." },
      { heading: "Why Honesty Matters Here", body: "Some shops use the check engine light as a fishing expedition — scan the code, quote the worst-case fix, hope you don't shop around. Nick's doesn't work that way. We've had customers come in with a 'you need a new transmission' quote from another shop only for us to find a loose transmission speed sensor wire ($85 fix). Before you authorize major engine work, get a second opinion. Walk in at 530 E 185th St, Euclid, or call (216) 862-0005 — free code scan always." },
    ],
    relatedServices: ["diagnostics", "emissions", "general-repair"],
    tags: ["check engine light", "diagnostics", "OBD", "emissions", "E-Check"],
  },
  {
    slug: "brakes-grinding-what-to-do",
    title: "Brakes Grinding? Here's How Bad It Actually Is (And Real Cost to Fix)",
    metaTitle: "Brakes Grinding Noise Cleveland — Brake Repair from $149 | Nick's Tire",
    metaDescription: "Brakes grinding when you stop? Metal-on-metal is an emergency. Free inspection + honest repair at Nick's Tire & Auto, Cleveland. Brake pads from $149.",
    category: "Brakes",
    readTime: "5 min",
    heroImage: HERO,
    excerpt: "Grinding brakes aren't a noise to ignore — it's metal on metal. Here's what's actually happening, why it gets expensive fast, and what it'll realistically cost at a Cleveland shop that won't scare you into extra work.",
    sections: [
      { heading: "What the Grinding Actually Is", body: "Your brake pads have a wear indicator — a small metal tab that screams when the pad gets thin. Ignore that squeal for too long, and the pad wears all the way through to the metal backing plate. Once the backing plate is hitting the rotor, that's the grinding sound — metal on metal, every time you brake. Each stop is cutting grooves into your rotor. What WAS a $149 pad replacement becomes a $329 pads + rotors job, or worse if you've scored the caliper too ($449+)." },
      { heading: "How Long Can You Drive Like This?", body: "Short answer: don't. Longer answer: you can usually drive a few miles to the shop, but NOT at highway speeds and NOT in stop-and-go traffic. The braking distance is longer, the brake fluid is overheating, and there's real risk of the caliper seizing if a piston binds. If you're more than 5 miles away, call (216) 862-0005 and we'll tell you whether to drive in or have it towed. A tow is $75. A caliper is $200+. Math is easy." },
      { heading: "What a Real Brake Job Costs in Cleveland", body: "Honest pricing, no tricks: Pads only (most common, caught early): $149-$199 per axle. Pads + rotors (grinding stage): $329-$429 per axle. Full brake job with calipers (severely neglected): $449-$650 per axle. European vehicles (BMW, Audi, Mercedes) and performance packages run 30-50% more due to parts. At Nick's you'll get the exact number AFTER the free inspection — not before we see the car." },
      { heading: "Why Cheap Brake Jobs Are a Trap", body: "If you see 'brakes $99' ads, read the fine print. Usually that price is pad-only, cheapest possible Chinese pad, labor only on the easy side, and everything that's actually causing your problem (rotor, hardware, lubrication) is an upsell. A proper brake job includes ceramic or semi-metallic pads matched to your vehicle, caliper slide lubrication, brake fluid top-off, and a test drive. That's what $149 at Nick's gets you — no bait-and-switch." },
      { heading: "Signs You Need to Come in Right Now", body: "Metal grinding every time you brake = today. Pedal goes to the floor or feels spongy = today (possible fluid leak or master cylinder). Pulling left or right when braking = today (stuck caliper). Red brake warning light on dash = today (hydraulic failure). Squealing = this week. Brake dust all over one wheel = this month. Anything that's gotten worse in the last 3 days = today." },
      { heading: "What Happens If You Wait", body: "Pad wears to backing plate → rotor gets scored → caliper piston drags → caliper seizes → overheated fluid boils → total brake failure. That progression is 2-8 weeks from first grinding sound to 'I couldn't stop at the light' depending on driving conditions. Cost progression: $149 → $329 → $449 → $650 → insurance claim. Nick's Tire & Auto does free brake inspections with no obligation. Walk in at 530 E 185th St, Euclid, or call (216) 862-0005." },
    ],
    relatedServices: ["brakes", "diagnostics", "general-repair"],
    tags: ["brakes", "grinding", "brake repair", "safety"],
  },
  {
    slug: "tire-shop-near-me-open-now",
    title: "Need a Tire Shop Near You? Open Now in Cleveland at Nick's",
    metaTitle: "Tire Shop Near Me Open Now Cleveland — Nick's Tire & Auto (216) 862-0005",
    metaDescription: "Tire shop near me open now in Cleveland? Nick's Tire & Auto — 530 E 185th St, Euclid. Walk-ins 7 days, new & used tires from $60, free install, 30-min service.",
    category: "Tires",
    readTime: "3 min",
    heroImage: HERO,
    excerpt: "Got a flat? Bad tire? Need a set before the weather turns? Here's where to go in Cleveland right now — and what to expect when you get there.",
    sections: [
      { heading: "Open 7 Days a Week", body: "Nick's Tire & Auto at 530 E 185th St, Euclid OH is open Monday through Saturday 8 AM to 6 PM, Sunday 9 AM to 4 PM. Walk-ins welcome, no appointment needed for tires, oil changes, or quick service. If it's outside those hours, leave a voicemail at (216) 862-0005 and we'll call first thing." },
      { heading: "What You'll Find at Nick's", body: "New and used tires stocked in 12+ common sizes. Economy new tires from $85 installed, premium (Michelin, Bridgestone, Continental) from $150. Used tires from $40 — we hand-inspect every one before mounting (minimum 5/32\" tread, no sidewall damage). Flat repair from $25. 4-wheel alignment from $129. Tire rotation free if you bought the tires here." },
      { heading: "How Long the Wait Will Be", body: "Most single-tire jobs done in 20-30 minutes walk-in. Full 4-tire installs 45-60 minutes. If you're in a hurry, call (216) 862-0005 before you leave — we can have your exact size pulled and a bay ready. On Saturdays we're busiest 10 AM - 2 PM; Sunday mornings and weekday afternoons are fastest." },
      { heading: "What's Included When You Buy Tires Here", body: "Every new or used tire purchase at Nick's includes: mounting and balancing, valve stem replacement, TPMS sensor reset, old tire disposal, 12-month free flat repair, free alignment check (we'll tell you if you need the full alignment — no surprise $129 charge), and a test drive to confirm smooth balance. That's the whole sticker price. No hidden fees." },
      { heading: "Financing If Money's Tight", body: "Nobody plans for a blown tire on a Wednesday. We offer $0 down financing through Snap Finance, Acima, and Koalafi — 2-minute approval, no hard credit check, most customers qualify for $500-$5,000. Means you can get 4 new tires for $89/month instead of $600 right now. Apply at the counter or ahead of time on our financing page." },
      { heading: "Directions and Parking", body: "We're at 530 E 185th St, Euclid, OH 44119 — right off I-90 at the East 185th exit, about 15 minutes from downtown Cleveland, 10 minutes from Lakewood, 8 minutes from Euclid, 5 minutes from Collinwood. Plenty of free parking on-site. Drop-off welcome — call us or tap the Uber button in our shop door if you need a ride home. Call (216) 862-0005 with any questions before you head over." },
    ],
    relatedServices: ["tires", "alignment", "general-repair"],
    tags: ["tires", "open now", "tire shop", "cleveland", "walk-in"],
  },
  {
    slug: "synthetic-vs-conventional-oil-which-do-you-need",
    title: "Synthetic vs Conventional Oil: Which Does Your Car Actually Need?",
    metaTitle: "Synthetic vs Conventional Oil — Which is Right? Cleveland Oil Change | Nick's",
    metaDescription: "Synthetic or conventional oil for your car? Honest guide to which one your engine actually needs. Cleveland oil change at Nick's Tire & Auto from $39.",
    category: "Maintenance",
    readTime: "5 min",
    heroImage: HERO,
    excerpt: "Synthetic oil costs 60% more than conventional. Is it worth it for YOUR car? The honest answer depends on the year, engine type, and how you drive — not what the oil change chain tells you.",
    sections: [
      { heading: "The Quick Answer", body: "If your car is 2012 or newer, your manufacturer almost certainly calls for synthetic or synthetic blend — using conventional in a modern engine designed for synthetic will cost you more in the long run (sludge, deposits, shorter engine life). If your car is 2005 or older and you change oil every 3,000 miles religiously, conventional is fine. In between? Synthetic blend is the sweet spot. We check your owner's manual and make a real recommendation based on your engine, not commission." },
      { heading: "What Synthetic Actually Does Better", body: "Synthetic oil is chemically engineered with uniform molecules, so it flows faster when cold (critical in Cleveland winters — an engine running on thick cold oil for 30 seconds is doing damage every start), resists breakdown at high temperatures (stop-and-go traffic generates extreme heat), and maintains its protective properties for 7,500-10,000 miles vs conventional's 3,000-5,000. The result: less wear on cams, bearings, and turbochargers. If you drive a turbo engine (common in modern cars), synthetic is non-negotiable — conventional will coke inside the turbo and destroy it." },
      { heading: "What Conventional Is Fine For", body: "Older engines (pre-2010) that were designed for conventional. Low-mileage seasonal drivers (classic cars, summer-only vehicles). Engines with minor leaks where the thicker conventional oil seeps less than thin synthetic. And budget-conscious drivers who reliably do 3,000-5,000 mile changes — conventional costs $39.99 at Nick's vs $69.99 for full synthetic. Over a year of 12,000 miles, that's $160 conventional (4 changes) vs $140 synthetic (2 changes). So the real savings is time and engine wear, not just money." },
      { heading: "Synthetic Blend — The Middle Ground", body: "Synthetic blend mixes synthetic and conventional oil — better protection than conventional, cheaper than full synthetic. Most modern cars from 2008-2014 call for it specifically. Expect 5,000-7,500 mile intervals. Cost at Nick's: $54.99. For most Cleveland daily drivers with mid-age vehicles, this is the highest value option. We don't push people into full synthetic if blend is what your car actually needs." },
      { heading: "How Often Should You Change It?", body: "Owner's manual is the final word, but general guidelines: Conventional: every 3,000-5,000 miles or 3 months. Synthetic blend: every 5,000-7,500 miles or 6 months. Full synthetic: every 7,500-10,000 miles or 6 months. Severe conditions (short trips, cold weather, trailer towing, extreme heat): cut those intervals by 25%. We check the manufacturer spec for your vehicle and print it on your receipt so you know exactly when to come back." },
      { heading: "Why Nick's Recommendation Is Different", body: "Most chain oil-change shops push whatever has the highest margin. We don't work that way. Your engine's correct oil spec is non-negotiable — wrong viscosity, wrong specification, and your warranty is void. We check the manual, tell you what your manufacturer calls for, and that's what goes in. Nothing else. Every oil change at Nick's also includes a free multi-point inspection — so small issues get caught when they're still cheap to fix. Walk in at 530 E 185th St, Euclid or call (216) 862-0005." },
    ],
    relatedServices: ["synthetic-oil-change", "oil-change", "general-repair"],
    tags: ["oil change", "synthetic", "maintenance", "engine care"],
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
await conn.end();
