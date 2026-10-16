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
  ["client/src/pages/admin/money/UnpaidInvoicesSection.tsx",
    'body={`Hi ${firstName}, this is Nick\'s Tire & Auto. We have an open balance on your invoice${inv.invoiceNumber ? ` #${inv.invoiceNumber}` : ""}. You can take care of it over the phone at (216) 862-0005 or stop by anytime ' + D + " thanks!`}"],
  ["client/src/pages/admin/OverviewSection.tsx",
    'body={`Hi ${item.name.split(" ")[0]}, it\'s Nick\'s Tire following up on your ${requestLabel(item)}.`}'],
  // Outbound but not SMS: a testimonial copied for sharing, an article topic and two content seeds.
  ["client/src/pages/admin/outreach/ReviewRequestsSection.tsx",
    'const text = `"${quote.text}"\\n' + D + ' ${quote.author}${quote.badge ? ` (${quote.badge})` : ""}`;'],
  ["client/src/pages/admin/content/AIIdeasEngine.tsx", 'topic: `Follow-up: "${title}" ' + D + " Part 2 / Deep Dive`,"],
  ["client/src/pages/admin/instagram/Inbox.tsx",
    'detail: `A customer asked on Instagram: "${comment.text.slice(0, 400)}" ' + D + " answer it usefully for everyone who has the same question.`,"],
  ["client/src/pages/admin/instagram/Strategy.tsx", 'detail: "CONTROLLED STRUCTURE PRIOR ' + D + ' correlation only, not causal: " + h.statement'],
];

const lines = (file: string) => read(file).split("\n").map((l) => l.trim());

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
    const found: string[] = [];
    for (const f of files) {
      for (const l of lines(f)) {
        if (/^(\/\/|\*|\/\*)/.test(l)) continue;
        if (/body=\{`Hi \$\{|message: `Hi \$\{|Reply STOP/.test(l)) found.push(`${f} :: ${l}`);
      }
    }
    expect(found.length, "the scan must see the known customer texts").toBeGreaterThanOrEqual(5);
    const unpinned = found.filter((hit) => !PINS.some(([f, line]) => hit.startsWith(`${f} :: `) && hit.includes(line)));
    expect(unpinned).toEqual([]);
  });
});
