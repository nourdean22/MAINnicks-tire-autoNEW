/**
 * Copy that leaves the admin stays byte-identical through UI sweeps.
 *
 * Admin UI v1 W1 ran codemods over admin UI strings (case, em dash, emoji). Four customer SMS bodies
 * were rewritten by accident and restored in the same wave; customer copy is owned by the brand voice,
 * not by a chrome sweep. Each line below is pinned exactly as it shipped before W1 (4d3ad1272).
 *
 * Discovery half: every line in the admin tree that looks like a customer text (an SMS prefill
 * `body={`Hi ...`, a win-back `message: `Hi ...`, a "Reply STOP" footer) must be one of the pinned
 * lines, so a new customer string is pinned on purpose instead of being swept by accident.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";
import { OIL_PRICE } from "@shared/pricing";
import { PRESETS } from "@/pages/admin/WalkInCalculatorSection";

const ROOT = process.cwd();
const D = String.fromCharCode(0x2014); // em dash, spelled so the ratchet scanner never sees one here
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PINS: Array<[file: string, line: string]> = [
  ["client/src/pages/admin/customers/WinBackButton.tsx",
    "message: `Hi ${name}, it's Nick's Tire & Auto " + D + " been a while! Come in for a FREE safety inspection, no charge, no appointment needed. (216) 862-0005. Reply STOP to opt out.`,"],
  ["client/src/pages/admin/CallTrackingSection.tsx",
    'body={`Hi ${(cb.name || "there").split(" ")[0]}, it\'s Nick\'s Tire. Returning your call ' + D + " give us a ring back when you can: (216) 862-0005.`}"],
  ["client/src/pages/admin/money/DeclinedEstimatesSection.tsx",
    'body={`Hi ${est.customerName?.split(" ")[0] || ""}, this is Nick\'s Tire & Auto following up on your recent estimate. Car problems usually get worse over time ' + D + " ready to take care of it? Call us at (216) 862-0005 or just stop by.`}"],
  ["client/src/pages/admin/OverviewSection.tsx",
    'body={`Hi ${item.name.split(" ")[0]}, it\'s Nick\'s Tire following up on your ${requestLabel(item)}.`}'],
  // Outbound but not SMS: a testimonial copied for sharing, an article topic and two content seeds.
  ["client/src/pages/admin/outreach/ReviewRequestsSection.tsx",
    'const text = `"${quote.text}"\\n' + D + ' ${quote.author}${quote.badge ? ` (${quote.badge})` : ""}`;'],
  ["client/src/pages/admin/instagram/Strategy.tsx", 'detail: "CONTROLLED STRUCTURE PRIOR ' + D + ' correlation only, not causal: " + h.statement'],
  // Walk-in quote lines: copyQuote() and window.print() hand these descriptions to the customer.
  ["client/src/pages/admin/WalkInCalculatorSection.tsx", "{ description: `Oil Change (conventional/blend 5qt) " + D + " starting at $${OIL_PRICE.conventional}`,"],
  ["client/src/pages/admin/WalkInCalculatorSection.tsx", "{ description: `Oil Change (full synthetic 5qt) " + D + " starting at $${OIL_PRICE.fullSynthetic}`,"],
  ["client/src/pages/admin/WalkInCalculatorSection.tsx", '{ description: "Brake Pads ' + D + ' Front Axle",'],
  ["client/src/pages/admin/WalkInCalculatorSection.tsx", '{ description: "Brake Pads + Rotors ' + D + ' Front",'],
];

const lines = (file: string) => read(file).split("\n").map((l) => l.trim());

// 4 since 2026-10-21: the Unpaid tab's open-balance text prefill was deleted with the tab.
const OUTBOUND_COUNT = 4;
// 33 since 2026-10-18: GatewayOrderPanel's "Place this order with D&K?" confirm (operator text, not customer copy).
// 28 since 2026-10-19: admin prune W1 deleted five confirm dialogs with their surfaces
// (Coupons, Loyalty, Technician referrals, QC review / Technicians, Inspection capture).
// 29 since 2026-10-23: the Opportunities "Hide this opportunity?" confirm (operator text, not customer copy).
const CHROME_COUNT = 29;

/** Every walk-in preset as the printed or copied quote shows it (OIL_PRICE from shared/pricing). */
const WALK_IN_DESCRIPTIONS = [
  `Oil Change (conventional/blend 5qt) ${D} starting at $${OIL_PRICE.conventional}`,
  `Oil Change (full synthetic 5qt) ${D} starting at $${OIL_PRICE.fullSynthetic}`,
  "Used Tire ($60 each, mount+balance)",
  `Brake Pads ${D} Front Axle`,
  `Brake Pads + Rotors ${D} Front`,
  "Wheel Alignment (4-wheel)",
  "Battery (standard)",
  "Diagnostic Scan",
  "Engine Air Filter",
  "Cabin Air Filter",
  "Wiper Blades (pair)",
  "Coolant Flush",
  "A/C Recharge (R134a)",
];

describe("customer and outbound copy in the admin is pinned byte for byte", () => {
  it.each(PINS)("%s keeps its outbound string", (file, line) => {
    expect(lines(file).some((l) => l.includes(line)), `${file} lost: ${line.slice(0, 90)}`).toBe(true);
  });
});

describe("every customer text in the admin tree is pinned", () => {
  it("no SMS prefill, win-back body or STOP footer exists outside the pin list", () => {
    const files: string[] = ["client/src/pages/Admin.tsx"];
    const walk = (d: string) => {
      for (const n of readdirSync(join(ROOT, d))) {
        if (n.startsWith(".") || n === "__tests__") continue;
        const p = `${d}/${n}`;
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.(test|spec)\./.test(n)) files.push(p);
      }
    };
    ["client/src/pages/admin", "client/src/components/admin"].forEach(walk);
    // Candidates: any `body={`...`}` template (SMS prefills), any `message: `...`` template string and
    // any "Reply STOP" footer. A `message:` inside a confirmDialog({...}) call is the operator's own
    // confirm text (UI chrome); every other candidate leaves the admin and must be pinned.
    const outbound: string[] = [];
    const chrome: string[] = [];
    for (const f of files) {
      const ls = lines(f);
      ls.forEach((l, i) => {
        if (/^(\/\/|\*|\/\*)/.test(l)) return;
        if (!/body=\{`|message: `|Reply STOP/.test(l)) return;
        const confirm = /message: `/.test(l) && ls.slice(Math.max(0, i - 4), i + 1).some((p) => p.includes("confirmDialog("));
        (confirm ? chrome : outbound).push(`${f} :: ${l}`);
      });
    }
    // Exact counts (2026-10-16): a new candidate of either kind turns this red until it is classified.
    expect(outbound.length, outbound.join("\n")).toBe(OUTBOUND_COUNT);
    expect(chrome.length, "confirm-dialog messages seen by the scan").toBe(CHROME_COUNT);
    const unpinned = outbound.filter((hit) => !PINS.some(([f, line]) => hit.startsWith(`${f} :: `) && hit.includes(line)));
    expect(unpinned).toEqual([]);
  });

  it("every walk-in preset description is the one the customer's quote shows", () => {
    const desc = PRESETS.map((p) => p.description);
    expect(desc).toEqual(WALK_IN_DESCRIPTIONS);
    // The source array and the import agree: no preset hides from the pin by being built elsewhere.
    const src = read("client/src/pages/admin/WalkInCalculatorSection.tsx");
    const block = sliceBlock(src, "export const PRESETS", "];", { label: "WalkInCalculatorSection.tsx" });
    expect((block.match(/\{ description: /g) ?? []).length).toBe(WALK_IN_DESCRIPTIONS.length);
  });
});
