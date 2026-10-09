/**
 * Golden lock - the service-category classifiers (ITEM D, 2026-10-09)
 *
 * FLAGGED: "four copies of categorizeService" - reportIngestion.ts,
 * engines/shared.ts, pricingIntelligence.ts, intelligenceEngines.ts.
 *
 * WHAT WAS TRUE: only two of the four were copies. engines/shared.ts and
 * intelligenceEngines.ts carried the same SERVICE_CATEGORIES table and the
 * same categorizeService body (a diff of the two blocks differs only in the
 * `export` keywords). intelligenceEngines.ts now imports both from
 * engines/shared.ts - one implementation.
 *
 * The other two are NOT copies - they are separate taxonomies with their own
 * vocabulary and match rules, so they keep their own tables:
 *   - report  (reportIngestion.ts): 13 snake_case keys, regexes, FIRST match
 *             wins, "other" fallback. scripts/ingest-reports.mjs (the LIVE report
 *             path, which cannot be imported: it runs main()) carries the same
 *             table, held byte-identical by the last test in this file.
 *   - payment (pricingIntelligence.ts): Title Case labels shown in the
 *             collections alert, lowercase SUBSTRING keywords, first match.
 *   - engines (engines/shared.ts, the canonical multi-label view): 10 keys,
 *             EVERY matching key returned (string[]), [] when nothing matches.
 * Deriving either single-label view from the engines one changed 62 (report)
 * and 25 (payment) of the 153 rows below even with the best key mapping and
 * priority order, so each caller keeps the output it has today.
 *
 * PROVENANCE: every row's three outputs were recorded from the
 * PRE-consolidation source at e07c34aa - each copy's table + function was
 * read with `git show`, transpiled and run on this corpus. On that run the
 * intelligenceEngines.ts copy matched engines/shared.ts on all 153 rows.
 *
 * THE ROWS PIN TODAY'S OUTPUT, NOT THE RIGHT ANSWER. Known misclassifications
 * kept on purpose (changing a taxonomy is a product decision, not a
 * consolidation):
 *   report  - (fixed 2026-10-09: `ac_heat: /a.*c/i` took any text with an "a"
 *             before a "c", so "Diagnostic Service", "STATE INSPECTION",
 *             "maintenance" and "LABOR CHARGE" were A/C; it is now a word-bounded
 *             A/C, and those 11 rows were re-recorded.) `tires: ...|plug|` takes
 *             "SPARK PLUG" before engine sees it; `brakes: ...|abs|` takes
 *             "SHOCK ABSORBER"; no keyword for the word "suspension".
 *   engines - no A/C category ("AC Service" -> []), "AC compressor clutch" ->
 *             transmission, "CABIN AIR FILTER" -> oil, "MOTOR MOUNT" -> tires.
 *   payment - "MOTOR MOUNT" -> Tires, no radiator / water pump keyword,
 *             "oil-change" (hyphen) -> Other.
 * Fix one deliberately and update its row here in the same change.
 *
 * Every assertion goes through an existing export, never a test-only one:
 * parseTotalSalesReport (report - note its parse/analytics exports have no
 * production caller today, they sit in the knip orphan baseline),
 * getServicePaymentBreakdown (payment - feeds the pricing-intelligence cron
 * alert), the canonical categorizeService, and forecastSeasonalDemand +
 * analyzeChatDemand (the two intelligenceEngines consumer shapes: the
 * function and the bare table). The DB is mocked; nothing opens a connection.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbState = vi.hoisted(() => ({ rows: [] as unknown[] }));

// One fake handle for every importer of server/db: execute() answers the raw
// SQL readers ([rows, fields] tuple), select().from().where() the builder one.
vi.mock("../db", () => {
  const fake = {
    execute: async () => [dbState.rows, []],
    select: () => ({ from: () => ({ where: async () => dbState.rows }) }),
  };
  return { getDb: async () => fake };
});
// pricingIntelligence imports it at module load; keep the test network-free.
vi.mock("../google-reviews", () => ({ getGoogleReviews: vi.fn().mockResolvedValue(null) }));

import { categorizeService, SERVICE_CATEGORIES } from "./engines/shared";
import { parseTotalSalesReport } from "./reportIngestion";
import { getServicePaymentBreakdown } from "./pricingIntelligence";
import { analyzeChatDemand, forecastSeasonalDemand } from "./intelligenceEngines";

type Row = [description: string, report: string, payment: string, engines: string[]];

// prettier-ignore
const GOLDEN: Row[] = [
  ["oil change", "oil_change", "Oil Change", ["oil"]],
  ["Oil change", "oil_change", "Oil Change", ["oil"]],
  ["OIL CHANGE", "oil_change", "Oil Change", ["oil"]],
  ["Oil Change Service", "oil_change", "Oil Change", ["oil"]],
  ["SYNTHETIC OIL CHANGE", "oil_change", "Oil Change", ["oil"]],
  ["OIL & FILTER", "oil_change", "Oil Change", ["oil"]],
  ["LUBE OIL FILTER", "oil_change", "Oil Change", ["oil"]],
  ["oil-change", "oil_change", "Other", ["oil"]],
  ["oil/filter change", "oil_change", "General Maintenance", ["oil"]],
  ["Oil leak", "other", "Other", []],
  ["brakes", "brakes", "Brakes", ["brakes"]],
  ["Brakes", "brakes", "Brakes", ["brakes"]],
  ["front brakes", "brakes", "Brakes", ["brakes"]],
  ["front brake pads and rotors", "brakes", "Brakes", ["brakes"]],
  ["Front brake pads + rotors", "brakes", "Brakes", ["brakes"]],
  ["brake pads", "brakes", "Brakes", ["brakes"]],
  ["brake PADS", "brakes", "Brakes", ["brakes"]],
  ["BrAkE pAdS", "brakes", "Brakes", ["brakes"]],
  ["brake-pads", "brakes", "Brakes", ["brakes"]],
  ["brake_pads", "brakes", "Brakes", ["brakes"]],
  ["Brake job", "brakes", "Brakes", ["brakes"]],
  ["brake inspection", "brakes", "Brakes", ["brakes", "diagnostic"]],
  ["Brake check", "brakes", "Brakes", ["brakes"]],
  ["brakes squealing", "brakes", "Brakes", ["brakes"]],
  ["Complete brake overhaul \u00b7 all four corners \u00b7 pads and rotors", "brakes", "Brakes", ["brakes"]],
  ["BRAKE BRAKE BRAKE", "brakes", "Brakes", ["brakes"]],
  ["CALIPER REPLACEMENT", "brakes", "Brakes", ["brakes"]],
  ["BRAKE FLUID BLEED", "brakes", "Brakes", ["brakes"]],
  ["PARKING BRAKE CABLE", "brakes", "Brakes", ["brakes"]],
  ["REAR DRUMS & SHOES", "brakes", "Other", []],
  ["ABS SENSOR", "brakes", "Other", []],
  ["tires", "tires", "Tires", ["tires"]],
  ["tire work", "tires", "Tires", ["tires"]],
  ["new tires mounted", "tires", "Tires", ["tires"]],
  ["4 tires mounted", "tires", "Tires", ["tires"]],
  ["four used tires mounted", "tires", "Tires", ["tires"]],
  ["2 used tires 225/65R17", "tires", "Tires", ["tires"]],
  ["Tire Service", "tires", "Tires", ["tires"]],
  ["Tire Order & Install \u2014 2x MICHELIN X (225/60R17)", "tires", "Tires", ["tires"]],
  ["MOUNT & BALANCE (4)", "tires", "Tires", ["tires"]],
  ["MOUNT AND BALANCE TIRES", "tires", "Tires", ["tires"]],
  ["Balance", "other", "Tires", ["tires"]],
  ["TIRE ROTATION", "tires", "Tires", ["tires"]],
  ["flat tire repair", "tires", "Tires", ["tires"]],
  ["Need tire patch", "tires", "Tires", ["tires"]],
  ["FLAT REPAIR / PLUG", "tires", "Other", []],
  ["TPMS SENSOR REPLACEMENT", "tires", "Other", []],
  ["VALVE STEM REPLACEMENT", "tires", "Engine", ["engine"]],
  ["TIRE DISPOSAL FEE", "tires", "Tires", ["tires"]],
  ["Wheel Alignment", "alignment", "Tires", ["tires"]],
  ["alignment", "alignment", "Tires", ["tires"]],
  ["4 tires + alignment", "tires", "Tires", ["tires"]],
  ["flux capacitor realignment", "alignment", "Tires", ["tires"]],
  ["suspension", "other", "Suspension", ["suspension"]],
  ["Suspension work \u00b7 struts", "suspension", "Suspension", ["suspension"]],
  ["REMOVE & REPLACE FRONT STRUT ASSEMBLY (ONE)", "suspension", "Suspension", ["suspension"]],
  ["REMOVE & REPLACE LOWER CONTROL ARM", "suspension", "Suspension", ["suspension"]],
  ["REMOVE & REPLACE FRONT HUB OR BEARING(ONE)", "suspension", "Other", []],
  ["wheel bearing", "suspension", "Other", []],
  ["SHOCK ABSORBER REPLACEMENT (REAR)", "brakes", "Suspension", ["suspension"]],
  ["REPLACE FRONT SHOCKS", "suspension", "Suspension", ["suspension"]],
  ["SWAY BAR LINK", "suspension", "Other", []],
  ["OUTER TIE ROD END", "suspension", "Suspension", ["suspension"]],
  ["BALL JOINT", "suspension", "Suspension", ["suspension"]],
  ["struts/shocks & alignment", "alignment", "Tires", ["tires", "suspension"]],
  ["engine work", "engine", "Engine", ["engine"]],
  ["TUNE UP (MAJOR) INCLUDING ADJUSTMENTS", "engine", "Other", []],
  ["SPARK PLUG REPLACEMENT", "tires", "Engine", []],
  ["REPLACE SPARK PLUGS & IGNITION COILS", "tires", "Engine", []],
  ["OXYGEN SENSOR", "engine", "Other", []],
  ["O2 SENSOR", "electrical", "Other", []],
  ["SERPENTINE BELT", "engine", "General Maintenance", []],
  ["TIMING BELT & WATER PUMP", "engine", "Engine", ["engine", "cooling"]],
  ["VALVE COVER GASKET", "engine", "Engine", ["engine"]],
  ["HEAD GASKET", "engine", "Engine", ["engine"]],
  ["MOTOR MOUNT", "engine", "Tires", ["tires"]],
  ["COMPRESSION TEST", "other", "Other", ["engine"]],
  ["Check Engine Light Diagnosis", "engine", "Engine", ["engine", "diagnostic"]],
  ["CHECK ENGINE LIGHT", "engine", "Engine", ["engine", "diagnostic"]],
  ["REMOVE & REPLACE ALTERNATOR", "engine", "Electrical", ["electrical"]],
  ["Alternator Replacement", "engine", "Electrical", ["electrical"]],
  ["Starter Replacement", "engine", "Electrical", ["electrical"]],
  ["STARTER", "engine", "Electrical", ["electrical"]],
  ["BATTERY REPLACEMENT", "electrical", "Electrical", ["electrical"]],
  ["BATTERY TEST", "electrical", "Electrical", ["electrical"]],
  ["batt + alternator test", "engine", "Electrical", ["electrical"]],
  ["HEADLIGHT BULB", "electrical", "Other", []],
  ["WINDOW REGULATOR", "electrical", "Other", []],
  ["REMOVE & REPLACE WIPER BLADE", "electrical", "Other", []],
  ["WIPER BLADES", "electrical", "Other", []],
  ["FUSE / RELAY", "electrical", "Other", ["electrical"]],
  ["WIRING REPAIR", "other", "Electrical", ["electrical"]],
  ["REMOVE & REPLACE WATER PUMP", "cooling", "Other", ["cooling"]],
  ["REMOVE & REPLACE RADIATOR", "cooling", "Other", ["cooling"]],
  ["COOLANT FLUSH", "cooling", "General Maintenance", ["cooling"]],
  ["THERMOSTAT & HOUSING", "cooling", "Other", ["cooling"]],
  ["HEATER CORE", "cooling", "AC/Heating", ["cooling"]],
  ["overheating, replace radiator & thermostat", "cooling", "Other", ["cooling"]],
  ["Heater not working", "ac_heat", "Other", []],
  ["REMOVE & REPLACE CATALYTIC CONVERTER", "engine", "Exhaust", ["exhaust"]],
  ["Exhaust Repair", "engine", "Exhaust", ["exhaust"]],
  ["EXHAUST MANIFOLD GASKET", "engine", "Exhaust", ["exhaust"]],
  ["MUFFLER WELD", "engine", "Exhaust", ["exhaust"]],
  ["FLEX PIPE", "engine", "Exhaust", ["exhaust"]],
  ["Emissions / E-Check Repair", "inspection", "Other", []],
  ["POWER STEERING PUMP", "steering", "General Maintenance", []],
  ["POWER STEERING FLUID FLUSH", "steering", "General Maintenance", []],
  ["STEERING RACK", "steering", "Other", []],
  ["Transmission rebuild", "transmission", "Transmission", ["transmission"]],
  ["Transmission Service", "transmission", "Transmission", ["transmission"]],
  ["TRANS FLUID FLUSH", "transmission", "Transmission", ["transmission"]],
  ["CV AXLE REPLACEMENT", "transmission", "Other", []],
  ["DRIVE SHAFT U-JOINT", "transmission", "Other", []],
  ["CLUTCH KIT", "other", "Other", ["transmission"]],
  ["AC Service", "ac_heat", "AC/Heating", []],
  ["AC RECHARGE", "ac_heat", "AC/Heating", []],
  ["A/C COMPRESSOR", "ac_heat", "AC/Heating", []],
  ["A/C EVAC & RECHARGE", "ac_heat", "AC/Heating", []],
  ["a/c not blowing cold", "ac_heat", "AC/Heating", []],
  ["AC compressor clutch", "ac_heat", "AC/Heating", ["transmission"]],
  ["FREON", "ac_heat", "AC/Heating", []],
  ["CABIN AIR FILTER", "other", "General Maintenance", ["oil"]],
  ["ENGINE AIR FILTER", "engine", "Engine", ["oil", "engine"]],
  ["FUEL PUMP", "other", "Other", []],
  ["FUEL FILTER", "other", "General Maintenance", ["oil"]],
  ["Diagnostic Service", "inspection", "Diagnostics", ["diagnostic"]],
  ["DIAGNOSTIC SCAN", "inspection", "Diagnostics", ["diagnostic"]],
  ["STATE INSPECTION", "inspection", "Diagnostics", ["diagnostic"]],
  ["PRE-PURCHASE INSPECTION", "inspection", "Diagnostics", ["diagnostic"]],
  ["MULTI-POINT INSPECTION", "inspection", "Diagnostics", ["diagnostic"]],
  ["Oil change + tire rotation + brake inspection", "brakes", "Oil Change", ["brakes", "tires", "oil", "diagnostic"]],
  ["Front brakes; rear shocks; alignment", "brakes", "Brakes", ["brakes", "tires", "suspension"]],
  ["brake pads, rotors, calipers & fluid flush", "brakes", "Brakes", ["brakes"]],
  ["REMOVE & REPLACE", "other", "Other", []],
  ["INSTALL TRAILER HITCH", "other", "Other", []],
  ["REPLACE WHEEL STUD", "other", "Other", []],
  ["LABOR CHARGE", "other", "Other", []],
  ["SHOP SUPPLIES", "other", "Other", []],
  ["HAZARDOUS WASTE DISPOSAL", "other", "Other", []],
  ["MISC PARTS", "other", "Other", []],
  ["maintenance", "other", "Other", []],
  ["Order: TO-20260923-388", "other", "Other", []],
  ["Cash sale", "other", "Other", []],
  ["", "other", "Other", []],
  ["   ", "other", "Other", []],
  ["N/A", "other", "Other", []],
  ["-", "other", "Other", []],
  ["???", "other", "Other", []],
  ["12345", "other", "Other", []],
  ["lorem ipsum", "other", "Other", []],
  ["ac", "ac_heat", "Other", []],
  ["Ac", "ac_heat", "Other", []],
  ["abc", "other", "Other", []],
];

/**
 * Every row whose observed output differs, one readable line each, so a
 * single failure names all the drifted rows instead of the first one.
 */
function mismatches<T>(observed: (row: Row, i: number) => T, expected: (row: Row) => T): string[] {
  const out: string[] = [];
  GOLDEN.forEach((row, i) => {
    const got = JSON.stringify(observed(row, i));
    const want = JSON.stringify(expected(row));
    if (got !== want) out.push(`${JSON.stringify(row[0])}: recorded ${want}, now ${got}`);
  });
  return out;
}

beforeEach(() => {
  dbState.rows = [];
});

describe("engines/shared categorizeService - canonical multi-label view", () => {
  it("returns the recorded categories for every corpus row", () => {
    expect(mismatches((r) => categorizeService(r[0]), (r) => r[3])).toEqual([]);
  });
});

describe("reportIngestion - ShopDriver report taxonomy (single label, first match)", () => {
  it("parseTotalSalesReport assigns the recorded serviceCategory to every invoice line", () => {
    const content = GOLDEN.map(
      ([d], i) => `${1000 + i}\t\tDOE, JOHN\t${d}\t$0.00\t$0.00\t$0.00\t$0.00\t$0.00\tCASH`,
    ).join("\n");
    const { invoices } = parseTotalSalesReport(content);
    // Instrument check: every row must reach the classifier, or the
    // comparison below would pass vacuously over a short list.
    expect(invoices.length).toBe(GOLDEN.length);
    expect(mismatches((_r, i) => invoices[i].serviceCategory, (r) => r[1])).toEqual([]);
  });
});

describe("pricingIntelligence - payment-alert labels (single label, first match)", () => {
  it("getServicePaymentBreakdown files every description under the recorded label", async () => {
    const observed: string[] = [];
    for (const [d] of GOLDEN) {
      // 3 rows: the breakdown drops categories with fewer data points.
      dbState.rows = [0, 1, 2].map(() => ({ serviceDescription: d, paymentStatus: "paid" }));
      const breakdown = await getServicePaymentBreakdown(30);
      expect(breakdown, `breakdown for ${JSON.stringify(d)}`).toHaveLength(1);
      observed.push(breakdown[0].service);
    }
    expect(mismatches((_r, i) => observed[i], (r) => r[2])).toEqual([]);
  });
});

describe("intelligenceEngines - classifies through engines/shared (one implementation)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forecastSeasonalDemand reports the recorded categories for every corpus row", async () => {
    const observed: string[][] = [];
    for (const [d] of GOLDEN) {
      dbState.rows = [{ monthNum: 10, yearNum: 2025, serviceDescription: d, cnt: "1" }];
      const { hotServices } = await forecastSeasonalDemand();
      observed.push(hotServices.map((s) => s.service));
    }
    expect(mismatches((_r, i) => observed[i], (r) => r[3])).toEqual([]);
  });

  it("analyzeChatDemand reports the recorded categories for every corpus row", async () => {
    const observed: string[][] = [];
    for (const [d] of GOLDEN) {
      dbState.rows = [{ problemSummary: d, vehicleInfo: null, converted: false, createdAt: new Date() }];
      const { demandByService } = await analyzeChatDemand();
      observed.push(demandByService.map(([key]) => key));
    }
    expect(mismatches((_r, i) => observed[i], (r) => r[3])).toEqual([]);
  });

  // The wiring proof. A category added to the canonical table must show up in
  // BOTH intelligenceEngines consumers - categorizeService() callers and the
  // direct SERVICE_CATEGORIES loop. A private copy of the table or of the
  // function inside intelligenceEngines.ts cannot see it, which is exactly
  // the drift this consolidation removed. The golden rows above cannot catch
  // that: two identical copies agree until the day one of them is edited.
  async function withSentinelCategory(run: () => Promise<void>) {
    const sentinel = { key: "sentinel_category", pattern: /zz-sentinel-service/i };
    SERVICE_CATEGORIES.push(sentinel);
    try {
      await run();
    } finally {
      SERVICE_CATEGORIES.splice(SERVICE_CATEGORIES.indexOf(sentinel), 1);
    }
    expect(SERVICE_CATEGORIES).not.toContain(sentinel);
  }

  it("a category added to the engines/shared table reaches forecastSeasonalDemand", async () => {
    await withSentinelCategory(async () => {
      dbState.rows = [{ monthNum: 10, yearNum: 2025, serviceDescription: "ZZ-SENTINEL-SERVICE + brakes", cnt: "1" }];
      const { hotServices } = await forecastSeasonalDemand();
      expect(hotServices.map((s) => s.service)).toEqual(["brakes", "sentinel_category"]);
    });
  });

  it("a category added to the engines/shared table reaches analyzeChatDemand", async () => {
    await withSentinelCategory(async () => {
      dbState.rows = [{ problemSummary: "zz-sentinel-service", vehicleInfo: null, converted: false, createdAt: new Date() }];
      const { demandByService } = await analyzeChatDemand();
      expect(demandByService.map(([key]) => key)).toEqual(["sentinel_category"]);
    });
  });
});

describe("scripts/ingest-reports.mjs carries the same report table (it is the live path)", () => {
  // The script runs main() on import, so its classifier cannot be called here. Holding its
  // table byte-identical to reportIngestion.ts makes the report column above pin it too: it
  // had drifted (no engine / overheat / alternator keywords) and shared the broken A/C regex.
  const tableOf = (path: string) => {
    const text = readFileSync(join(__dirname, path), "utf8");
    const m = /const SERVICE_CATEGORIES(?:: Record<string, RegExp>)? = \{\n([\s\S]*?)\n\};/.exec(text);
    expect(m, `no SERVICE_CATEGORIES table found in ${path}`).not.toBeNull();
    return m![1];
  };
  it("the two tables are byte-identical", () => {
    const live = tableOf("../../scripts/ingest-reports.mjs");
    expect(live.split("\n").length).toBeGreaterThan(10);
    expect(live).toBe(tableOf("reportIngestion.ts"));
  });
});
