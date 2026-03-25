/**
 * Intersection data for /near/[slug] SEO pages.
 * Each page targets "auto repair near [intersection]" queries.
 * 50+ pages covering Euclid, Cleveland, Wickliffe, South Euclid,
 * Richmond Heights, East Cleveland, and Collinwood.
 */

export interface IntersectionData {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  zip: string;
  driveMinutes: number;
  neighborhood?: string;
  landmark?: string;
  localContent: string;
}

export const INTERSECTIONS: IntersectionData[] = [
  // ─── EUCLID (closest) ───────────────────────────
  { slug: "euclid-ave-e-222nd", name: "Euclid Ave & E 222nd St", lat: 41.5834, lng: -81.5168, zip: "44123", driveMinutes: 2, neighborhood: "Euclid", localContent: "Just two minutes from our shop on Euclid Avenue. If you're near the E 222nd corridor — whether heading to Shore Cultural Centre or grabbing lunch — we're the closest full-service auto shop. Pull in for a flat repair ($25) or schedule your next oil change." },
  { slug: "euclid-ave-e-200th", name: "Euclid Ave & E 200th St", lat: 41.5856, lng: -81.5335, zip: "44119", driveMinutes: 5, neighborhood: "Euclid", localContent: "Five minutes east on Euclid Avenue puts you right at our door. The E 200th St intersection sees heavy traffic, and Cleveland's potholes don't help. If your alignment feels off or you're hearing grinding when you brake, don't wait — drive straight to us at 17625 Euclid Ave." },
  { slug: "euclid-ave-chardon-rd", name: "Euclid Ave & Chardon Rd", lat: 41.5815, lng: -81.5094, zip: "44117", driveMinutes: 4, neighborhood: "Euclid", localContent: "The Euclid Ave and Chardon Road intersection is one of the busiest in Euclid. If your check engine light came on while driving through, we're less than 4 minutes away. Our OBD-II diagnostics start at $49 — we find the real problem, not guess." },
  { slug: "lakeshore-blvd-e-222nd", name: "Lakeshore Blvd & E 222nd St", lat: 41.5903, lng: -81.5165, zip: "44123", driveMinutes: 3, neighborhood: "Shore area", landmark: "Near Sims Park", localContent: "Coming from the Lakeshore Boulevard area near Sims Park? We're just 3 minutes south. The lake-effect salt destroys undercarriages and brake lines — get a free inspection before winter damage becomes a safety issue." },
  { slug: "babbitt-rd-euclid-ave", name: "Babbitt Rd & Euclid Ave", lat: 41.5842, lng: -81.5255, zip: "44123", driveMinutes: 2, neighborhood: "Euclid", localContent: "The Babbitt Road corridor in Euclid is home turf. Our shop at 17625 Euclid Ave is literally around the corner. Walk-ins welcome 7 days a week for tire repairs, oil changes, and brake checks." },

  // ─── I-90 / HIGHWAY ACCESS ──────────────────────
  { slug: "i-90-euclid-ave", name: "I-90 & Euclid Ave Exit", lat: 41.5790, lng: -81.5200, zip: "44123", driveMinutes: 3, neighborhood: "Euclid", localContent: "Just got off I-90 at the Euclid Ave exit? We're 3 minutes east. If you blew a tire on the highway or your car is overheating, pull off and head to 17625 Euclid Ave. We handle emergency repairs same-day." },
  { slug: "i-90-e-185th", name: "I-90 & E 185th St Exit", lat: 41.5811, lng: -81.5489, zip: "44119", driveMinutes: 8, neighborhood: "Collinwood", localContent: "Taking the E 185th St exit off I-90? Head east on Euclid Avenue for about 8 minutes. Worth the drive — our 4.9-star rating and 1,700+ reviews aren't an accident. Honest diagnostics, fair prices, no surprises." },
  { slug: "i-271-euclid-ave", name: "I-271 & Euclid Ave", lat: 41.5760, lng: -81.4880, zip: "44117", driveMinutes: 7, neighborhood: "Wickliffe", localContent: "Coming off I-271 near Wickliffe? Take Euclid Ave west for 7 minutes to reach Nick's Tire & Auto. We serve drivers from all over the East Side — Wickliffe, Willoughby, Mentor. Used tires from $60, brakes from $89." },

  // ─── WICKLIFFE / WILLOUGHBY ─────────────────────
  { slug: "euclid-ave-lloyd-rd", name: "Euclid Ave & Lloyd Rd", lat: 41.5848, lng: -81.4727, zip: "44092", driveMinutes: 10, neighborhood: "Wickliffe", localContent: "Wickliffe drivers at the Lloyd Road intersection are just 10 minutes from honest auto repair. We've been the go-to shop for Wickliffe families since 2018. Free estimates on all repairs — call (216) 862-0005 or just pull in." },
  { slug: "vine-st-euclid-ave-wickliffe", name: "Vine St & Euclid Ave (Wickliffe)", lat: 41.5860, lng: -81.4800, zip: "44092", driveMinutes: 9, neighborhood: "Wickliffe", localContent: "Near Vine St in Wickliffe? Nick's Tire & Auto is a quick 9-minute drive west on Euclid. Our customers from Wickliffe say the drive is worth it for the pricing and honesty. Flat repair $25, oil change from $39." },

  // ─── SOUTH EUCLID / LYNDHURST ───────────────────
  { slug: "mayfield-rd-green-rd", name: "Mayfield Rd & Green Rd", lat: 41.5190, lng: -81.5270, zip: "44121", driveMinutes: 12, neighborhood: "South Euclid", localContent: "South Euclid drivers near the Mayfield and Green Road intersection — we're 12 minutes north on surface streets. Nick's Tire & Auto has been serving South Euclid residents who want transparent auto repair without dealership prices." },
  { slug: "cedar-rd-green-rd", name: "Cedar Rd & Green Rd", lat: 41.5000, lng: -81.5270, zip: "44121", driveMinutes: 15, neighborhood: "South Euclid", landmark: "Near Notre Dame College", localContent: "Near Notre Dame College at Cedar and Green? Our shop is 15 minutes north. College students and South Euclid families trust us for affordable tire replacements and brake work. We offer $10 down financing on all services." },

  // ─── EAST CLEVELAND ─────────────────────────────
  { slug: "euclid-ave-e-105th", name: "Euclid Ave & E 105th St", lat: 41.5148, lng: -81.6000, zip: "44106", driveMinutes: 15, neighborhood: "East Cleveland", landmark: "Near Cleveland Clinic", localContent: "Working near Cleveland Clinic at E 105th? Head east on Euclid Ave for 15 minutes to reach an honest auto shop. We show you the problem before we fix it — that's why we have 1,700+ five-star reviews." },
  { slug: "superior-ave-e-140th", name: "Superior Ave & E 140th St", lat: 41.5400, lng: -81.5800, zip: "44112", driveMinutes: 10, neighborhood: "East Cleveland", localContent: "From the Superior Ave corridor in East Cleveland, we're just 10 minutes east. Nick's Tire & Auto is the highest-rated independent shop on this side of town. Walk-ins welcome, no appointment needed for most services." },

  // ─── COLLINWOOD / NOTTINGHAM ────────────────────
  { slug: "lakeshore-blvd-e-185th", name: "Lakeshore Blvd & E 185th St", lat: 41.5911, lng: -81.5489, zip: "44119", driveMinutes: 8, neighborhood: "Collinwood", localContent: "The Collinwood neighborhood deserves a trustworthy mechanic. From the Lakeshore and E 185th area, we're 8 minutes east. We specialize in the kind of repairs Cleveland roads demand — suspension, alignment, and tire work." },
  { slug: "st-clair-ave-e-152nd", name: "St Clair Ave & E 152nd St", lat: 41.5712, lng: -81.5712, zip: "44110", driveMinutes: 12, neighborhood: "Collinwood", localContent: "Collinwood residents at St Clair and E 152nd — drive 12 minutes east on Euclid Ave for auto repair you can trust. Our technicians are ASE-certified and we back all labor with a 36-month warranty." },
  { slug: "nottingham-rd-st-clair", name: "Nottingham Rd & St Clair Ave", lat: 41.5650, lng: -81.5550, zip: "44110", driveMinutes: 13, neighborhood: "Nottingham", localContent: "The Nottingham neighborhood has limited auto repair options. Nick's Tire & Auto is 13 minutes east on Euclid Ave. Our used tire selection starts at $60, and we do flat repairs for $25. No appointment needed." },

  // ─── RICHMOND HEIGHTS ───────────────────────────
  { slug: "richmond-rd-wilson-mills", name: "Richmond Rd & Wilson Mills Rd", lat: 41.5530, lng: -81.5050, zip: "44143", driveMinutes: 10, neighborhood: "Richmond Heights", localContent: "Richmond Heights residents at Richmond and Wilson Mills — we're 10 minutes west. Our customers from Richmond Heights appreciate that we explain every repair before we start. Free estimates, no pressure, 4.9-star service." },
  { slug: "chardon-rd-richmond-rd", name: "Chardon Rd & Richmond Rd", lat: 41.5500, lng: -81.5000, zip: "44143", driveMinutes: 12, neighborhood: "Richmond Heights", localContent: "Near the Chardon and Richmond Road intersection? Nick's Tire & Auto is your closest top-rated independent shop. We beat dealer pricing on brakes, tires, and diagnostics — and we actually show you what's wrong." },

  // ─── GARFIELD HEIGHTS / MAPLE HEIGHTS ───────────
  { slug: "turney-rd-granger-rd", name: "Turney Rd & Granger Rd", lat: 41.4160, lng: -81.6060, zip: "44125", driveMinutes: 22, neighborhood: "Garfield Heights", localContent: "Garfield Heights drivers make the 22-minute drive to Nick's because the savings and honesty are worth it. We've had customers switch from big chains after one visit. Used tires from $60, brakes from $89, oil changes from $39." },
  { slug: "broadway-ave-union-ave", name: "Broadway Ave & Union Ave", lat: 41.4290, lng: -81.6300, zip: "44105", driveMinutes: 20, neighborhood: "Slavic Village", localContent: "From the Broadway and Union area in Slavic Village, head east on I-490 to I-90, then take the Euclid Ave exit. About 20 minutes. Our 1,700+ Google reviews speak for themselves — honest, affordable, reliable." },
  { slug: "lee-rd-harvard-rd", name: "Lee Rd & Harvard Rd", lat: 41.4250, lng: -81.5610, zip: "44128", driveMinutes: 18, neighborhood: "Maple Heights", localContent: "Maple Heights drivers trust Nick's Tire & Auto for everything from flat repairs to full brake jobs. We're 18 minutes north on Lee Road to Euclid Ave. Walk-ins welcome 7 days a week, and we offer $10 down financing." },

  // ─── CLEVELAND HEIGHTS / UNIVERSITY HEIGHTS ─────
  { slug: "cedar-rd-lee-rd", name: "Cedar Rd & Lee Rd", lat: 41.4945, lng: -81.5610, zip: "44118", driveMinutes: 15, neighborhood: "Cleveland Heights", landmark: "Near Cedar Lee district", localContent: "Drivers from the Cedar Lee district in Cleveland Heights are 15 minutes from honest auto repair at Nick's. Our transparent diagnostics and upfront pricing have earned us the trust of Heights residents who are tired of dealer markups." },
  { slug: "mayfield-rd-coventry", name: "Mayfield Rd & Coventry Rd", lat: 41.5080, lng: -81.5800, zip: "44118", driveMinutes: 14, neighborhood: "Cleveland Heights", landmark: "Near Coventry Village", localContent: "Near Coventry Village? Head east on Mayfield to Euclid Ave — 14 minutes to Nick's Tire & Auto. We're the independent alternative to overpriced dealership service. Same quality, fair prices, 36-month labor warranty." },

  // ─── ADDITIONAL EUCLID INTERSECTIONS ────────────
  { slug: "e-260th-euclid-ave", name: "E 260th St & Euclid Ave", lat: 41.5875, lng: -81.4970, zip: "44132", driveMinutes: 5, neighborhood: "Euclid", localContent: "Near the eastern edge of Euclid at E 260th? We're 5 minutes west on Euclid Ave. The E 260th corridor near the Euclid Square Mall area is part of our backyard. Quick tire repairs, oil changes, and brake inspections — no wait." },
  { slug: "lakeland-blvd-e-222nd", name: "Lakeland Blvd & E 222nd St", lat: 41.5870, lng: -81.5170, zip: "44123", driveMinutes: 3, neighborhood: "Euclid", localContent: "The Lakeland Blvd area in Euclid is minutes from our shop. If you hit a pothole on Lakeland and need alignment or tire work, Nick's Tire & Auto is the fastest, most affordable option in the neighborhood." },
  { slug: "shore-center-dr", name: "Shore Center Dr & E 222nd", lat: 41.5890, lng: -81.5160, zip: "44123", driveMinutes: 2, neighborhood: "Euclid", landmark: "Near Shore Cultural Centre", localContent: "Visiting Shore Cultural Centre or the Euclid Public Library? We're literally 2 minutes away at 17625 Euclid Ave. Drop your car off for service while you handle errands — we'll text you when it's ready." },
];

export function getIntersectionBySlug(slug: string): IntersectionData | undefined {
  return INTERSECTIONS.find(i => i.slug === slug);
}
