/**
 * Weekly GBP photo shot-list — what to photograph and upload to the
 * Google Business Profile each week.
 *
 * 2026-06-10 GBP growth wave. GBP photos are sporadic and mostly
 * customer-uploaded; fresh owner photos lift local ranking and trust.
 * This generates a balanced weekly rotation; nothing uploads anywhere
 * (no Google Photos / GBP mutation). The owner shoots + uploads manually.
 */

export type PhotoCategory =
  | "Exterior"
  | "Interior"
  | "Team / Technician"
  | "Tire Work"
  | "Brakes"
  | "Diagnostics"
  | "E-Check / Emissions"
  | "Waiting / Customer Comfort"
  | "Before/After"
  | "Seasonal";

export interface PhotoTask {
  title: string;
  category: PhotoCategory;
  instructions: string;
  whyItHelps: string;
  caption: string;
}

/** Privacy + safety rules that apply to EVERY photo. */
export const PHOTO_SAFETY_RULES = [
  "No visible license plates unless blurred.",
  "No customer faces without their spoken permission.",
  "No private paperwork, invoices, or screens with personal data.",
  "No unsafe shop scenes (no one under an unsupported vehicle, etc.).",
  "Tidy the background if you can — clutter reads as careless.",
] as const;

export const UPLOAD_DESTINATION = "Google Business Profile → Photos";

/** The full pool, one or more per category, drawn from each week. */
const PHOTO_POOL: PhotoTask[] = [
  { title: "Storefront in daylight", category: "Exterior", instructions: "Shoot the building face-on from across the lot so the sign and Euclid Ave entrance are clearly readable. Mid-day light, no cars blocking the sign.", whyItHelps: "Helps customers recognize the shop from the street and confirms the location matches the map pin.", caption: "Find us on Euclid Ave in Cleveland — walk-ins welcome 7 days a week." },
  { title: "Bay with a car on the lift", category: "Interior", instructions: "Wide shot of a clean bay with a vehicle safely on the lift, tools organized. No faces, no plates.", whyItHelps: "Shows real working bays — proof it's a legit, equipped shop, not a pop-up.", caption: "Inside the shop — real bays, real equipment, real mechanics." },
  { title: "Technician mid-job", category: "Team / Technician", instructions: "A tech working on a vehicle, hands on the job, from the side or behind. Get permission; no identifiable customer info in frame.", whyItHelps: "People trust faces and craftsmanship — humanizes the shop.", caption: "The crew that actually does the work." },
  { title: "Tire mount + balance", category: "Tire Work", instructions: "Close-up of a tire on the balancer or being mounted. Crisp focus on the work.", whyItHelps: "Tires are the headline service — visual proof of capability.", caption: "New and used tires, mounted and balanced while you wait." },
  { title: "Brake job in progress", category: "Brakes", instructions: "Rotor/caliper exposed with new pads visible, clean shot. Before/after pairs well here.", whyItHelps: "Brakes are a high-intent search — shows you do the work properly.", caption: "Brakes done right — pads, rotors, and lines checked before any work starts." },
  { title: "Diagnostic scanner on a vehicle", category: "Diagnostics", instructions: "Scan tool plugged in / reading codes, or a tech reviewing results. No customer data on screen.", whyItHelps: "Backs the 'we diagnose before replacing parts' message that wins trust.", caption: "We pull the codes and find the real problem — not the most expensive one." },
  { title: "E-Check / emissions help", category: "E-Check / Emissions", instructions: "A vehicle being worked on for an emissions-related fix, or the diagnostic step. Keep any failure report out of frame.", whyItHelps: "Ohio E-Check is a recurring local need — captures that search intent.", caption: "Failed Ohio E-Check? We diagnose the cause and get you passing." },
  { title: "Waiting area", category: "Waiting / Customer Comfort", instructions: "Clean, welcoming waiting space — seating, maybe coffee. Tidy and bright.", whyItHelps: "Reassures customers (especially first-timers) it's a comfortable, professional place.", caption: "Wait with us or drop off and Uber out — your call." },
  { title: "Before/after of a real repair", category: "Before/After", instructions: "Two shots of the same part — worn vs replaced (old tire vs new, worn pad vs new). No customer info.", whyItHelps: "Before/after is the most persuasive proof format on GBP.", caption: "Before and after — honest work you can see." },
  { title: "Seasonal: weather-ready tires/service", category: "Seasonal", instructions: "Tie to the current season — winter tread depth check, summer AC service, pothole-season alignment. Shoot whatever's timely.", whyItHelps: "Seasonal relevance signals an active, current profile to Google and customers.", caption: "Getting Cleveland drivers ready for the season ahead." },
  { title: "Alignment rack", category: "Interior", instructions: "Vehicle on the alignment rack with the readout visible (no customer data). Wide enough to show the equipment.", whyItHelps: "Alignment is an under-marketed capability — pothole season makes it timely.", caption: "Every new-tire install gets an alignment check on the rack." },
  { title: "Oil change service", category: "Interior", instructions: "Oil being changed / filter swap, clean and well-lit.", whyItHelps: "Oil changes are a frequent entry-point service that brings repeat visits.", caption: "Quick oil changes with a courtesy inspection — no appointment needed." },
];

/**
 * Deterministic weekly rotation: 6 tasks, balanced so no category repeats
 * back-to-back across weeks. `weekIndex` = weeks since an arbitrary epoch
 * (caller computes it; this module takes no clock so it stays pure and
 * testable). Always returns a stable, non-empty list.
 */
export function weeklyPhotoQueue(weekIndex: number): PhotoTask[] {
  const COUNT = 6;
  const n = PHOTO_POOL.length;
  const start = ((weekIndex % n) + n) % n;
  const out: PhotoTask[] = [];
  const seenCat = new Set<PhotoCategory>();
  // First pass: take from the rotating window, preferring category variety.
  for (let i = 0; i < n && out.length < COUNT; i++) {
    const task = PHOTO_POOL[(start + i) % n];
    if (!seenCat.has(task.category)) {
      out.push(task);
      seenCat.add(task.category);
    }
  }
  // Second pass: fill any remaining slots allowing repeats (small pool weeks).
  for (let i = 0; i < n && out.length < COUNT; i++) {
    const task = PHOTO_POOL[(start + i) % n];
    if (!out.includes(task)) out.push(task);
  }
  return out;
}
