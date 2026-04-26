// Second blog-seeding batch (3 posts, 2026-04-24).
//
// Pulled from GSC queries with clear buy-intent that no existing page
// covers well:
//   "how long do brakes last"     — maintenance/budget curiosity
//   "ac not blowing cold"         — emergency/summer intent
//   "do i need new tires"         — buy-intent just before purchase
//
// Each post: ~800-1000 words, local Cleveland angle, real diagnostic
// value, price anchors, clear CTA to service pages. No AI-slop.
//
// Safe to re-run — upserts on slug match.

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
    slug: "how-long-should-brakes-last",
    title: "How Long Should Brakes Last in Cleveland? (Honest Answer, Real Numbers)",
    metaTitle: "How Long Do Brakes Last? Cleveland Brake Repair | Nick's Tire & Auto",
    metaDescription: "How long should your brakes last? Honest mileage expectations, what kills them faster in Cleveland, and when to replace. Brake repair from $149 at Nick's.",
    category: "Brakes",
    readTime: "6 min",
    heroImage: HERO,
    excerpt: "Brake life isn't a fixed number — it ranges from 25,000 to 70,000 miles depending on driving style, car weight, and Cleveland road conditions. Here's what actually matters and how to tell when yours need replacing.",
    sections: [
      { heading: "The Short Answer", content: "Most cars get between 30,000 and 60,000 miles on a set of brake pads under normal driving. City commuters often see 25,000-40,000. Highway-heavy drivers can stretch to 50,000-70,000. Cleveland roads are harder on brakes than average — cold starts, salt corrosion, and the potholes force more aggressive stopping. Plan on inspection every 15,000 miles to avoid being caught off guard." },
      { heading: "What Actually Kills Your Brakes Faster", content: "Driving style matters most. Habitual late, hard braking wears pads 2-3x faster than steady, predictive stopping. Riding the brake on downhills (instead of downshifting or engine-braking) overheats the pad material. Heavy vehicles (SUVs, pickup trucks) chew through pads faster because they need more force to stop. Cleveland-specific accelerators: winter road salt corroding caliper slides, stop-and-go I-90 traffic, short trips where brakes never reach optimal temperature (leads to glazing). Electric vehicles stretch pad life to 80,000+ miles because regenerative braking does most of the work — but their rotors can rust from underuse (a different problem)." },
      { heading: "Rotors Don't Last Forever Either", content: "Rotors usually make it through 2-3 pad changes if they're good quality. At each pad replacement we measure rotor thickness vs manufacturer minimum. If the rotor is below spec OR has deep grooves from a previously-worn-through pad, we replace them. Cleveland salt is rough on rotors — pitting and rust grooves show up faster than in dry climates. Pads + rotors together runs $329-$429 per axle at Nick's vs $149-$199 for pads alone." },
      { heading: "Signs You're Getting Close", content: "Squealing when you apply brake pressure — pad wear indicators are designed to shriek at about 3mm pad thickness (new pads are 10-12mm). Longer stopping distance or 'soft' pedal feel — could mean pads thin enough that caliper piston is over-extended. Brake dust caked on one wheel but not the other — sticky caliper dragging the pad, wears it out 4x faster. Vibration through the steering wheel when braking from highway speed — rotor warping, usually from overheating. Visible pad thickness under 3mm (you can see through the wheel spokes). Any of these = come in for a free inspection. Waiting until grinding = pad is zero, now you're cutting the rotor and costs jump." },
      { heading: "How to Extend Brake Life", content: "Look further ahead and brake gently — you can save 30-40% on wear just from predictive driving. Don't ride the pedal on downhills (use lower gear instead). Address alignment issues promptly — a pulling car chews the inside edge of one pad. Rinse your car off in winter to get salt off the underside (brakes included). Rotate tires on schedule — uneven tire wear puts uneven load on brakes. Get brakes inspected every oil change at Nick's — we do it free, and catching thin pads early means you replace pads only ($149) instead of pads + rotors ($329)." },
      { heading: "Get Your Brakes Checked", content: "Walk in any day at Nick's Tire & Auto, 17625 Euclid Ave, Cleveland OH. Free inspection — no obligation, no fear-tactics. We measure actual pad thickness and rotor wear, show you the numbers, and give you a real estimate only if service is needed. Most brake jobs done same-day. Call (216) 862-0005 or book online. We show you the problem before we fix it." },
    ],
    relatedServices: ["brakes", "diagnostics", "general-repair"],
    tags: ["brakes", "maintenance", "brake life", "brake repair", "cleveland"],
  },
  {
    slug: "car-ac-not-blowing-cold",
    title: "Car AC Not Blowing Cold? Real Causes and What They Cost to Fix",
    metaTitle: "Car AC Not Blowing Cold in Cleveland? | Nick's Tire & Auto",
    metaDescription: "Car AC not cold? Here's what's actually wrong (refrigerant, compressor, blend door, electrical) and what each fix costs. Same-day AC repair in Cleveland.",
    category: "AC Repair",
    readTime: "5 min",
    heroImage: HERO,
    excerpt: "AC that blows warm air has about six possible causes, ranging from a $60 recharge to a $1,200 compressor. Here's how to tell them apart and what you'll actually pay at a Cleveland shop that won't upsell you.",
    sections: [
      { heading: "Start With the Cheapest Fix", content: "Low refrigerant is the most common cause of weak or warm AC. Refrigerant slowly leaks out over years through tiny seals and hoses. If your AC worked fine last summer and is weak this year, this is likely it. Cost: $80-$150 for a recharge with UV dye (the dye helps us find any leak for future repair). A recharge isn't a permanent fix if there's a real leak — expect it to last 1-3 years depending on leak size. If it's empty again in 3 months, the leak needs actual repair." },
      { heading: "If the Compressor Won't Engage", content: "When you turn the AC on, listen for a click under the hood — that's the compressor clutch engaging. No click = the compressor isn't getting power. Causes: bad relay ($45 + $45 labor), bad clutch coil ($200-$400 total), failed pressure switch (low refrigerant safety cutoff — comes back when you recharge), or the compressor itself has seized ($800-$1,400 with parts + labor). We diagnose this in 15 minutes with the right tools." },
      { heading: "Blend Door Stuck (Most Annoying)", content: "If cold air comes out the driver vent but warm air on the passenger side (or vice-versa), or you can hear clicking/tapping behind the dash when you change temperature — that's a failing blend door actuator. Small electric motor that directs air through either the heater core or AC evaporator. Cost: $150-$350 depending on which door. On some vehicles the actuator is a nightmare to reach (half the dash has to come out) — others are a 20-minute job." },
      { heading: "Cabin Air Filter Clogged", content: "Often overlooked. A blocked cabin air filter reduces airflow, so even cold air feels weak. Cost: $30-$60 to replace (and we do it free with any AC service). If your AC is cold at the vents but weak in volume, check this first. Swap interval: every 15,000-20,000 miles or annually. Cleveland pollen seasons clog them faster." },
      { heading: "The Bigger Problems", content: "Evaporator leak (inside the dash): $600-$1,500, labor-heavy. Condenser damage (usually from road debris on the front of the car): $400-$700. Compressor failure: $800-$1,400. Control module failure: $300-$600. All of these show on a diagnostic — no guessing. At Nick's, we quote you the exact problem and exact cost BEFORE doing the work. No surprise-bill tactics." },
      { heading: "Summer-Ready Inspection", content: "Cleveland summers reach 85-90°F with high humidity. An AC that's 'mostly OK' in May becomes torture in July. If yours is weak, get it diagnosed now, not in the first heatwave when wait times triple. Free AC inspection at Nick's — we pressure-test, check compressor engagement, UV-dye scan for leaks, and inspect the cabin filter. Walk in any day at 17625 Euclid Ave, Cleveland OH. (216) 862-0005." },
    ],
    relatedServices: ["ac-repair", "diagnostics", "general-repair"],
    tags: ["ac repair", "car ac", "refrigerant", "compressor", "summer"],
  },
  {
    slug: "signs-you-need-new-tires",
    title: "6 Signs You Actually Need New Tires (Not What the Shop Tells You)",
    metaTitle: "Do I Need New Tires? 6-Point Check | Cleveland Tires | Nick's",
    metaDescription: "How to tell if you really need new tires. Real signs vs shop-upsell tactics. Tread depth, sidewall damage, age, vibration, handling. New & used tires from $60.",
    category: "Tires",
    readTime: "5 min",
    heroImage: HERO,
    excerpt: "Tires are the one thing between your car and the road, and bad ones don't just get worse — they become dangerous fast in wet or icy conditions. Here's how to actually tell if you need replacements, not just what a shop trying to sell you tires will say.",
    sections: [
      { heading: "The Penny Test (and Why It's Outdated)", content: "Classic advice: stick a penny head-down in the tread. If you can see all of Lincoln's head, your tread is under 2/32\" and you need new tires. Problem: 2/32\" is the LEGAL minimum, not the SAFE minimum. Studies show stopping distance in rain doubles between 4/32\" and 2/32\". Use a quarter instead — if the top of Washington's head is visible, you're under 4/32\" and it's time to plan for replacement (still safe-ish but getting risky in rain). Come in for a free tread-depth measurement; we use a real gauge, not coins." },
      { heading: "Uneven Wear Patterns Tell a Story", content: "If your tires wear more in the center — over-inflation (or high-speed highway driving). More on the edges — under-inflation. One edge only — alignment is off. Patchy/cupped wear — worn shocks or out-of-balance. Replacement is needed if the wear pattern has eaten through the safe tread depth, BUT you also need to fix the underlying cause or new tires wear the same way. At Nick's every tire install includes a free alignment check." },
      { heading: "Sidewall Damage = Always Replace", content: "Tread damage can sometimes be patched. Sidewall damage can NEVER be safely repaired — the sidewall flexes as you drive, so a patch would fail at highway speed. Look for: bulges (cord damage, imminent blowout), cracks (age-related, dry rot), visible cuts deeper than a shallow scratch, or deep scuffs from curb hits. Any of these = replace that tire immediately. If one tire has sidewall damage on AWD or 4WD, some manufacturers require replacing all 4 to preserve drivetrain balance." },
      { heading: "Tires Age Out Even If the Tread Looks Fine", content: "Rubber hardens with age regardless of mileage. Most tire manufacturers recommend replacement at 6 years, and many consider 10 years an absolute max. Look at the DOT code on the sidewall — last 4 digits are week/year (e.g., '2220' = 22nd week of 2020). Cleveland weather (hot summers + freezing winters + salt) ages tires faster than moderate climates. If your tires are 8+ years old with shallow but not-yet-illegal tread, your grip in rain or snow is a fraction of what it was new." },
      { heading: "Handling Changes You Shouldn't Ignore", content: "Car pulling to one side: alignment OR uneven tire wear OR a bad tire with internal damage. Vibration at highway speed: tire out of balance OR belt separation inside a tire (dangerous — could throw tread at 70mph). Squealing in turns: worn tires losing grip at lower lateral G's. Hydroplaning more than it used to: tread is gone even if it doesn't LOOK gone. Any of these = get them inspected. Don't just assume the alignment is off; sometimes a new tire fixes it." },
      { heading: "New vs Used at Nick's", content: "New tires from $85 installed at Nick's (economy) to $150+ for premium brands (Michelin, Bridgestone, Continental). Used tires from $40 — we hand-inspect every one, minimum 5/32\" tread, no sidewall damage, no patches, no dry rot. Used is a good option for older cars you don't plan to keep or as a short-term bridge until a full new set. If your tires are near end-of-life, come in for a free inspection at 17625 Euclid Ave, Cleveland OH. We show you the tread, explain the options, and quote the real number. (216) 862-0005. No appointment needed." },
    ],
    relatedServices: ["tires", "alignment", "tire-shop-near-me"],
    tags: ["tires", "new tires", "used tires", "tire safety", "tread depth"],
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
