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
  group: "core" | "service" | "city" | "neighborhood" | "seo-service" | "vehicle" | "problem" | "seasonal" | "utility" | "legal" | "landing" | "blog" | "tire-size" | "vehicle-service" | "comparison";
  /** Whether to include in sitemap (false for auth-gated, landing pages, etc.) */
  sitemap: boolean;
  /** Whether to prerender this page */
  prerender: boolean;
}

// ─── CORE PAGES ──────────────────────────────────────────
const CORE_PAGES: RouteEntry[] = [
  {
    // 2026-04-26 GSC tune: was "Nick's Tire & Auto — Cleveland's #1 Tire
    // Shop & Auto Repair". Brand-led titles get clicked when users SEARCH
    // for the brand. For non-brand queries (228 impr/mo "tire shops near
    // me" pos 7.2 / 1.3% CTR) we need an intent-led title. Switching to
    // "Tire Shop & Auto Repair Cleveland" front-loads the search-intent
    // phrase, preserves Nick's brand, fits 60-char SERP truncation.
    path: "/",
    priority: 1.0,
    changefreq: "weekly",
    title: "Tire Shop & Auto Repair Cleveland · Walk-Ins 7 Days | Nick's",
    description: "Cleveland tire shop + auto repair. New & used tires, free install. Brakes, diagnostics, oil. 4.9★ · 1,700+ reviews. Walk-ins 7 days. (216) 862-0005",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    // 2026-04-26 GSC tune: was "Auto Repair Services — Nick's Tire & Auto".
    // Page ranks pos 2.8 for tail queries (775 imp / 0.9% CTR / 7 clicks).
    // CTR for pos 2-3 should be ~12-15%. Title was generic + brand-led.
    // New title front-loads action-oriented "near me" intent, includes the
    // top three services Google sees us ranking for, signals walk-in
    // friendliness. Should multiply CTR at the existing rank.
    path: "/services",
    priority: 0.9,
    changefreq: "weekly",
    // wave-181.44 GSC tune v2 · prior meta (181.29) was a feature-list
    // ("tires, brakes, check-engine light, emissions, oil, alignment") and
    // earned only 0.5% CTR at pos 3.1 over 90 days — strong rank, weak
    // earn = snippet wasn't differentiating. Brand-perception audit
    // identified the missing "relief" mechanism that lands on every
    // VAPI repair call. Applied here as V1 Benefit Lead variant per
    // seo-aeo-meta-description-generator skill. Aligned with ServicesOverview.tsx
    // SEOHead so prerender + runtime <head> match.
    title: "Cleveland Auto Repair · You Don't Pay Until You Say Yes",
    description: "Cleveland auto repair without the surprise. Free check, written quote, you don't pay until you say yes. 4.9★ from 1,700+ drivers. Walk in 7 days.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/about",
    priority: 0.7,
    changefreq: "monthly",
    title: "About Nick's Tire & Auto · Cleveland's Honest Mechanic Since 2018",
    description: "Family-owned auto repair in Cleveland since 2018. Honest service, transparent pricing, 4.9-star reviews. Meet the team behind Northeast Ohio's top-rated shop.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/contact",
    priority: 0.8,
    changefreq: "monthly",
    // 2026-05-07 GSC tune: was "Contact Nick's Tire & Auto — Cleveland OH"
    // — generic brand-led title got 493 impressions / 0 clicks in 90 days.
    // Google was showing this page for "phone / hours / address" intent
    // queries; the title didn't promise to answer those. Front-loading
    // the actual phone number + address + 7-day-open signal so the SERP
    // result IS the answer the searcher was looking for.
    //
    // wave-181.29 — Title stays as the SERP answer (high intent → zero-
    // click search is the expected outcome). Tightened description to
    // ADD a click-incentive: "Schedule drop-off online · most jobs
    // same day · free Uber within 5 miles." Pulls in the smaller
    // segment of visitors who want more than just phone/address.
    // wave-181.48 — Added the Repair Haiku tail to description so the
    // /contact SERP snippet carries the same promise as /services and the
    // VAPI prompt. Title stays as the SERP answer (high zero-click intent).
    title: "Nick's Tire & Auto · (216) 862-0005 · 17625 Euclid Ave",
    description: "Call (216) 862-0005 or walk in to 17625 Euclid Ave, Cleveland OH. Mon-Sat 8a-6p, Sun 9a-4p. Free check, written quote, you don't pay until you say yes.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/reviews",
    priority: 0.7,
    changefreq: "weekly",
    // wave-181.29 GSC tune · was pos 6.9 with 34 impr / 0 clicks (90d).
    // Page-1 ranking, zero CTR — title/desc not selling the click.
    // Synced "1,683" → "1,700+" (count was stale + round number is more
    // click-worthy). Description now leads with concrete number-of-drivers
    // + multi-platform (Google + Yelp + BBB) for trust anchoring.
    title: "Nick's Tire & Auto · 4.9★ · 1,700+ Reviews Cleveland",
    description: "1,700+ Cleveland drivers reviewed Nick's Tire & Auto on Euclid Ave. 4.9★ across Google, Yelp, BBB. Real customers on tires, brakes, check-engine light, honest pricing.",
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
    description: "Car care tips, maintenance guides, and auto repair advice from Nick's Tire & Auto. Honest insights for Cleveland drivers.",
    group: "blog",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/areas-served",
    priority: 0.8,
    changefreq: "monthly",
    title: "Areas Served — Nick's Tire & Auto | Cleveland & Northeast Ohio",
    description: "Nick's Tire & Auto serves 150+ locations across Cleveland, Euclid, Parma, Lakewood, Mentor, and all of Northeast Ohio. Find your neighborhood auto repair page.",
    group: "core",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/pay",
    priority: 0.3,
    changefreq: "yearly",
    title: "Pay Invoice — Nick's Tire & Auto",
    description: "Pay your Nick's Tire & Auto invoice online. Enter your invoice number and phone to look up your bill and pay securely with credit or debit card.",
    group: "utility",
    sitemap: false,
    prerender: false,
  },
];

// ─── SERVICE PAGES ───────────────────────────────────────
const SERVICE_PAGES: RouteEntry[] = [
  {
    // 2026-04-26 GSC tune: was generic "Tire Shop Cleveland OH" + price hooks
    // we no longer expose. Front-loading "Tire Shop Near Me" because that's
    // the highest-impression query in our window (228 imp/mo, pos 7.2).
    // /tire-shop-near-me is the dedicated landing — but /tires is the
    // canonical product page and gets crawled more often. Both should win.
    path: "/tires",
    priority: 1.0,
    changefreq: "weekly",
    title: "Tire Shop Cleveland · New & Used · Free Install | Nick's",
    // wave-181.7 · differentiate from /used-tires-cleveland which was
    // getting zero impressions due to meta-description cannibalization
    // (both pages led with "Used tires from $25"). /tires now leads
    // with the general tire-shop intent; /used-tires-cleveland keeps
    // its used-tire-specific framing.
    description: "Cleveland tire shop on Euclid Ave — walk in 7 days incl Sundays. Used tires from $25 installed. Stay in car, crew works outside. 4.9★ 1,700+ reviews. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/brakes",
    priority: 0.9,
    changefreq: "monthly",
    // CTR-optimized: front-load price + "Same Day" + ★ rating + walk-ins.
    // Targets queries: "brake repair cleveland", "brakes cleveland", "brake pad replacement near me".
    title: "Brake Repair Cleveland — From $149/Axle, Same Day | Nick's Tire",
    description: "Cleveland brake shop where you walk under your own car on a lift before we touch a wrench. Free check, written estimate first, same-day repair. (216) 862-0005.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  // wave-181.5 · keyword-led SERP-fix pages from competitor-analyzer.
  // Both target chain-free or chain-weak SERPs that Nick's was absent
  // from. Prerender:true so bots get real HTML on first crawl.
  {
    path: "/no-credit-check-tires-cleveland",
    priority: 0.85,
    changefreq: "monthly",
    title: "No Credit Check Tires Cleveland · $10 Down, Drive Today | Nick's",
    description: "No credit check tires in Cleveland. $10 down. 4 lenders (Acima · Snap · Koalafi · American First) approve when banks don't. Drive home on new tires today. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/tire-shop-open-sunday-cleveland",
    priority: 0.85,
    changefreq: "monthly",
    title: "Tire Shop Open Sunday Cleveland · 9am-4pm Every Sunday | Nick's",
    description: "Tire shop open Sunday in Cleveland. Nick's Tire & Auto on Euclid Ave runs 9am-4pm every Sunday — walk-in tires, brakes, oil change. Conrad's closed. Mavis closed. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  // wave-181.7 · keyword-led SERP-fix pages from Ahrefs/GSC audit
  // moves #5 (wheel alignment) and #6 (tire repair). Both target
  // clusters currently in striking distance (pos 7-43) with no
  // dedicated page or with title that doesn't match the literal query.
  {
    path: "/tire-repair-cleveland",
    priority: 0.85,
    changefreq: "monthly",
    title: "Tire Repair Cleveland · $25 Plug or Patch · 15-Min Walk-In | Nick's",
    description: "Cleveland tire repair on Euclid Ave. Nail in your tire? Slow leak? We plug or patch in 15 min for $25 typical · walk-in 7 days. Free inspection. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/wheel-alignment-cleveland",
    priority: 0.85,
    changefreq: "monthly",
    title: "Wheel Alignment Cleveland · Same-Day · Free Pull-Check | Nick's",
    description: "Wheel alignment in Cleveland · same-day four-wheel laser alignment, walk-in 7 days. Free pull-check before any work. ★4.9 · 1,700+ reviews. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/diagnostics",
    priority: 0.9,
    changefreq: "monthly",
    // 2026-05-07 GSC tune: was "Check Engine Light Cleveland — Free Code
    // Scan" — got 430 impressions / 0 clicks in 90 days, indicating the
    // title was too narrow (check-engine-only) for the broader "car
    // diagnostic / OBD scan / code pull" queries Google was matching.
    // Also competing with the dedicated /check-engine-light-diagnostic
    // page. Broadening to cover the full diagnostic intent space, and
    // anchoring on the brand-voice differentiator ("real cause" not
    // parts-cannon) which is the actual reason customers switch to us.
    title: "Car Diagnostic Cleveland · Code Pull + Real Cause | Nick's",
    description: "Cleveland diagnostic shop where the code pull is free and the explanation is in real English. Same-day repair on most codes. Walk-ins 7 days. (216) 862-0005.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    // v1.7 Grounded & Reliable silo · positions Nick's as the diagnostic
    // authority that ends the parts-swap cycle. Distinct from /diagnostics
    // (broader free-scan framing) — this targets the customer who's been
    // burned by other shops.
    path: "/check-engine-light-diagnostic",
    priority: 0.85,
    changefreq: "monthly",
    title: "Check Engine Light Diagnostic Cleveland | Real Diagnosis, No Parts-Swap | Nick's",
    description: "Tired of shops swapping parts hoping to fix it? Nick's Tire & Auto runs proper diagnostics — live data, root-cause analysis, written estimate. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    // High-volume tire-intent silos. Distinct buyer journeys:
    //   /tires                  — broad finder + brand grid
    //   /tire-shop-near-me      — proximity intent
    //   /used-tires-cleveland   — value-conscious, "$60 from" framing
    //   /new-tires-cleveland    — premium buyer, "free $289 install" framing
    path: "/used-tires-cleveland",
    priority: 0.85,
    changefreq: "monthly",
    title: "Used Tires Cleveland | From $25 Installed | Nick's Tire & Auto",
    description: "Used tires in Cleveland from $40, fully installed. Every tire passes a 4-point inspection — tread, sidewall, DOT date, plug history. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/new-tires-cleveland",
    priority: 0.85,
    changefreq: "monthly",
    title: "New Tires Cleveland | Free $289 Install | Nick's",
    description: "New tires in Cleveland — Michelin, Goodyear, Bridgestone, Continental, Firestone. FREE $289 install package: mount, balance, valve stems, TPMS, alignment check.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  // Tire-brand silos — one template, 5 routes. Each targets brand+geo
  // queries like "michelin tires cleveland", "goodyear tires near me".
  {
    path: "/michelin-tires-cleveland",
    priority: 0.7,
    changefreq: "monthly",
    title: "Michelin Tires Cleveland | Free $289 Install Package | Nick's",
    description: "Michelin tires in Cleveland — Defender, Premier A/S, Pilot Sport, X-Ice. Stocked or 24-hr special order. FREE install package on every set. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/goodyear-tires-cleveland",
    priority: 0.7,
    changefreq: "monthly",
    title: "Goodyear Tires Cleveland | Free $289 Install Package | Nick's",
    description: "Goodyear tires in Cleveland — Assurance, Eagle, Wrangler, WeatherReady. Akron-based brand, full lineup stocked. FREE install package. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/bridgestone-tires-cleveland",
    priority: 0.7,
    changefreq: "monthly",
    title: "Bridgestone Tires Cleveland | Free $289 Install Package | Nick's",
    description: "Bridgestone tires in Cleveland — Turanza, Dueler, Potenza, Blizzak winter. Premium build quality, OEM partner for Toyota/Honda/BMW. FREE install. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/firestone-tires-cleveland",
    priority: 0.7,
    changefreq: "monthly",
    title: "Firestone Tires Cleveland | Free $289 Install Package | Nick's",
    description: "Firestone tires in Cleveland — Champion Fuel Fighter, WeatherGrip, Destination, Firehawk. Mid-tier value with Bridgestone DNA. FREE install. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/continental-tires-cleveland",
    priority: 0.7,
    changefreq: "monthly",
    title: "Continental Tires Cleveland | Free $289 Install Package | Nick's",
    description: "Continental tires Cleveland — TrueContact, ExtremeContact, VikingContact. European engineering, OEM on BMW/Mercedes/Audi. FREE install. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/emissions",
    priority: 0.9,
    changefreq: "monthly",
    title: "Ohio E-Check Cleveland — Failed Emissions? Pass Same Day | Nick's",
    description: "Failed your Ohio E-Check? Free readiness check + we fix the failure — O2 sensors, EVAP, catalytics. State tests; we get you passing. Same-day diagnosis. (216) 862-0005.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/oil-change",
    priority: 0.8,
    changefreq: "monthly",
    // wave-181.6 · CTR-crisis fix · "oil change service station" was
    // ranking pos 1.0 with 114 impr/mo but 0% CTR — title didn't match
    // the literal search phrase. Rewrite includes "service station"
    // since that's how the high-volume query frames the intent.
    title: "Oil Change Service Station Cleveland · $49 · Walk-In Today | Nick's", // keep in sync with OIL_PRICE
    description: "Cleveland oil change from $49 (full synthetic from $80) — new filter + free multi-point check, in and out before your coffee's cold. Walk-ins 7 days. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/general-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "General Auto Repair Services — Nick's Tire & Auto Cleveland",
    description: "Cleveland auto shop where the written estimate hits the counter before any wrench moves. Brakes, suspension, steering, exhaust. Walk-ins 7 days. (216) 862-0005.",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/alignment",
    priority: 0.8,
    changefreq: "monthly",
    // wave-181.6 · CTR-crisis fix from GSC audit. /alignment was ranking
    // pos 7.5 (page 1) for "wheel alignment near me" with 74 impr/mo
    // but 0% CTR — title lacked "near me" trigger + lacked a hard price
    // anchor. Rewrite leads with the literal search phrase.
    title: "Wheel Alignment Near Me · Cleveland · Same-Day Walk-In | Nick's",
    description: "Wheel alignment near you in Cleveland — same-day four-wheel laser alignment, walk-in 7 days. ★4.9 · 1,700+ reviews. Free pull-check first. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/synthetic-oil-change",
    priority: 0.9,
    changefreq: "monthly",
    // wave-181.8 · audit found this page ranks pos 65 for "synthetic
    // oil change" at 179 impr/mo (page 7). Title was verbose (62 chars)
    // and didn't lead with the literal query phrase + "near me" intent.
    title: "Synthetic Oil Change Near Me · Cleveland · $80 Same-Day | Nick's", // keep in sync with OIL_PRICE
    description: "Full synthetic oil change in Cleveland · $80 walk-in same-day, 30 min. Mobil 1, Pennzoil, Valvoline. 10K-mile intervals. ★4.9 · 1,700+ reviews. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    // Customer-facing full site directory. SEO benefit: one page linking
    // to every other page, giving Google a single-hop discovery of the
    // full site structure + boosting deep-page link equity.
    path: "/site-map",
    priority: 0.8,
    changefreq: "weekly",
    title: "Site Map | Nick's Tire & Auto — All Pages, Cleveland OH",
    description: "Full directory of services, city pages, problem guides, blog posts, and customer tools on Nick's Tire & Auto. Find anything in one click.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  // 2026-04-24 SEO push — new focused landing pages for high-impression
  // zero-click queries. See TrafficFunnel dashboard for the underlying data.
  {
    path: "/tire-shop-near-me",
    priority: 0.95,
    changefreq: "weekly",
    title: "Tire Shop Near Me — Open Now in Cleveland | New & Used | Nick's Tire & Auto",
    description: "Local tire shop in Cleveland/Euclid — open 7 days, walk-ins welcome. New & used tires from $25. Free install, balance, alignment check. 4.9 stars. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/nonstop-nick",
    priority: 0.9,
    changefreq: "monthly",
    title: "Nonstop Nick — $7.99/mo Tire Membership | Nick's Tire & Auto",
    description: "Pull up, we got it. $7.99/mo covers the little tire stuff on one registered vehicle — flat repairs, valve stems, rotation, air-ups. No appointment. (216) 862-0005",
    group: "service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/auto-repair-near-me",
    priority: 0.95,
    changefreq: "weekly",
    // wave-181.8 · brand-overflow fix · "nick's auto repair near me"
    // ranks pos 23 per GSC audit. Putting both "Auto Repair Near Me"
    // AND "Nick's" up front gives the page a stronger brand+intent
    // match for the conflated brand+local query.
    title: "Nick's Auto Repair Near Me · Cleveland · Walk-In Today · 1,700★",
    description: "Nick's Tire & Auto · Cleveland's local mechanic on Euclid Ave. Auto repair near you, walk-in 7 days, free written estimate, honest pricing. ★4.9 · 1,700+ reviews. (216) 862-0005",
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
  { path: "/ac-repair", priority: 0.8, changefreq: "monthly", title: "AC Repair Cleveland OH — Nick's Tire & Auto", description: "Cleveland car AC repair — leak test with UV dye, recharge, compressor, condenser, heater core. Most jobs blow cold by lunch. Free check. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/transmission", priority: 0.8, changefreq: "monthly", title: "Transmission Repair Cleveland OH — Nick's Tire & Auto", description: "Cleveland transmission shop where fluid service comes before rebuild quote. Solenoid, valve body, full rebuild as last resort. Estimate first. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/electrical", priority: 0.8, changefreq: "monthly", title: "Auto Electrical Repair Cleveland — Nick's Tire & Auto", description: "Cleveland auto electrical shop where wiring gets traced before modules get swapped. Battery, alternator, starter, parasitic draws, CAN bus. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/battery", priority: 0.8, changefreq: "monthly", title: "Battery Testing & Replacement Cleveland — Nick's Tire", description: "Cleveland battery replacement in 5 minutes. Free load test + alternator test before we sell you anything. Walk-ins 7 days. Open Sunday. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/exhaust", priority: 0.8, changefreq: "monthly", title: "Exhaust & Muffler Repair Cleveland — Nick's Tire & Auto", description: "Cleveland muffler & exhaust shop where the rumble stops by lunch. Muffler, full exhaust, catalytic converter, weld jobs. Open Sunday. From $189. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/cooling", priority: 0.8, changefreq: "monthly", title: "Cooling System Repair Cleveland — Nick's Tire & Auto", description: "Cleveland radiator shop where overheat diagnosis happens before the parts cannon. Water pump, thermostat, coolant flush, pressure test. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/pre-purchase-inspection", priority: 0.8, changefreq: "monthly", title: "Pre-Purchase Car Inspection Cleveland — Nick's Tire", description: "Cleveland pre-purchase inspection — the 90-min check that catches what the seller didn't mention. Engine, trans, brakes, frame, tires. Same-day. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/belts-hoses", priority: 0.7, changefreq: "monthly", title: "Belt & Hose Replacement Cleveland — Nick's Tire & Auto", description: "Cleveland belt + hose shop where the squeak gets diagnosed before it becomes a tow truck. Serpentine, timing belt, radiator hose. Same-day. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
  { path: "/starter-alternator", priority: 0.8, changefreq: "monthly", title: "Starter & Alternator Repair Cleveland — Nick's Tire", description: "Cleveland starter + alternator shop where the charging system gets tested before parts get sold. Free voltage drop + load test. (216) 862-0005.", group: "service", sitemap: true, prerender: true },
];

// ─── CITY/AREA PAGES ─────────────────────────────────────
const CITY_PAGES: RouteEntry[] = [
  {
    path: "/cleveland-auto-repair",
    priority: 0.9,
    changefreq: "weekly",
    // wave-181.6 · CTR-crisis · "auto repair near me" was ranking pos
    // 24.4 with 79 impr/mo but 0% CTR. Improved title leads with the
    // literal search intent + walk-in + price-anchor signal.
    title: "Auto Repair Near Me · Cleveland · Walk-In Today · 1,700★ | Nick's",
    description: "Cleveland auto shop on Euclid Ave where the worn part comes out of your car and onto the counter before you pay. 7 years, 1,700+ five-star reviews. Walk-ins 7 days.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/euclid-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Euclid Auto Repair · 17625 Euclid Ave · Used Tires $25 | Nick's",
    description: "Nick's Tire & Auto — literally on Euclid Ave. Brakes, tires, check-engine light, emissions. Free check, written quote. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    // wave-181.8 · sharpened title from "Near Lakewood OH" pattern.
    path: "/lakewood-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Lakewood Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Lakewood drivers cross town for honest auto repair. Brakes, tires, check-engine light, emissions. Free check, written quote. 4.9★ 1,700+ reviews.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/parma-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    // 2026-05-07 GSC tune (second pass): previous tune (★4.9 from 1,700+
    // Reviews) ran 736 impressions / 2 clicks at 0.27% CTR — still
    // underperforming. Hypothesis: searchers for "Parma auto repair"
    // want LOCAL TO PARMA, and Nick's is on Cleveland's East Side ~20 min
    // away. The geography mismatch kills CTR no matter how good the
    // reviews are. Reframing the title around the SPECIFIC value props
    // that overcome the geography (price + Sunday hours that local Parma
    // shops don't offer). The drive-time bait isn't enough; the
    // money-and-time bait might be.
    title: "Parma Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Parma drivers — Nick's Tire & Auto. Used tires from $25 installed (chains won't sell them). Open Sundays 9a-4p when shops close. ★4.9 · 1,700+ reviews. (216) 862-0005",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/east-cleveland-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "East Cleveland Auto Repair · 8 Min Away · Open Sundays | Nick's",
    description: "East Cleveland auto repair at Nick's Tire & Auto, just 8 min away on Euclid Ave. Brakes, tires, check-engine light, emissions. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/shaker-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Shaker Heights Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Shaker Heights drivers choose Nick's Tire & Auto for honest auto repair. Brakes, tires, check-engine light. 4.9 stars, 1,700+ reviews. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/cleveland-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Cleveland Heights Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Cleveland Heights auto repair at Nick's Tire & Auto, 15 min away. Brakes, tires, check-engine light, emissions. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/mentor-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Mentor Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Mentor drivers make the drive to Nick's Tire & Auto for honest auto repair. Brakes, tires, check-engine light. 4.9 stars. Worth the trip. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/strongsville-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Strongsville Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Strongsville drivers choose Nick's Tire & Auto for honest auto repair. Brakes, tires, check-engine light, emissions. 1,700+ five-star reviews. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/south-euclid-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "South Euclid Auto Repair · 12 Min Away · Open Sundays | Nick's",
    description: "South Euclid auto repair at Nick's Tire & Auto, just 12 min away. Brakes, tires, check-engine light, emissions. Honest pricing. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/garfield-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Garfield Heights Auto Repair · 20 Min Away · Open Sundays | Nick's",
    description: "Garfield Heights auto repair at Nick's Tire & Auto, 20 min away. Brakes, tires, check-engine light, emissions. 4.9 stars, honest pricing. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/richmond-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Richmond Heights Auto Repair · 13 Min · Open Sundays | Nick's",
    description: "Richmond Heights auto repair at Nick's Tire & Auto, just 13 min away on Euclid Ave. Brakes, tires, check-engine light. 4.9 stars. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/lyndhurst-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Lyndhurst Auto Repair · 16 Min via Mayfield · Open Sundays | Nick's",
    description: "Lyndhurst auto repair at Nick's Tire & Auto, 16 min away via Mayfield Rd. Brakes, tires, check-engine light, emissions. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    // 2026-05-05: was wired in App.tsx but missing from registry —
    // the route validator caught it. Adding so prerender + sitemap
    // can index Parma Heights search intent.
    path: "/parma-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    // wave-181.8 · audit move #3 · pos 38-44 across 7 queries currently.
    // Tightened title to match the /parma-auto-repair winning pattern
    // (city + service + differentiator + brand). Was "Near Parma Heights
    // OH" which is bland; new title leads with the city.
    title: "Parma Heights Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Parma Heights drivers cross town for an honest mechanic. 4.9★ 1,700+ reviews. Free Uber drop-off + pick-up. Brakes, tires, check-engine light. Walk-ins 7 days.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    // Brand-capture aliases — drivers searching "Moe's Tire" / "Moe's Auto"
    // land on the same MoesTireBridgePage. Four URL variants for keyword
    // capture. Added 2026-05-05; were wired in App.tsx but missing from
    // registry.
    path: "/moes-auto",
    priority: 0.6,
    changefreq: "monthly",
    title: "Looking for Moe's Tire? — Nick's Tire & Auto, Euclid OH",
    description: "Moe's Tire customers welcome at Nick's. Same neighborhood, same walk-in friendly service. 4.9★ from 1,700+ reviews. (216) 862-0005",
    group: "landing",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/moes-tire",
    priority: 0.6,
    changefreq: "monthly",
    title: "Moe's Tire — Now Nick's Tire & Auto, Euclid OH",
    description: "Looking for Moe's Tire? Nick's Tire & Auto serves the same Euclid neighborhood. Walk-ins 7 days. 4.9★ from 1,700+ reviews. (216) 862-0005",
    group: "landing",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/moes-tires",
    priority: 0.6,
    changefreq: "monthly",
    title: "Moe's Tires — Now Nick's Tire & Auto, Euclid OH",
    description: "Looking for Moe's Tires? Nick's Tire & Auto serves the same Euclid neighborhood. Walk-ins 7 days. 4.9★ from 1,700+ reviews. (216) 862-0005",
    group: "landing",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/moes-tire-euclid",
    priority: 0.6,
    changefreq: "monthly",
    title: "Moe's Tire Euclid — Now Nick's Tire & Auto",
    description: "Moe's Tire Euclid customers — Nick's Tire & Auto is right in the neighborhood. Walk-ins 7 days. 4.9★ from 1,700+ reviews. (216) 862-0005",
    group: "landing",
    sitemap: true,
    prerender: true,
  },
  {
    // Sunday-open intent capture — high-value keyword for an auto shop
    // that genuinely opens 9-4 on Sundays. Three keyword variants
    // (open-sunday, sunday, sunday-mechanic) all served by the same
    // SundayMufflerPage. 2026-05-05: missing from registry, fixed now.
    path: "/muffler-shop-open-sunday-cleveland",
    priority: 0.7,
    changefreq: "monthly",
    title: "Muffler Shop Open Sunday Cleveland — Nick's Tire & Auto",
    description: "Cleveland muffler & exhaust repair open Sunday 9-4. Catalytic converter, weld jobs, full exhaust. Walk-ins welcome. (216) 862-0005",
    group: "seo-service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/muffler-shop-sunday",
    priority: 0.65,
    changefreq: "monthly",
    title: "Muffler Shop Sunday Cleveland — Nick's Tire & Auto",
    description: "Cleveland exhaust + muffler repair, open Sunday 9-4. Catalytic converter, full exhaust, weld jobs. Walk-ins welcome. (216) 862-0005",
    group: "seo-service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/sunday-mechanic-cleveland",
    priority: 0.65,
    changefreq: "monthly",
    title: "Sunday Mechanic Cleveland — Auto Repair Open Sundays | Nick's",
    description: "Cleveland auto shop open Sundays 9-4. Brakes, tires, check-engine light, exhaust, oil — full service. Walk-ins welcome. (216) 862-0005",
    group: "seo-service",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/willoughby-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Willoughby Auto Repair · Used Tires $25 · Open Sundays | Nick's",
    description: "Willoughby drivers trust Nick's Tire & Auto for honest auto repair. Brakes, tires, check-engine light. 4.9 stars, fair pricing. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/maple-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Maple Heights Auto Repair · 15 Min via Dunham · Open Sundays | Nick's",
    description: "Maple Heights auto repair at Nick's Tire & Auto, 15 min via Dunham Rd. Brakes, tires, check-engine light, emissions. Walk-ins 7 days. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/bedford-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Bedford Auto Repair · Easy Access I-480 · Open Sundays | Nick's",
    description: "Bedford auto repair at Nick's Tire & Auto. Easy access via Rockside Rd and I-480. Brakes, tires, check-engine light. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/warrensville-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Warrensville Heights Auto Repair · 12 Min · Open Sundays | Nick's",
    description: "Warrensville Heights auto repair at Nick's Tire & Auto, just 12 min away. Brakes, tires, check-engine light, emissions. Walk-ins 7 days. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/beachwood-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Beachwood Auto Repair · 15 Min via Cedar · Open Sundays | Nick's",
    description: "Beachwood auto repair at Nick's Tire & Auto, 15 min away via Cedar Rd. Brakes, tires, check-engine light, emissions. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/mayfield-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "Mayfield Heights Auto Repair · 14 Min · Open Sundays | Nick's",
    description: "Mayfield Heights auto repair at Nick's Tire & Auto, 14 min away. Brakes, tires, check-engine light, emissions. 4.9 stars, honest pricing. Call (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/university-heights-auto-repair",
    priority: 0.8,
    changefreq: "monthly",
    title: "University Heights Auto Repair · 14 Min · Open Sundays | Nick's",
    description: "University Heights auto repair at Nick's Tire & Auto, 14 min away. Brakes, tires, check-engine light, emissions. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    group: "city",
    sitemap: true,
    prerender: true,
  },
];

// ─── NEIGHBORHOOD MICRO-PAGES ────────────────────────────
const NEIGHBORHOOD_PAGES: RouteEntry[] = [
  { path: "/east-185th-street-auto-repair", priority: 0.7, changefreq: "monthly", title: "Auto Repair East 185th St — Nick's Tire & Auto", description: "Auto repair near East 185th Street, Cleveland. Nick's Tire & Auto — minutes away. Tires, brakes, check-engine light, emissions. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/euclid-square-mall-area", priority: 0.7, changefreq: "monthly", title: "Auto Repair Euclid Square Mall Area — Nick's Tire", description: "Auto repair near Euclid Square Mall. Nick's Tire & Auto on Euclid Ave. Tires, brakes, check-engine light. Walk-ins welcome 7 days.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/richmond-heights-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic Richmond Heights OH — Nick's Tire & Auto", description: "Honest mechanic near Richmond Heights, OH. Nick's Tire & Auto — 4.9 stars. Tires, brakes, check-engine light. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/collinwood", priority: 0.7, changefreq: "monthly", title: "Auto Repair Collinwood Cleveland — Nick's Tire & Auto", description: "Auto repair in Collinwood, Cleveland. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, check-engine light. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/nottingham", priority: 0.7, changefreq: "monthly", title: "Auto Repair Nottingham Cleveland — Nick's Tire & Auto", description: "Auto repair in Nottingham, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, oil changes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/five-points", priority: 0.7, changefreq: "monthly", title: "Auto Repair Five Points Cleveland — Nick's Tire & Auto", description: "Auto repair near Five Points, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, check-engine light, emissions. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/waterloo-arts-district", priority: 0.7, changefreq: "monthly", title: "Auto Repair Waterloo Arts District — Nick's Tire", description: "Auto repair near Waterloo Arts District, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, check-engine light. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/shore-cultural-centre", priority: 0.7, changefreq: "monthly", title: "Auto Repair Shore Cultural Centre Area — Nick's Tire", description: "Auto repair near Shore Cultural Centre, Euclid. Nick's Tire & Auto — 4.9 stars. Tires, brakes, check-engine light. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/severance-town-center", priority: 0.7, changefreq: "monthly", title: "Auto Repair Severance Town Center — Nick's Tire", description: "Auto repair near Severance Town Center, Cleveland Heights. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, check-engine light, oil changes.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/university-circle", priority: 0.7, changefreq: "monthly", title: "Auto Repair University Circle Cleveland — Nick's Tire", description: "Auto repair near University Circle, Cleveland. Nick's Tire & Auto — 4.9 stars. Tires, brakes, check-engine light. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/wickliffe", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Wickliffe OH — Nick's Tire & Auto", description: "Auto repair near Wickliffe, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, check-engine light. 15 min drive.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/willowick", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Willowick OH — Nick's Tire & Auto", description: "Auto repair near Willowick, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, check-engine light. 15 min drive.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/eastlake", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Eastlake OH — Nick's Tire & Auto", description: "Auto repair near Eastlake, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, check-engine light. 15 min drive.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/south-euclid-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic South Euclid OH — Nick's Tire & Auto", description: "Honest mechanic near South Euclid, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, oil changes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/lyndhurst-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic Lyndhurst OH — Nick's Tire & Auto", description: "Honest mechanic near Lyndhurst, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, oil changes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/mayfield-heights", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Mayfield Heights OH — Nick's Tire", description: "Auto repair near Mayfield Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, oil changes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/highland-heights", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Highland Heights OH — Nick's Tire", description: "Auto repair near Highland Heights, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, oil changes, diagnostics. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/beachwood", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Beachwood OH — Nick's Tire & Auto", description: "Auto repair near Beachwood, OH. Nick's Tire & Auto — 4.9 stars, 1,700+ reviews. Tires, brakes, check-engine light. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/mentor-on-the-lake", priority: 0.6, changefreq: "monthly", title: "Auto Repair Mentor-on-the-Lake — Nick's Tire & Auto", description: "Honest auto repair serving Mentor-on-the-Lake, OH. Tires, brakes, check-engine light, oil changes, and emissions. Honest service, honest pricing.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/willoughby-hills", priority: 0.6, changefreq: "monthly", title: "Auto Repair Willoughby Hills OH — Nick's Tire & Auto", description: "Honest auto repair near Willoughby Hills, OH. Brakes, tires, check-engine light, oil changes, and emissions repair. 4.9 stars. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/euclid-ohio", priority: 0.8, changefreq: "monthly", title: "Auto Repair Euclid Ohio — Nick's Tire & Auto", description: "Your neighborhood auto repair shop in Euclid, OH. Tires, brakes, check-engine light, emissions, oil changes. Located on Euclid Ave. Walk-ins welcome 7 days.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/east-cleveland", priority: 0.7, changefreq: "monthly", title: "East Cleveland Mechanic — Tires & Repair Near You", description: "Honest auto repair serving East Cleveland, OH. Tires, brakes, check-engine light, oil changes, and emissions. Honest mechanics, written estimates first.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/cleveland-heights-mechanic", priority: 0.7, changefreq: "monthly", title: "Mechanic Cleveland Heights — Nick's Tire & Auto", description: "Honest auto repair near Cleveland Heights, OH. Brakes, tires, oil changes, check-engine light, emissions, and general repair. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/garfield-heights", priority: 0.6, changefreq: "monthly", title: "Garfield Heights Auto Repair — Tires, Brakes & More", description: "Reliable auto repair serving Garfield Heights, OH. Tires, brakes, check-engine light, oil changes, and emissions repair. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/maple-heights", priority: 0.6, changefreq: "monthly", title: "Auto Repair Maple Heights OH — Nick's Tire & Auto", description: "Honest mechanics serving Maple Heights, OH. Brakes, tires, check-engine light, oil changes, emissions, and general repair. Transparent pricing.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/parma-heights", priority: 0.6, changefreq: "monthly", title: "Auto Repair Parma Heights — Nick's Tire & Auto", description: "Honest auto repair for Parma Heights, OH. Brakes, tires, check-engine light, oil changes, and emissions. All makes and models. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/shaker-heights", priority: 0.7, changefreq: "monthly", title: "Auto Repair Near Shaker Heights — Nick's Tire & Auto", description: "Honest auto repair serving Shaker Heights, OH. Brakes, tires, check-engine light, oil changes, and emissions. Honest service, OE-specparts.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/warrensville-heights", priority: 0.6, changefreq: "monthly", title: "Auto Repair Warrensville Heights — Nick's Tire & Auto", description: "Reliable auto repair for Warrensville Heights, OH. Tires, brakes, check-engine light, oil changes, and emissions. Honest service, experienced mechanics.", group: "neighborhood", sitemap: true, prerender: true },
  // v1.7 audit fix · /lakewood-mechanic dropped — was producing a
  // 404 in production (no slug in cities.ts, no Route in App.tsx)
  // and would create near-duplicate content with /lakewood-auto-repair
  // which already exists. Single canonical Lakewood URL is cleaner SEO.
  { path: "/willoughby-ohio", priority: 0.7, changefreq: "monthly", title: "Auto Repair Willoughby OH — Nick's Tire & Auto", description: "Honest auto repair serving Willoughby and Lake County, OH. Tires, brakes, check-engine light, oil changes, emissions. 4.9 stars. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/bedford-ohio", priority: 0.6, changefreq: "monthly", title: "Auto Repair Bedford OH — Nick's Tire & Auto", description: "Honest mechanics serving Bedford, OH. Brakes, tires, check-engine light, oil changes, and emissions repair. Honest diagnostics, OE-specrepairs.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/north-collinwood", priority: 0.7, changefreq: "monthly", title: "Auto Repair North Collinwood — Nick's Tire & Auto", description: "Your local auto repair shop in North Collinwood, Cleveland. Tires, brakes, check-engine light, oil changes, and emissions. Quick turnaround, honest service.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/downtown-cleveland", priority: 0.7, changefreq: "monthly", title: "Auto Repair Downtown Cleveland — Nick's Tire & Auto", description: "Convenient auto repair for downtown Cleveland commuters. Tires, brakes, check-engine light, oil changes. Drop off and pick up service. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/tremont-cleveland", priority: 0.6, changefreq: "monthly", title: "Auto Repair Tremont Cleveland — Nick's Tire & Auto", description: "Honest auto repair for Tremont, Cleveland residents. Tires, brakes, check-engine light, oil changes, emissions. Independent, honest mechanics.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/ohio-city", priority: 0.6, changefreq: "monthly", title: "Auto Repair Ohio City Cleveland — Nick's Tire & Auto", description: "Honest auto repair serving Ohio City, Cleveland. All makes and models — tires, brakes, check-engine light, oil changes. Honest pricing, walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/rocky-river", priority: 0.6, changefreq: "monthly", title: "Auto Repair Rocky River OH — Nick's Tire & Auto", description: "Honest auto repair serving Rocky River, OH. Honest check-engine light, brakes, tires, oil changes, and emissions. Fair prices, walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/solon-ohio", priority: 0.6, changefreq: "monthly", title: "Auto Repair Solon OH — Nick's Tire & Auto", description: "Honest auto repair for Solon, OH residents. Brakes, tires, check-engine light, oil changes, and emissions repair. Honest parts, honest work.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/broadview-heights", priority: 0.6, changefreq: "monthly", title: "Auto Repair Broadview Heights — Nick's Tire & Auto", description: "Honest auto repair serving Broadview Heights, OH. Tires, brakes, check-engine light, oil changes, emissions, and alignment. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/chagrin-falls", priority: 0.6, changefreq: "monthly", title: "Auto Repair Chagrin Falls OH — Nick's Tire & Auto", description: "Honest auto repair for Chagrin Falls, OH. Brakes, tires, check-engine light, oil changes, and emissions. Honest diagnostics, honest service.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/bainbridge-ohio", priority: 0.5, changefreq: "monthly", title: "Auto Repair Bainbridge OH — Nick's Tire & Auto", description: "Honest auto repair for Bainbridge Township, OH. Brakes, tires, check-engine light, oil changes, and emissions. Honest pricing. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/pepper-pike", priority: 0.6, changefreq: "monthly", title: "Auto Repair Pepper Pike — Nick's Tire & Auto", description: "Honest auto repair near Pepper Pike, OH. Honest check-engine light, brakes, tires, oil changes, and emissions. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/gates-mills", priority: 0.5, changefreq: "monthly", title: "Auto Repair Gates Mills — Nick's Tire & Auto", description: "Honest auto repair for Gates Mills, OH. Brakes, tires, check-engine light, oil changes, and emissions. Honest OEM parts, honest work.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/independence-ohio", priority: 0.6, changefreq: "monthly", title: "Auto Repair Independence OH — Nick's Tire & Auto", description: "Reliable auto repair for Independence, OH. Same-day brake, tire, diagnostic, and oil change service. 4.9 stars, 1,700+ reviews. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/strongsville-ohio", priority: 0.6, changefreq: "monthly", title: "Auto Repair Strongsville OH — Nick's Tire & Auto", description: "Honest auto repair serving Strongsville, OH. Tires, brakes, check-engine light, oil changes, and emissions repair. 4.9 stars. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/north-royalton", priority: 0.6, changefreq: "monthly", title: "Auto Repair North Royalton — Nick's Tire & Auto", description: "Honest auto repair for North Royalton, OH. Brakes, tires, check-engine light, oil changes, and emissions. Honest pricing, 4.9 stars. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/bay-village", priority: 0.5, changefreq: "monthly", title: "Auto Repair Bay Village OH — Nick's Tire & Auto", description: "Honest auto repair for Bay Village, OH. Tires, brakes, check-engine light, oil changes, and emissions repair. Professional service, walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/westlake-ohio", priority: 0.6, changefreq: "monthly", title: "Auto Repair Westlake OH — Nick's Tire & Auto", description: "Honest auto repair serving Westlake, OH. Tires, brakes, check-engine light, oil changes, and emissions. Honest parts, honest pricing. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/north-olmsted", priority: 0.6, changefreq: "monthly", title: "Auto Repair North Olmsted — Nick's Tire & Auto", description: "Reliable auto repair for North Olmsted, OH. Brakes, tires, check-engine light, oil changes, and emissions repair. Walk-ins welcome 7 days a week.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/middleburg-heights", priority: 0.5, changefreq: "monthly", title: "Auto Repair Middleburg Heights — Nick's Tire & Auto", description: "Honest auto repair for Middleburg Heights, OH. Tires, brakes, oil changes, diagnostics, and emissions repair. 4.9 stars, walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/brook-park", priority: 0.5, changefreq: "monthly", title: "Auto Repair Brook Park — Nick's Tire & Auto", description: "Honest auto repair in Brook Park near Cleveland Hopkins Airport. Tires, brakes, check-engine light, oil changes. 4.9 stars. Walk-ins welcome 7 days.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/avon-ohio", priority: 0.5, changefreq: "monthly", title: "Auto Repair Avon OH — Nick's Tire & Auto", description: "Honest auto repair serving Avon, OH. Tires, brakes, check-engine light, oil changes, and emissions repair. Transparent pricing, walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/avon-lake", priority: 0.5, changefreq: "monthly", title: "Auto Repair Avon Lake OH — Nick's Tire & Auto", description: "Honest auto repair for Avon Lake, OH. Tires, brakes, check-engine light, emissions, and oil changes. Professional service, honest pricing.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/twinsburg-ohio", priority: 0.5, changefreq: "monthly", title: "Auto Repair Twinsburg OH — Nick's Tire & Auto", description: "Honest auto repair for Twinsburg, OH. Brakes, tires, check-engine light, oil changes, emissions repair, and alignment. Walk-ins welcome 7 days.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/aurora-ohio", priority: 0.5, changefreq: "monthly", title: "Auto Repair Aurora OH — Nick's Tire & Auto", description: "Honest auto repair for Aurora, OH. Tires, brakes, check-engine light, oil changes, and emissions repair. Honest parts, ASE-trained hands.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/streetsboro", priority: 0.5, changefreq: "monthly", title: "Auto Repair Streetsboro OH — Nick's Tire & Auto", description: "Reliable auto repair serving Streetsboro, OH. Tires, brakes, check-engine light, oil changes, and emissions repair. Honest pricing, ASE-trained hands.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/chardon-ohio", priority: 0.5, changefreq: "monthly", title: "Auto Repair Chardon OH — Nick's Tire & Auto", description: "Honest auto repair for Chardon, OH. Snow belt tire specialists — winter tires, brakes, check-engine light, and emissions. Honest pricing, walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/painesville-ohio", priority: 0.5, changefreq: "monthly", title: "Auto Repair Painesville OH — Nick's Tire & Auto", description: "Honest auto repair serving Painesville and Lake County, OH. Tires, brakes, check-engine light, emissions repair. 4.9 stars. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/mentor-ohio", priority: 0.6, changefreq: "monthly", title: "Auto Repair Mentor OH — Nick's Tire & Auto", description: "Honest auto repair for Mentor, OH. Solid tire service, brake repair, check-engine light, oil changes, and emissions. Walk-ins welcome 7 days.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/university-heights", priority: 0.6, changefreq: "monthly", title: "Auto Repair University Heights — Nick's Tire & Auto", description: "Honest auto repair near University Heights, OH. Tires, brakes, check-engine light, emissions, and oil changes. 4.9 stars. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
  { path: "/parma-ohio", priority: 0.7, changefreq: "monthly", title: "Auto Repair Parma OH — Nick's Tire & Auto", description: "Honest auto repair for Parma, OH. Brakes, tires, check-engine light, oil changes, emissions, and general repair. Honest work, fair prices. Walk-ins welcome.", group: "neighborhood", sitemap: true, prerender: true },
];

// ─── SEO SERVICE PAGES (long-tail keywords) ──────────────
const SEO_SERVICE_PAGES: RouteEntry[] = [
  // /*-cleveland SEO service aliases removed 2026-04-24 from both the
  // sitemap AND the route registry — they now 301-redirect server-side
  // to their canonical URLs. See server/_core/redirects.ts. Removing
  // from the sitemap stops Google from re-discovering + re-indexing
  // them as separate pages.
];

// ─── VEHICLE MAKE PAGES ──────────────────────────────────
// VEHICLE_PAGES removed 2026-04-24 per T5 audit — 10 pages × 0 imps × 0 clicks
// over 30 days. Pattern was /{make}-repair-cleveland. Google treats brand-
// specific queries as the same intent as the base service query, so these
// add zero incremental traffic. Existing /brakes, /oil-change, /diagnostics
// cover all makes. Revive via git revert if specific make-level SEO ever
// matters (e.g., targeting BMW/Audi European-only niches).

// ─── PROBLEM PAGES ───────────────────────────────────────
const PROBLEM_PAGES: RouteEntry[] = [
  { path: "/car-shaking-while-driving", priority: 0.7, changefreq: "monthly", title: "Car Shaking While Driving? — Nick's Tire & Auto", description: "Car shaking while driving? Common causes: tire balance, warped rotors, worn suspension. Honest diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/brakes-grinding", priority: 0.7, changefreq: "monthly", title: "Brakes Grinding? — Nick's Tire & Auto Cleveland", description: "Brakes grinding or squealing? Don't wait — worn pads damage rotors. Honest brake repair at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/check-engine-light-flashing", priority: 0.7, changefreq: "monthly", title: "Check Engine Light Flashing? — Nick's Tire & Auto", description: "Flashing check engine light means stop driving. Could be misfire or catalytic converter damage. Honest diagnostics in Cleveland. Call (216) 862-0005.", group: "problem", sitemap: true, prerender: true },
  { path: "/car-overheating", priority: 0.7, changefreq: "monthly", title: "Car Overheating? — Nick's Tire & Auto Cleveland", description: "Car overheating? Pull over immediately. Radiator, thermostat, water pump, or head gasket. Honest cooling system repair in Cleveland.", group: "problem", sitemap: true, prerender: true },
  { path: "/car-wont-start", priority: 0.7, changefreq: "monthly", title: "Car Won't Start? — Nick's Tire & Auto Cleveland", description: "Car won't start? Battery, starter, alternator, or ignition. Honest diagnostics at Nick's Tire & Auto, Cleveland. Walk-ins welcome 7 days.", group: "problem", sitemap: true, prerender: true },
  { path: "/steering-wheel-shaking", priority: 0.7, changefreq: "monthly", title: "Steering Wheel Shaking? — Nick's Tire & Auto", description: "Steering wheel shaking? Tire balance, alignment, or suspension issue. Honest diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/car-pulling-to-one-side", priority: 0.7, changefreq: "monthly", title: "Car Pulling to One Side? — Nick's Tire & Auto", description: "Car pulling left or right? Alignment, tire pressure, or brake issue. Honest diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/transmission-slipping", priority: 0.7, changefreq: "monthly", title: "Transmission Slipping? — Nick's Tire & Auto", description: "Transmission slipping or jerking? Don't ignore it — early repair saves thousands. Honest diagnostics in Cleveland. Call (216) 862-0005.", group: "problem", sitemap: true, prerender: true },
  { path: "/ac-not-blowing-cold", priority: 0.7, changefreq: "monthly", title: "AC Not Blowing Cold? — Nick's Tire & Auto Cleveland", description: "AC not blowing cold? Refrigerant, compressor, or condenser issue. Auto AC repair at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/battery-keeps-dying", priority: 0.7, changefreq: "monthly", title: "Battery Keeps Dying? — Nick's Tire & Auto Cleveland", description: "Battery keeps dying? Alternator, parasitic drain, or old battery. Honest electrical diagnostics at Nick's Tire & Auto, Cleveland.", group: "problem", sitemap: true, prerender: true },
  { path: "/grinding-noise-when-braking", priority: 0.7, changefreq: "monthly", title: "Grinding Noise When Braking? — Nick's Tire & Auto", description: "Grinding noise when braking? Worn pads, damaged rotors, or debris. Honest brake diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
  { path: "/oil-leak-under-car", priority: 0.7, changefreq: "monthly", title: "Oil Leak Under Car? — Nick's Tire & Auto Cleveland", description: "Oil leak under your car? Valve cover gasket, oil pan, or drain plug. Honest leak diagnosis at Nick's Tire & Auto, Cleveland. Walk-ins welcome.", group: "problem", sitemap: true, prerender: true },
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
    path: "/guides",
    priority: 0.7,
    changefreq: "weekly",
    title: "Car Care Guides — Nick's Tire & Auto Cleveland",
    description: "Step-by-step car care guides for Cleveland drivers: oil change intervals, brake signs, tire rotation, winter prep, e-check prep, and more.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/womens-safety",
    priority: 0.7,
    changefreq: "monthly",
    title: "Women's Safety & Drop-Off Experience — Nick's Tire & Auto",
    description: "Drop off your car, call an Uber, get your day back. Built for busy moms and anyone who values time and safety. Cleveland's drop-off tire shop.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/financing",
    priority: 0.8,
    changefreq: "weekly",
    title: "Auto Repair Financing Cleveland — Nick's Tire & Auto",
    description: "Auto repair payment programs in Cleveland. $10 down, drive today. Acima, Koalafi, Snap Finance, American First. All credit welcome. Apply in minutes.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/specials",
    priority: 0.8,
    changefreq: "weekly",
    // wave-181.29 GSC tune · was pos 6.9 with 34 impr / 0 clicks (90d).
    // Page-1 ranking, zero CTR — title was over 60ch (truncating in
    // SERP) AND description didn't lead with the specific dollar hooks
    // people clicking "Cleveland auto specials" actually want.
    title: "Cleveland Auto Specials · $25 Tire Plug · $49 Oil | Nick's", // keep in sync with OIL_PRICE
    description: "Cleveland auto deals at Nick's on Euclid Ave — $25 tire plug, $49 oil change, brake & alignment specials. Walk-in 7 days. Updated weekly. (216) 862-0005",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/diagnose",
    priority: 0.7,
    changefreq: "monthly",
    title: "AI Car Diagnostic Tool · Free Symptom Check Cleveland | Nick's",
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
    description: "Refer a friend to Nick's Tire & Auto and you both save on auto repair. Earn rewards on tires, brakes, oil changes, and more. Cleveland's best referral program.",
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
  // wave-181.38 · /review is now a client-side redirect to /reviews
  // (was a standalone QR-card page; the QR functionality merged into
  // /reviews so customers see reviews AND the scan-to-review CTA on
  // one URL). Kept in the registry only so the route-validator passes
  // — sitemap=false (don't index a redirect) + prerender=false (no
  // static HTML needed; the wouter <Redirect> fires client-side).
  {
    path: "/review",
    priority: 0.1,
    changefreq: "yearly",
    title: "Leave a Review — Nick's Tire & Auto Cleveland",
    description: "Redirects to /reviews. Use /reviews instead.",
    group: "utility",
    sitemap: false,
    prerender: false,
  },
  {
    path: "/careers",
    priority: 0.7,
    changefreq: "weekly",
    title: "Careers — Auto Tech Jobs Cleveland | Nick's Tire & Auto",
    description: "Now hiring mechanics, tire technicians, and apprentices at Nick's Tire & Auto. Competitive pay, growth opportunities, modern shop. Apply in 2 minutes.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    path: "/appointment",
    priority: 0.8,
    changefreq: "monthly",
    title: "Schedule Service — Nick's Tire & Auto Cleveland",
    description: "Book your auto repair appointment online at Nick's Tire & Auto. Tires, brakes, oil changes, diagnostics. Walk-ins also welcome 7 days a week.",
    group: "utility",
    sitemap: true,
    prerender: true,
  },
  {
    // 2026-04-26 GSC audit: was sitemap:false (treated as auth-gated /
    // landing). After v1.4-1.5 conversion overhaul, /booking is now a
    // primary indexable surface (rich SEO content + LocalBusiness schema +
    // capacity banner + reservation language). Flipping to sitemap:true
    // so Google can crawl + index it for "book auto repair near me" intent.
    path: "/booking",
    priority: 0.8,
    changefreq: "weekly",
    title: "Drop-Off Cleveland · No Appointment, No Reservation | Nick's Tire & Auto",
    description: "Drop your car off at Nick's on Euclid Ave any day we're open. First-come-first-served. A master tech calls back within 15 min with a written estimate. (216) 862-0005",
    group: "utility",
    sitemap: true,
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
    description: "Terms of service for nickstire.org. Usage terms, privacy practices, and policies for Nick's Tire & Auto website and auto repair services in Cleveland, OH.",
    group: "legal",
    sitemap: true,
    prerender: true,
  },
];

// ─── COMPETITOR COMPARISON PAGES (14 high-intent SEO captures) ────
// 2026-05-06 wave-33 · honest comparisons in brand voice with FAQPage
// + LocalBusiness schema. Targets "[chain] alternative", "[A] vs [B]",
// and "best [chain] alternatives" search brackets. Single source of
// truth: client/src/data/competitors.ts.
const COMPARISON_PAGES: RouteEntry[] = [
  // Format 1: Alternative (singular) — switch intent
  { path: "/conrads-tire-alternative-cleveland", priority: 0.85, changefreq: "monthly", title: "Conrad's Tire Alternative Cleveland · Open Sundays | Nick's", description: "Tired of Conrad's? Nick's Tire & Auto on Euclid Ave is open 7 days, walk-in any time, used tires from $25 installed. Written estimate before any wrench moves.", group: "comparison", sitemap: true, prerender: true },
  { path: "/mavis-tire-alternative-cleveland", priority: 0.85, changefreq: "monthly", title: "Mavis Tire Alternative Cleveland · No Surprise Fees | Nick's", description: "Mavis advertised tire price low? Final invoice high? Nick's Tire & Auto on Euclid Ave: walk-in 7 days, written estimate up front, used tires from $25 installed.", group: "comparison", sitemap: true, prerender: true },
  { path: "/discount-tire-alternative-cleveland", priority: 0.8, changefreq: "monthly", title: "Discount Tire Alternative Cleveland · One-Stop Shop | Nick's", description: "Discount Tire is tires only — they can't do brakes, oil, or alignment. Nick's Tire & Auto: tires + brakes + repair under one roof, open 7 days, walk-in any time.", group: "comparison", sitemap: true, prerender: true },
  { path: "/firestone-alternative-cleveland", priority: 0.8, changefreq: "monthly", title: "Firestone Alternative Cleveland · No Chain Pricing | Nick's", description: "Firestone wants $200/hr labor, an appointment, and a Firestone credit card. Nick's Tire & Auto on Euclid Ave: walk-in 7 days, transparent pricing, real address.", group: "comparison", sitemap: true, prerender: true },
  { path: "/monro-mr-tire-alternative-cleveland", priority: 0.75, changefreq: "monthly", title: "Monro / Mr. Tire Alternative Cleveland · One Standard | Nick's", description: "Monro and Mr. Tire OE-specvaries wildly store-to-store. Nick's Tire & Auto on Euclid Ave: one shop, one crew, one standard. Walk-in 7 days, written estimate up front.", group: "comparison", sitemap: true, prerender: true },
  { path: "/big-o-tires-alternative-cleveland", priority: 0.7, changefreq: "monthly", title: "Big O Alternative Cleveland · Closer, Honest, Open Sundays | Nick's", description: "Big O has only a handful of Cleveland locations. Nick's Tire & Auto on Euclid Ave: walk-in 7 days, used tires from $25, the estimate in writing before any wrench moves.", group: "comparison", sitemap: true, prerender: true },
  { path: "/ntb-alternative-cleveland", priority: 0.7, changefreq: "monthly", title: "NTB Alternative Cleveland · After the Mavis Acquisition | Nick's", description: "NTB became Mavis in 2021. Same surprise-checkout pattern, same closed Sundays. Nick's Tire & Auto on Euclid Ave: walk-in 7 days, used tires $25, estimate up front.", group: "comparison", sitemap: true, prerender: true },
  // Format 3: You vs Competitor — direct head-to-head
  { path: "/nicks-tire-vs-conrads-cleveland", priority: 0.8, changefreq: "monthly", title: "Nick's Tire & Auto vs Conrad's Cleveland · Honest Compare", description: "Conrad's vs Nick's Tire & Auto in Cleveland. Hours, pricing, walk-in policy, used tires, written estimates — head-to-head, no spin.", group: "comparison", sitemap: true, prerender: true },
  { path: "/nicks-tire-vs-mavis-cleveland", priority: 0.8, changefreq: "monthly", title: "Nick's Tire & Auto vs Mavis Cleveland · Honest Compare", description: "Mavis advertised price low, ticket high? Nick's Tire & Auto on Euclid Ave: walk-in 7 days, used tires from $25, estimate in writing before wrench moves.", group: "comparison", sitemap: true, prerender: true },
  { path: "/nicks-tire-vs-firestone-cleveland", priority: 0.75, changefreq: "monthly", title: "Nick's Tire & Auto vs Firestone Cleveland · Honest Compare", description: "Firestone wants chain pricing + appointment. Nick's Tire & Auto on Euclid: walk-in 7 days, transparent labor, used tires from $25, estimate up front.", group: "comparison", sitemap: true, prerender: true },
  // wave-175 · Index hub for all comparison content (per competitor-
  // alternatives skill's Vs-Comparisons-Index pattern). Higher priority
  // than individual comparison pages because it's the hub that passes
  // equity to all the spokes + can rank for broad "tire shop
  // comparisons cleveland" queries on its own.
  { path: "/compare", priority: 0.9, changefreq: "monthly", title: "Tire Shop Comparisons Cleveland · Honest Side-by-Side | Nick's", description: "Honest, in-writing comparisons of every major Cleveland tire shop. Mavis, Conrad's, Firestone, Discount Tire, NTB, Monro, Big O — vs Nick's Tire & Auto.", group: "comparison", sitemap: true, prerender: true },
  // Format 2: Roundup (plural) — research intent
  { path: "/best-tire-shops-cleveland", priority: 0.85, changefreq: "monthly", title: "Best Tire Shops Cleveland · 7 Honest Picks Ranked | Nick's", description: "The honest ranking of Cleveland tire shops. Nick's, Conrad's, Mavis, Discount Tire, Firestone, Monro, Big O — sorted by walk-in policy, Sunday hours, used tire access.", group: "comparison", sitemap: true, prerender: true },
  { path: "/best-conrads-tire-alternatives-cleveland", priority: 0.75, changefreq: "monthly", title: "Best Conrad's Tire Alternatives Cleveland · 6 Honest Picks | Nick's", description: "Looking for Conrad's Tire alternatives in Cleveland? 6 ranked options — Nick's Tire & Auto, Mavis, Discount Tire, Firestone, Monro, Big O. Honest comparison.", group: "comparison", sitemap: true, prerender: true },
  // Format 4: Third-party comparisons — ride competitor-vs-competitor traffic
  { path: "/conrads-vs-mavis-tire-cleveland", priority: 0.7, changefreq: "monthly", title: "Conrad's vs Mavis Tire Cleveland · Honest Compare + 3rd Option", description: "Conrad's Tire vs Mavis Discount Tire in Cleveland. Hours, pricing, walk-ins, used tires — head-to-head. Plus the third option neither chain wants you to know about.", group: "comparison", sitemap: true, prerender: true },
  { path: "/firestone-vs-discount-tire-cleveland", priority: 0.7, changefreq: "monthly", title: "Firestone vs Discount Tire Cleveland · Honest Compare + 3rd Option", description: "Firestone vs Discount Tire in Cleveland. Tires, brakes, alignment, pricing — head-to-head. Plus the third option that does Sunday + walk-in + used tires.", group: "comparison", sitemap: true, prerender: true },
];

// ─── NON-SITEMAP PAGES (landing pages, admin, etc.) ──────
const EXCLUDED_PAGES: RouteEntry[] = [
  { path: "/portal", priority: 0, changefreq: "monthly", title: "Customer Portal — Nick's Tire & Auto", description: "Nick's Tire & Auto customer portal. View invoices, service history, and manage your account.", group: "utility", sitemap: false, prerender: false },
  { path: "/admin", priority: 0, changefreq: "monthly", title: "Admin Dashboard", description: "", group: "utility", sitemap: false, prerender: false },
  { path: "/admin/ig-studio", priority: 0, changefreq: "monthly", title: "IG Carousel Studio", description: "", group: "utility", sitemap: false, prerender: false },
  { path: "/admin/reel-studio", priority: 0, changefreq: "monthly", title: "Reel Studio", description: "", group: "utility", sitemap: false, prerender: false },
  { path: "/lp/brakes", priority: 0, changefreq: "monthly", title: "Brake Repair Special — Nick's Tire & Auto", description: "Limited time brake repair special at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
  { path: "/lp/tires", priority: 0, changefreq: "monthly", title: "Tire Sale — Nick's Tire & Auto", description: "Limited time tire sale at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
  { path: "/lp/diagnostics", priority: 0, changefreq: "monthly", title: "Diagnostics Special — Nick's Tire & Auto", description: "Limited time diagnostics special at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
  { path: "/lp/emergency", priority: 0, changefreq: "monthly", title: "Emergency Auto Repair — Nick's Tire & Auto", description: "Emergency auto repair at Nick's Tire & Auto, Cleveland.", group: "landing", sitemap: false, prerender: false },
];

// ─── TIRE SIZE PAGES (30 programmatic SEO pages) ────────────
import { TIRE_SIZE_PAGES } from "./tireSizes";

const TIRE_SIZE_ROUTE_PAGES: RouteEntry[] = TIRE_SIZE_PAGES.map(t => ({
  path: `/tires/${t.slug}`,
  priority: 0.7,
  changefreq: "monthly" as const,
  title: t.metaTitle,
  description: t.metaDescription,
  group: "tire-size" as const,
  sitemap: true,
  prerender: true,
}));

// ─── VEHICLE + SERVICE COMBO PAGES (50 programmatic SEO pages) ──
// Vehicle+service pages (honda-brake-repair, toyota-oil-change, etc.)
// removed 2026-04-24 per T5 audit — 50 auto-generated pages × 0 imps × 0
// clicks. Pure template bloat. Revive shared/vehicleServicePages.ts +
// this import via git revert if the make+service intent gets rediscovered.

// ─── COMBINED REGISTRY ───────────────────────────────────

export const ALL_ROUTES: RouteEntry[] = [
  ...CORE_PAGES,
  ...SERVICE_PAGES,
  ...CITY_PAGES,
  ...NEIGHBORHOOD_PAGES,
  ...SEO_SERVICE_PAGES,
  ...PROBLEM_PAGES,
  ...SEASONAL_PAGES,
  ...TIRE_SIZE_ROUTE_PAGES,
  ...COMPARISON_PAGES,
  ...UTILITY_PAGES,
  ...LEGAL_PAGES,
  ...EXCLUDED_PAGES,
];

/**
 * Routes for sitemap.xml (also feeds sitemap-services / sitemap-locations).
 *
 * group:"neighborhood" is excluded as a class — NeighborhoodPage.tsx
 * renders robots="noindex, follow" on all 59 neighborhood micro-pages
 * (thin ~24-word doorway pages; see that file for the rationale). A
 * noindex URL in a sitemap is a contradictory crawl signal that wastes
 * crawl budget — Ahrefs Site Audit flagged 61 such pages (2026-05-21).
 * Excluding the group here keeps any future neighborhood route out of
 * every sitemap automatically. prerender stays on (PRERENDER_ROUTES) so
 * Googlebot still reads the noindex from prerendered static HTML.
 */
export const SITEMAP_ROUTES = ALL_ROUTES.filter(r => r.sitemap && r.group !== "neighborhood");

/** Routes to prerender at build time */
export const PRERENDER_ROUTES = ALL_ROUTES.filter(r => r.prerender);

/** Get route entry by path */
export function getRouteByPath(path: string): RouteEntry | undefined {
  return ALL_ROUTES.find(r => r.path === path);
}

/**
 * Blog slugs to include in sitemap + prerender list.
 *
 * Derived from `shared/blog.ts` (BLOG_ARTICLES) so adding a new article
 * to that file automatically gets it indexed. Previously this was a
 * hardcoded list of 12 slugs while BLOG_ARTICLES held 115, leaving 103
 * production-ready articles invisible to Google. (2026-05-05 audit fix.)
 */
import { BLOG_ARTICLES } from "./blog";
export const BLOG_SLUGS = BLOG_ARTICLES.map(a => a.slug);
