/**
 * ROUTE REGISTRY — Single Source of Truth for all public routes.
 * Used by: prerender script, sitemap generator, robots.txt, navigation.
 *
 * IMPORTANT: When adding a new route, add it here first, then in App.tsx.
 * The sitemap and prerender script both read from this file.
 */

export interface RouteEntry {
  path: string;
  /** Sitemap priority (0.0–1.0) */
  priority: number;
  /** Sitemap change frequency */
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** SEO title tag — max 60 chars */
  title: string;
  /** SEO meta description — max 160 chars */
  description: string;
  /** Group for organizational purposes */
  group: "core" | "service" | "city" | "neighborhood" | "seo-service" | "vehicle" | "problem" | "seasonal" | "utility" | "legal" | "landing" | "blog";
  /** Whether to include in sitemap (false for auth-gated, landing pages, etc.) */
  sitemap: boolean;
  /** Whether to prerender this page */
  prerender: boolean;
}

// ─── CORE PAGES ──────────────────────────────────────────
const CORE_PAGES: RouteEntry[] = [
  {
    path: "/",
    priority: 1.0,
    changefreq: "weekly",
    title: "Nick's Tire & Auto — Cleveland's #1 Tire Shop & Auto Repair",
    description: "Cleveland's top-rated new & used tire specialist + full-service auto repair. 1,685+ reviews, 4.9 stars. Free installation package ($289 value). Walk-ins 7 days. Financing.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/services",
    priority: 0.9,
    changefreq: "weekly",
    title: "Auto Repair Services — Nick's Tire & Auto",
    description: "Full-service auto repair in Cleveland. Tires, brakes, diagnostics, emissions, oil changes, suspension, alignment. Walk-ins welcome. Financing available.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/about",
    priority: 0.7,
    changefreq: "monthly",
    title: "About Nick's Tire & Auto — Cleveland Auto Shop",
    description: "Family-owned auto repair in Cleveland since 2018. Honest service, transparent pricing, 4.9-star reviews. Meet the team behind Northeast Ohio's top-rated shop.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/contact",
    priority: 0.8,
    changefreq: "monthly",
    title: "Contact Nick's Tire & Auto — Cleveland OH",
    description: "Visit Nick's Tire & Auto at 17625 Euclid Ave, Cleveland, OH 44112. Call (216) 862-0005. Open Mon-Sat 8AM-6PM, Sun 9AM-4PM. Walk-ins welcome.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/reviews",
    priority: 0.7,
    changefreq: "weekly",
    title: "Reviews — Nick's Tire & Auto Cleveland",
    description: "Read 1,685+ Google reviews for Nick's Tire & Auto. 4.9-star rating. See why Cleveland trusts us for tires, brakes, diagnostics, and auto repair.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/faq",
    priority: 0.7,
    changefreq: "monthly",
    title: "FAQ — Nick's Tire & Auto Cleveland",
    description: "Common questions about auto repair at Nick's Tire & Auto. Pricing, walk-in policy, financing, tire installation, diagnostics, and more. Cleveland, OH.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/blog",
    priority: 0.7,
    changefreq: "weekly",
    title: "Auto Care Blog — Nick's Tire & Auto Cleveland",
    description: "Car care tips, maintenance guides, and auto repair advice from Nick's Tire & Auto. Expert insights for Cleveland drivers.",
    group: "blog",
    sitemap: true,
    prerender: true,
  },
];

// ─── SERVICE PAGES ───────────────────────────────────────
const SERVICE_PAGES: RouteEntry[] = [
  {
    path: "/tires",
    priority: 1.0,
    changefreq: "weekly",
    title: "Tire Shop Cleveland OH — New & Used Tires | Nick's Tire",
    description: "Cleveland's #1 new & used tire shop. Buy tires online — free premium installation ($289 value). Flat repair $15. Every tire inspected. Walk-ins 7 days. $10 down financing.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/brakes",
    priority: 0.9,
    changefreq: "monthly",
    title: "Brake Repair Cleveland OH — Nick's Tire & Auto",
    description: "Expert brake repair in Cleveland. Pads, rotors, calipers, ABS diagnostics. Honest diagnosis before any repair. 4.9 stars. Financing available.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/diagnostics",
    priority: 0.9,
    changefreq: "monthly",
    title: "Engine Diagnostics Cleveland — Nick's Tire & Auto",
    description: "Check engine light on? Expert OBD-II diagnostics in Cleveland. We pinpoint the exact cause. 4.9 stars, 1,685+ reviews. Walk-ins welcome.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/emissions",
    priority: 0.9,
    changefreq: "monthly",
    title: "Emissions Testing Cleveland OH — Nick's Tire & Auto",
    description: "Ohio E-Check and emissions repair in Cleveland. O2 sensors, catalytic converters, EVAP systems. We get you passing. Walk-ins welcome.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/oil-change",
    priority: 0.8,
    changefreq: "monthly",
    title: "Oil Change Cleveland OH — Nick's Tire & Auto",
    description: "Quick, affordable oil changes in Cleveland. Conventional and synthetic. Filter replacement included. No appointment needed. Walk-ins welcome.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/general-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Cleveland OH — Nick's Tire & Auto",
    description: "Full-service auto repair in Cleveland. Engine, transmission, electrical, cooling, exhaust, belts, hoses. Honest diagnosis. Financing available.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/alignment",
    priority: 0.8,
    changefreq: "monthly",
    title: "Wheel Alignment Cleveland OH — Nick's Tire & Auto",
    description: "Professional wheel alignment in Cleveland. Fix pulling, uneven tire wear, and steering issues. State-of-the-art equipment. Walk-ins welcome.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/tires/info",
    priority: 0.8,
    changefreq: "monthly",
    title: "Tire Services Cleveland — New & Used | Nick's Tire & Auto",
    description: "Cleveland's largest new & used tire selection. Free mounting, balancing, TPMS reset, alignment check with every tire. Flat repair from $15. Walk-ins welcome 7 days.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  { path: "/ac-repair", priority: 0.8, changefreq: "monthly", title: "AC Repair Cleveland OH — Nick's Tire & Auto", description: "Auto AC and heating repair in Cleveland. Recharge, compressor, condenser, evaporator, heater core. Same-day service. Walk-ins welcome.", group: "service", sitemap: true, prerender: true },
  { path: "/transmission", priority: 0.8, changefreq: "monthly", title: "Transmission Repair Cleveland OH — Nick's Tire & Auto", description: "Transmission repair and service in Cleveland. Fluid changes, diagnostics, solenoid repair, rebuilds. Honest diagnosis. Walk-ins welcome.", group: "service", sitemap: true, prerender: true },
  { path: "/electrical", priority: 0.8, changefreq: "monthly", title: "Auto Electrical Repair Cleveland — Nick's Tire & Auto", description: "Auto electrical repair in Cleveland. Battery, alternator, starter, wiring, power windows. Expert diagnostics. Walk-ins welcome.", group: "service", sitemap: true, prerender: true },
  { path: "/battery", priority: 0.8, changefreq: "monthly", title: "Battery Testing & Replacement Cleveland — Nick's Tire", description: "Free car battery testing in Cleveland. Same-day replacement. Charging system check included. All makes and models. Walk-ins welcome.", group: "service", sitemap: true, prerender: true },
  { path: "/exhaust", priority: 0.8, changefreq: "monthly", title: "Exhaust & Muffler Repair Cleveland — Nick's Tire & Auto", description: "Exhaust and muffler repair in Cleveland. Catalytic converter, exhaust pipe, manifold. Pass Ohio E-Check. Same-day service.", group: "service", sitemap: true, prerender: true },
  { path: "/cooling", priority: 0.8, changefreq: "monthly", title: "Cooling System Repair Cleveland — Nick's Tire & Auto", description: "Cooling system and radiator repair in Cleveland. Water pump, thermostat, coolant flush, hoses. Don't risk overheating. Walk-ins welcome.", group: "service", sitemap: true, prerender: true },
  { path: "/pre-purchase-inspection", priority: 0.8, changefreq: "monthly", title: "Pre-Purchase Car Inspection Cleveland — Nick's Tire", description: "Used car inspection in Cleveland before you buy. 150+ point check. Written report with photos. Know what you're buying.", group: "service", sitemap: true, prerender: true },
  { path: "/belts-hoses", priority: 0.7, changefreq: "monthly", title: "Belt & Hose Replacement Cleveland — Nick's Tire & Auto", description: "Serpentine belt, timing belt, and hose replacement in Cleveland. Prevent breakdowns. Fair prices. Walk-ins welcome.", group: "service", sitemap: true, prerender: true },
  { path: "/starter-alternator", priority: 0.8, changefreq: "monthly", title: "Starter & Alternator Repair Cleveland — Nick's Tire", description: "Starter and alternator repair in Cleveland. Free charging system test. Same-day replacement. All makes and models.", group: "service", sitemap: true, prerender: true },
];

// ─── CITY/AREA PAGES ─────────────────────────────────────
const CITY_PAGES: RouteEntry[] = [
  {
    path: "/cleveland-auto-repair",
    priority: 0.9,
    changefreq: "weekly",
    title: "Auto Repair Cleveland OH — Nick's Tire & Auto",
    description: "Cleveland's #1 auto repair shop and tire specialist. 1,685+ reviews, 4.9 stars. Tires, brakes, diagnostics, emissions. Walk-ins 7 days. $10 down financing.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/euclid-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Euclid OH — Nick's Tire & Auto",
    description: "Best auto repair in Euclid, OH. Nick's Tire & Auto on Euclid Ave — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics, emissions. Walk-ins welcome 7 days.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/lakewood-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Lakewood OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Lakewood, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes, diagnostics. 15 min from Lakewood.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/parma-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Parma OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Parma, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes, diagnostics. 20 min from Parma.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/east-cleveland-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair East Cleveland OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near East Cleveland, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 5 min from East Cleveland.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/shaker-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Shaker Heights OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Shaker Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes, diagnostics. 10 min drive.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/cleveland-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Cleveland Heights — Nick's Tire & Auto",
    description: "Top-rated auto repair near Cleveland Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 10 min drive.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/mentor-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Mentor OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Mentor, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes, diagnostics. 25 min from Mentor.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/strongsville-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Strongsville OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Strongsville, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes. 30 min from Strongsville.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/south-euclid-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair South Euclid OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near South Euclid, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 10 min from South Euclid.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/garfield-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Garfield Heights OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Garfield Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 15 min drive.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/richmond-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Richmond Heights OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Richmond Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. Minutes away.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/lyndhurst-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Lyndhurst OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Lyndhurst, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes, diagnostics. 10 min drive.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/willoughby-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Willoughby OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Willoughby, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, oil changes, diagnostics. 20 min drive.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/maple-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Maple Heights OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Maple Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 15 min via Dunham Rd.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/bedford-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Near Bedford OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Bedford, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 18 min via Rockside Rd & I-480.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/warrensville-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Warrensville Heights OH — Nick's Tire & Auto",
    description: "Top-rated auto repair near Warrensville Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 12 min drive.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
];

// ─── NEIGHBORHOOD MICRO-PAGES ────────────────────────────
const NEIGHBORHOOD_PAGES: RouteEntry[] = [
  { path: "/east-185th-street-auto-repair", priority: 0.7, changefreq: "monthly", title: "Auto Repair East 185th St — Nick's Tire & Auto", description: "Auto repair near East 185th Street, Cleveland. Nick's Tire & Auto — minutes away. Tires, brakes, diagnostics, emissions. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/euclid-square-mall-area", priority: 0.7, changefreq: "monthly", title: "Auto Repair Euclid Square Mall Area — Nick's Tire", description: "Auto repair near Euclid Square Mall. Nick's Tire & Auto on Euclid Ave. Tires, brakes, diagnostics. Walk-ins welcome 7 days.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/richmond-heights-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic Richmond Heights OH — Nick's Tire & Auto", description: "Trusted mechanic near Richmond Heights, OH. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/collinwood", priority: 0.7, changefreq: "monthly", title: "Auto Repair Collinwood Cleveland — Nick's Tire & Auto", description: "Auto repair in Collinwood, Cleveland. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/nottingham", priority: 0.7, changefreq: "monthly", title: "Auto Repair Nottingham Cleveland — Nick's Tire & Auto", description: "Auto repair in Nottingham, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, oil changes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/five-points", priority: 0.7, changefreq: "monthly", title: "Auto Repair Five Points Cleveland — Nick's Tire & Auto", description: "Auto repair near Five Points, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics, emissions. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/waterloo-arts-district", priority: 0.7, changefreq: "monthly", title: "Auto Repair Waterloo Arts District — Nick's Tire", description: "Auto repair near Waterloo Arts District, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/shore-cultural-centre", priority: 0.7, changefreq: "monthly", title: "Auto Repair Shore Cultural Centre Area — Nick's Tire", description: "Auto repair near Shore Cultural Centre, Euclid. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/severance-town-center", priority: 0.7, changefreq: "monthly", title: "Auto Repair Severance Town Center — Nick's Tire", description: "Auto repair near Severance Town Center, Cleveland Heights. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/university-circle", priority: 0.7, changefreq: "monthly", title: "Auto Repair University Circle Cleveland — Nick's Tire", description: "Auto repair near University Circle, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/wickliffe", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Wickliffe OH — Nick's Tire & Auto", description: "Auto repair near Wickliffe, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 15 min drive.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/willowick", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Willowick OH — Nick's Tire & Auto", description: "Auto repair near Willowick, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 15 min drive.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/eastlake", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Eastlake OH — Nick's Tire & Auto", description: "Auto repair near Eastlake, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. 15 min drive.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/south-euclid-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic South Euclid OH — Nick's Tire & Auto", description: "Trusted mechanic near South Euclid, OH. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/lyndhurst-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic Lyndhurst OH — Nick's Tire & Auto", description: "Trusted mechanic near Lyndhurst, OH. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/mayfield-heights", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Mayfield Heights OH — Nick's Tire", description: "Auto repair near Mayfield Heights, OH. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/highland-heights", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Highland Heights OH — Nick's Tire", description: "Auto repair near Highland Heights, OH. Nick's Tire & Auto — 4.9 stars. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/beachwood", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Beachwood OH — Nick's Tire & Auto", description: "Auto repair near Beachwood, OH. Nick's Tire & Auto — 4.9 stars, 1,685+ reviews. Tires, brakes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
];

// ─── SEO SERVICE PAGES (long-tail keywords) ──────────────
const SEO_SERVICE_PAGES: RouteEntry[] = [
  { path: "/brake-repair-cleveland", priority: 0.8, changefreq: "monthly", title: "Brake Repair Cleveland OH — Nick's Tire & Auto", description: "Expert brake repair in Cleveland. Pads, rotors, calipers, ABS. Honest diagnosis before any repair. 4.9 stars, 1,685+ reviews. Walk-ins welcome.", group: "seo-service", sitemap: true, prerender: true },
  { path: "/check-engine-light-cleveland", priority: 0.8, changefreq: "monthly", title: "Check Engine Light On? Same-Day Diagnostics | Cleveland OH", description: "Check engine light on? We diagnose it fast with OBD-II scanners — no guesswork. Walk in today, get answers in minutes. 4.9 stars, 1,685+ reviews. Open 7 days. Call (216) 862-0005.", group: "seo-service", sitemap: true, prerender: true },
  { path: "/tire-repair-cleveland", priority: 0.9, changefreq: "monthly", title: "Tire Repair Cleveland OH — Nick's Tire & Auto", description: "Flat tire repair from $15 in Cleveland. Plug and patch in 15 min. Largest new & used tire selection. Free installation with purchase. Walk-ins 7 days.", group: "seo-service", sitemap: true, prerender: true },
  { path: "/suspension-repair-cleveland", priority: 0.8, changefreq: "monthly", title: "Suspension Repair Cleveland — Nick's Tire & Auto", description: "Suspension and steering repair in Cleveland. Struts, shocks, ball joints, tie rods. 4.9 stars. Financing available. Walk-ins welcome.", group: "seo-service", sitemap: true, prerender: true },
  { path: "/ac-repair-cleveland", priority: 0.8, changefreq: "monthly", title: "AC Repair Cleveland OH — Nick's Tire & Auto", description: "Auto AC repair in Cleveland. Recharge, compressor, condenser, evaporator. Stay cool this summer. 4.9 stars. Walk-ins welcome.", group: "seo-service", sitemap: true, prerender: true },
  { path: "/diagnostics-cleveland", priority: 0.8, changefreq: "monthly", title: "Auto Diagnostics Cleveland — Nick's Tire & Auto", description: "Advanced auto diagnostics in Cleveland. Computer scanning, electrical testing, drivability issues. We find the real problem. Walk-ins welcome.", group: "seo-service", sitemap: true, prerender: true },
];

// ─── VEHICLE MAKE PAGES ──────────────────────────────────
const VEHICLE_PAGES: RouteEntry[] = [
  { path: "/toyota-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Toyota Repair Cleveland OH — Nick's Tire & Auto", description: "Toyota repair specialists in Cleveland. Camry, Corolla, RAV4, Highlander. Factory-level diagnostics. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/honda-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Honda Repair Cleveland OH — Nick's Tire & Auto", description: "Honda repair specialists in Cleveland. Civic, Accord, CR-V, Pilot. Expert diagnostics. 4.9 stars, 1,685+ reviews. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/ford-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Ford Repair Cleveland OH — Nick's Tire & Auto", description: "Ford repair specialists in Cleveland. F-150, Explorer, Escape, Focus. Expert diagnostics. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/chevy-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Chevy Repair Cleveland OH — Nick's Tire & Auto", description: "Chevrolet repair specialists in Cleveland. Silverado, Equinox, Malibu, Traverse. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/nissan-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Nissan Repair Cleveland OH — Nick's Tire & Auto", description: "Nissan repair specialists in Cleveland. Altima, Rogue, Sentra, Pathfinder. Expert diagnostics. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/hyundai-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Hyundai Repair Cleveland OH — Nick's Tire & Auto", description: "Hyundai repair specialists in Cleveland. Elantra, Tucson, Sonata, Santa Fe. Expert diagnostics. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/kia-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Kia Repair Cleveland OH — Nick's Tire & Auto", description: "Kia repair specialists in Cleveland. Forte, Sportage, Sorento, Soul. Expert diagnostics. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/jeep-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Jeep Repair Cleveland OH — Nick's Tire & Auto", description: "Jeep repair specialists in Cleveland. Wrangler, Cherokee, Grand Cherokee, Compass. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/bmw-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "BMW Repair Cleveland OH — Nick's Tire & Auto", description: "BMW repair in Cleveland. 3 Series, 5 Series, X3, X5. European car specialists. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
  { path: "/dodge-ram-repair-cleveland", priority: 0.7, changefreq: "monthly", title: "Dodge & Ram Repair Cleveland — Nick's Tire & Auto", description: "Dodge and Ram repair in Cleveland. Charger, Challenger, Ram 1500. Expert diagnostics. 4.9 stars. Walk-ins welcome.", group: "vehicle", sitemap: true, prerender: true },
];

// ─── PROBLEM PAGES ───────────────────────────────────────
const PROBLEM_PAGES: RouteEntry[] = [
  { path: "/car-shaking-while-driving", priority: 0.7, changefreq: "monthly", title: "Car Shaking While Driving? — Nick's Tire & Auto", description: "Car shaking while driving? Common causes: tire balance, warped rotors, worn suspension. Expert diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/brakes-grinding", priority: 0.7, changefreq: "monthly", title: "Brakes Grinding? — Nick's Tire & Auto Cleveland", description: "Brakes grinding or squealing? Don't wait — worn pads damage rotors. Expert brake repair at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/check-engine-light-flashing", priority: 0.7, changefreq: "monthly", title: "Check Engine Light Flashing? — Nick's Tire & Auto", description: "Flashing check engine light means stop driving. Could be misfire or catalytic converter damage. Expert diagnostics in Cleveland. Call (216) 862-0005.", group: "problem", sitemap: true, prerender: true },
  { path: "/car-overheating", priority: 0.7, changefreq: "monthly", title: "Car Overheating? — Nick's Tire & Auto Cleveland", description: "Car overheating? Pull over immediately. Radiator, thermostat, water pump, or head gasket. Expert cooling system repair in Cleveland.", group: "problem", sitemap: true, prerender: true },
  { path: "/car-wont-start", priority: 0.7, changefreq: "monthly", title: "Car Won't Start? — Nick's Tire & Auto Cleveland", description: "Car won't start? Battery, starter, alternator, or ignition. Expert diagnostics at Nick's Tire & Auto, Cleveland. Walk-ins welcome 7 days.", group: "problem", sitemap: true, prerender: true },
  { path: "/steering-wheel-shaking", priority: 0.7, changefreq: "monthly", title: "Steering Wheel Shaking? — Nick's Tire & Auto", description: "Steering wheel shaking? Tire balance, alignment, or suspension issue. Expert diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/car-pulling-to-one-side", priority: 0.7, changefreq: "monthly", title: "Car Pulling to One Side? — Nick's Tire & Auto", description: "Car pulling left or right? Alignment, tire pressure, or brake issue. Expert diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/transmission-slipping", priority: 0.7, changefreq: "monthly", title: "Transmission Slipping? — Nick's Tire & Auto", description: "Transmission slipping or jerking? Don't ignore it — early repair saves thousands. Expert diagnostics in Cleveland. Call (216) 862-0005.", group: "problem", sitemap: true, prerender: true },
  { path: "/ac-not-blowing-cold", priority: 0.7, changefreq: "monthly", title: "AC Not Blowing Cold? — Nick's Tire & Auto Cleveland", description: "AC not blowing cold? Refrigerant, compressor, or condenser issue. Auto AC repair at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/battery-keeps-dying", priority: 0.7, changefreq: "monthly", title: "Battery Keeps Dying? — Nick's Tire & Auto Cleveland", description: "Battery keeps dying? Alternator, parasitic drain, or old battery. Expert electrical diagnostics at Nick's Tire & Auto, Cleveland.", group: "problem", sitemap: true, prerender: true },
  { path: "/grinding-noise-when-braking", priority: 0.7, changefreq: "monthly", title: "Grinding Noise When Braking? — Nick's Tire & Auto", description: "Grinding noise when braking? Worn pads, damaged rotors, or debris. Expert brake diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/oil-leak-under-car", priority: 0.7, changefreq: "monthly", title: "Oil Leak Under Car? — Nick's Tire & Auto Cleveland", description: "Oil leak under your car? Valve cover gasket, oil pan, or drain plug. Expert leak diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/check-engine-light-on", priority: 0.7, changefreq: "monthly", title: "Check Engine Light On? Top 5 Causes + What to Do Now", description: "Check engine light on? Most common causes: O2 sensor, catalytic converter, gas cap, ignition coils. Walk in for same-day diagnostics in Cleveland. (216) 862-0005.", group: "problem", sitemap: true, prerender: true },
];

// ─── SEASONAL PAGES ──────────────────────────────────────
const SEASONAL_PAGES: RouteEntry[] = [
  { path: "/winter-car-care-cleveland", priority: 0.7, changefreq: "monthly", title: "Winter Car Care Cleveland — Nick's Tire & Auto", description: "Prepare your car for Cleveland winter. Snow tires, battery testing, antifreeze, brakes. Winter car care at Nick's Tire & Auto.", group: "seasonal", sitemap: true, prerender: true },
  { path: "/summer-car-care-cleveland", priority: 0.7, changefreq: "monthly", title: "Summer Car Care Cleveland — Nick's Tire & Auto", description: "Summer car care in Cleveland. AC check, tire inspection, coolant, brakes. Keep your car running cool. Nick's Tire & Auto.", group: "seasonal", sitemap: true, prerender: true },
];

// ─── UTILITY PAGES ───────────────────────────────────────
const UTILITY_PAGES: RouteEntry[] = [
  {
    path: "/financing",
    priority: 0.8,
    changefreq: "weekly",
    title: "Auto Repair Financing Cleveland — Nick's Tire & Auto",
    description: "Auto repair financing in Cleveland. $10 down, drive today. Acima, Koalafi, Snap Finance, American First. All credit welcome. Apply in minutes.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/specials",
    priority: 0.8,
    changefreq: "weekly",
    title: "Deals & Specials — Nick's Tire & Auto Cleveland",
    description: "Current deals and coupons at Nick's Tire & Auto, Cleveland. Save on tires, brakes, oil changes, diagnostics. Updated weekly.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/diagnose",
    priority: 0.7,
    changefreq: "monthly",
    title: "AI Car Diagnostic Tool — Nick's Tire & Auto",
    description: "Describe your car problem and get an instant AI diagnosis. Free online tool from Nick's Tire & Auto, Cleveland. Know before you go.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/estimate",
    priority: 0.8,
    changefreq: "monthly",
    title: "Auto Repair Cost Estimator — Nick's Tire & Auto",
    description: "Get an instant repair cost estimate for your vehicle. Transparent pricing from Nick's Tire & Auto, Cleveland. No surprises.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/pricing",
    priority: 0.7,
    changefreq: "monthly",
    title: "Auto Repair Pricing — Nick's Tire & Auto Cleveland",
    description: "Transparent auto repair pricing at Nick's Tire & Auto, Cleveland. Get estimates for brakes, tires, oil changes, diagnostics, and more.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/fleet",
    priority: 0.7,
    changefreq: "monthly",
    title: "Fleet Auto Service Cleveland — Nick's Tire & Auto",
    description: "Fleet maintenance and repair in Cleveland. Volume discounts, priority scheduling, fleet reporting. Nick's Tire & Auto — 4.9 stars.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/rewards",
    priority: 0.6,
    changefreq: "monthly",
    title: "Rewards Program — Nick's Tire & Auto Cleveland",
    description: "Earn points on every service at Nick's Tire & Auto. Redeem for discounts on future repairs. Cleveland's best auto repair loyalty program.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/car-care-guide",
    priority: 0.6,
    changefreq: "monthly",
    title: "Car Care Guide — Nick's Tire & Auto Cleveland",
    description: "Complete car maintenance guide from Nick's Tire & Auto. When to change oil, check brakes, rotate tires, and more. Cleveland drivers' handbook.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/refer",
    priority: 0.5,
    changefreq: "monthly",
    title: "Referral Program — Nick's Tire & Auto Cleveland",
    description: "Refer a friend to Nick's Tire & Auto and you both save. Cleveland's best auto repair referral rewards.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/ask",
    priority: 0.6,
    changefreq: "weekly",
    title: "Ask a Mechanic — Nick's Tire & Auto Cleveland",
    description: "Ask our mechanics a question online. Free expert advice from Nick's Tire & Auto, Cleveland. Get answers before you visit.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/cost-estimator",
    priority: 0.8,
    changefreq: "monthly",
    title: "Repair Cost Estimator — Nick's Tire & Auto",
    description: "Estimate your auto repair cost online. Transparent pricing from Nick's Tire & Auto, Cleveland. Know the cost before you visit.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/status",
    priority: 0.5,
    changefreq: "monthly",
    title: "Check Repair Status — Nick's Tire & Auto",
    description: "Track your vehicle repair status online. Real-time updates from Nick's Tire & Auto, Cleveland.",
    group: "utility",
    sitemap: false, // auth-gated
    prerender: true,
  },
  {
    path: "/my-garage",
    priority: 0.5,
    changefreq: "monthly",
    title: "My Garage — Nick's Tire & Auto Cleveland",
    description: "Manage your vehicles and service history at Nick's Tire & Auto, Cleveland. Track maintenance schedules and upcoming services.",
    group: "utility",
    sitemap: false, // user-specific
    prerender: true,
  },
  {
    path: "/review",
    priority: 0.5,
    changefreq: "monthly",
    title: "Leave a Review — Nick's Tire & Auto Cleveland",
    description: "Share your experience at Nick's Tire & Auto, Cleveland. Your feedback helps us serve you better.",
    group: "utility",
    sitemap: false, // review generation page
    prerender: true,
  },
];

// ─── LEGAL PAGES ─────────────────────────────────────────
const LEGAL_PAGES: RouteEntry[] = [
  {
    path: "/privacy-policy",
    priority: 0.3,
    changefreq: "yearly",
    title: "Privacy Policy — Nick's Tire & Auto",
    description: "Privacy policy for nickstire.org. How we collect, use, and protect your information at Nick's Tire & Auto, Cleveland, OH.",
    group: "legal",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/terms",
    priority: 0.3,
    changefreq: "yearly",
    title: "Terms of Service — Nick's Tire & Auto",
    description: "Terms of service for nickstire.org. Usage terms for Nick's Tire & Auto website and services, Cleveland, OH.",
    group: "legal",
    sitemap: true,
    prerender: true,
  },
];

// ─── NON-SITEMAP PAGES (landing pages, admin, etc.) ──────
const EXCLUDED_PAGES: RouteEntry[] = [
  { path: "/portal", priority: 0, changefreq: "monthly", title: "Customer Portal — Nick's Tire & Auto", description: "Nick's Tire & Auto customer portal. View invoices, service history, and manage your account.", group: "utility", sitemap: false, prerender: false },
  { path: "/admin", priority: 0, changefreq: "monthly", title: "Admin Dashboard", description: "", group: "utility", sitemap: false, prerender: false },
  { path: "/admin/content", priority: 0, changefreq: "monthly", title: "Content Manager", description: "", group: "utility", sitemap: false, prerender: false },
  { path: "/lp/brakes", priority: 0, changefreq: "monthly", title: "Brake Repair Special — Nick's Tire & Auto", description: "Limited time brake repair special at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
  { path: "/lp/tires", priority: 0, changefreq: "monthly", title: "Tire Sale — Nick's Tire & Auto", description: "Limited time tire sale at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
  { path: "/lp/diagnostics", priority: 0, changefreq: "monthly", title: "Diagnostics Special — Nick's Tire & Auto", description: "Limited time diagnostics special at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
  { path: "/lp/emergency", priority: 0, changefreq: "monthly", title: "Emergency Auto Repair — Nick's Tire & Auto", description: "Emergency auto repair at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
];

// ─── COMBINED REGISTRY ───────────────────────────────────

export const ALL_ROUTES: RouteEntry[] = [
  ...CORE_PAGES,
  ...SERVICE_PAGES,
  ...CITY_PAGES,
  ...NEIGHBORHOOD_PAGES,
  ...SEO_SERVICE_PAGES,
  ...VEHICLE_PAGES,
  ...PROBLEM_PAGES,
  ...SEASONAL_PAGES,
  ...UTILITY_PAGES,
  ...LEGAL_PAGES,
  ...EXCLUDED_PAGES,
];

/** Routes to include in sitemap.xml */
export const SITEMAP_ROUTES = ALL_ROUTES.filter(r => r.sitemap);

/** Routes to prerender at build time */
export const PRERENDER_ROUTES = ALL_ROUTES.filter(r => r.prerender);

/** Get route entry by path */
export function getRouteByPath(path: string): RouteEntry | undefined {
  return ALL_ROUTES.find(r => r.path === path);
}

/** Hardcoded blog slugs (always in sitemap) */
export const BLOG_SLUGS = [
  "5-signs-brakes-need-replacing",
  "check-engine-light-common-causes",
  "ohio-echeck-what-to-know",
  "when-to-replace-tires",
  "spring-car-maintenance-checklist",
  "synthetic-vs-conventional-oil",
  "echeck-emissions-guide-cleveland",
  "winter-tires-cleveland",
  "how-much-brake-repair-cost-cleveland",
  "used-tires-cleveland-guide",
  "transmission-problems-warning-signs",
  "car-wont-start-common-causes",
];
