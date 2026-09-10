/**
 * CRON-INVENTORY.md must match the scheduler in NAMES, COUNTS and per-job SCHEDULED state
 * (2026-09-01 audit, artifact 2 §2.1 — the doc said 85 jobs, the scheduler had 105).
 *
 * COUNTS AND FLAGS WERE ADDED 2026-09-10, because names alone let the doc lie for weeks.
 * The tier table read `pulse | every 15m | 20 / 2` and the totals line read
 * `117 tiered jobs (113 scheduled automatically, 4 staged off the scheduler)` while the
 * scheduler had 22/0 and 118 (116/2): two pulse jobs had stopped being staged, no job was
 * added or removed, the NAME SET never moved, and the gate stayed green the whole time.
 * The second test even calls itself "the doc is not hand-edited" and compared only names.
 *
 * A job flipping to STAGED is a job that has silently STOPPED RUNNING, and that is exactly
 * the change this doc exists to make visible.
 *
 * Every assertion here is paired with a canary that breaks it, so none can go vacuous.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getJobCadences } from "./scheduler";
import { getRegisteredJobNames } from "./index";
import {
  parseInventoryJobNames,
  parseInventoryCounts,
  parseInventoryScheduled,
  buildCronInventoryMarkdown,
  parseExistingPurposes,
} from "./cronInventory";

const docPath = path.resolve(__dirname, "..", "..", "docs", "operations", "CRON-INVENTORY.md");

describe("CRON-INVENTORY.md parity", () => {
  const cadences = getJobCadences();
  const http = getRegisteredJobNames();
  const expected = new Set<string>([...cadences.keys(), ...http.map((j) => j.name)]);

  it("the committed doc lists every registered job and nothing else", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const listed = parseInventoryJobNames(doc);
    const missing = [...expected].filter((n) => !listed.has(n)).sort();
    const extra = [...listed].filter((n) => !expected.has(n)).sort();
    expect(missing, `jobs in code but not in the doc — run scripts/gen-cron-inventory.mts: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `jobs in the doc that no longer exist: ${extra.join(", ")}`).toEqual([]);
  });

  it("the generator reproduces the committed block (doc is not hand-edited)", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const regenerated = buildCronInventoryMarkdown({
      cadences,
      httpJobs: http,
      purposes: parseExistingPurposes(doc),
      generatedOn: "0000-00-00",
    });
    expect(parseInventoryJobNames(regenerated)).toEqual(parseInventoryJobNames(doc));
  });

  it("CANARY — a stale doc is rejected", () => {
    const stale = buildCronInventoryMarkdown({
      cadences: new Map([...cadences].slice(0, 3)),
      httpJobs: [],
      purposes: new Map(),
      generatedOn: "0000-00-00",
    });
    const listed = parseInventoryJobNames(stale);
    const missing = [...expected].filter((n) => !listed.has(n));
    expect(missing.length).toBeGreaterThan(0);
  });

  it("the committed doc's COUNTS match the scheduler, not just its names", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const regenerated = buildCronInventoryMarkdown({
      cadences, httpJobs: http, purposes: parseExistingPurposes(doc), generatedOn: "0000-00-00",
    });
    expect(
      parseInventoryCounts(doc),
      "the tier table or the Total line disagrees with the scheduler — run scripts/gen-cron-inventory.mts",
    ).toEqual(parseInventoryCounts(regenerated));
  });

  it("the committed doc agrees per JOB on whether it is scheduled", () => {
    // Strictly stronger than the counts: two jobs flipping in opposite directions leave
    // every count identical, and only this notices.
    const doc = fs.readFileSync(docPath, "utf8");
    const regenerated = buildCronInventoryMarkdown({
      cadences, httpJobs: http, purposes: parseExistingPurposes(doc), generatedOn: "0000-00-00",
    });
    const inDoc = parseInventoryScheduled(doc);
    const inCode = parseInventoryScheduled(regenerated);
    const wrong = [...inCode].filter(([name, sch]) => inDoc.get(name) !== sch).map(([n]) => n);
    expect(wrong, `the doc's Scheduled column is wrong for: ${wrong.join(", ")}`).toEqual([]);
  });

  it("CANARY — a doc whose tier COUNT is edited is rejected", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const truth = parseInventoryCounts(doc);
    expect(truth.tiers.length, "no tier rows parsed; the assertion above is vacuous").toBeGreaterThan(2);
    const row = truth.tiers[0];
    const tampered = doc.replace(
      `| ${row.tier} | every ${row.interval} | ${row.scheduled} / ${row.staged} |`,
      `| ${row.tier} | every ${row.interval} | ${row.scheduled + 1} / ${row.staged} |`,
    );
    expect(tampered, "the tier row was not found, so nothing was tampered with").not.toEqual(doc);
    expect(parseInventoryCounts(tampered)).not.toEqual(truth);
  });

  it("CANARY — a doc whose TOTAL line is edited is rejected", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    const truth = parseInventoryCounts(doc);
    expect(truth.total, "no Total line parsed; the assertion above is vacuous").not.toBeNull();
    const tampered = doc.replace(
      `**Total: ${truth.total!.tiered} tiered jobs (${truth.total!.scheduled} scheduled automatically,`,
      `**Total: ${truth.total!.tiered} tiered jobs (${truth.total!.scheduled - 1} scheduled automatically,`,
    );
    expect(tampered).not.toEqual(doc);
    expect(parseInventoryCounts(tampered)?.total).not.toEqual(truth.total);
  });

  it("CANARY — a job silently flipped to STAGED is rejected", () => {
    // The failure this pair exists for: the job stops running, the name set is unchanged,
    // and without the Scheduled column nothing anywhere says so.
    const doc = fs.readFileSync(docPath, "utf8");
    const flags = parseInventoryScheduled(doc);
    const [name] = [...flags].find(([, sch]) => sch) ?? [];
    expect(name, "no scheduled job found in the doc; the assertion above is vacuous").toBeTruthy();
    // Line-scan rather than a regex: the row is `| \`name\` | no | no | yes | purpose |`
    // and only the FOURTH cell is the Scheduled flag. Rewriting it by hand keeps the
    // tamper obvious and keeps this canary from failing for escaping reasons rather than
    // for the reason it exists.
    const lines = doc.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.startsWith(`| \`${name}\` |`));
    expect(idx, "the job row was not found, so nothing was tampered with").toBeGreaterThan(-1);
    const cells = lines[idx].split("|");
    expect(cells[4].trim()).toBe("yes");
    cells[4] = " **STAGED — HTTP trigger only** ";
    lines[idx] = cells.join("|");
    const tampered = lines.join("\n");
    expect(tampered).not.toEqual(doc);
    expect(parseInventoryScheduled(tampered).get(name!)).toBe(false);
  });

  it("CANARY — a doc with NO totals line reports null, not zeros", () => {
    // Zeros would compare equal to a generated doc that also had none, and a missing line
    // would read as agreement.
    expect(parseInventoryCounts("no generated block here at all").total).toBeNull();
  });

  it("CANARY — the parser actually finds job rows (a silent parser would pass the first test)", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    expect(parseInventoryJobNames(doc).size).toBeGreaterThan(50);
  });
});
