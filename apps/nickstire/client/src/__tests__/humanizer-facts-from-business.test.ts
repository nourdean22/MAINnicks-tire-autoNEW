/**
 * Shop facts in service copy are read from BUSINESS, never typed (job
 * 2026-10-30-antislop-humanizer-pages, facts PR). A typed phone or address keeps working until
 * the number changes, then shows the old one on every page that copied it.
 *
 * Not covered on purpose: the emissions entry (GSC wave 1, measured until the 2026-12-10 read;
 * the exemption fails once the date passes).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";
import { BUSINESS } from "../../../shared/business";
import { SERVICES } from "../../../shared/services";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");
const GSC_BLOCK = { start: 'slug: "emissions"', end: 'slug: "oil-change"', until: "2026-12-10" };
const TYPED = [BUSINESS.phone.display, BUSINESS.phone.dashed, BUSINESS.address.street];

/** Source of shared/services.ts with comments and the GSC block removed. */
export function scannedSource(src: string): string {
  const cut = src.split(sliceBlock(src, GSC_BLOCK.start, GSC_BLOCK.end, { label: "services.ts" })).join("");
  return cut.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

describe("typed shop facts in shared/services.ts", () => {
  const src = fs.readFileSync(path.join(APP, "shared/services.ts"), "utf8");

  it("positive control: a planted typed phone or address is found, a BUSINESS reference is not", () => {
    const planted = 'metaDescription: "Walk in 7 days. (216) 862-0005", answer: "We are at 17625 Euclid Ave."';
    expect(TYPED.filter((t) => planted.includes(t))).toEqual([BUSINESS.phone.display, BUSINESS.address.street]);
    expect(TYPED.filter((t) => 'metaDescription: "Walk in. " + BUSINESS.phone.display'.includes(t))).toEqual([]);
  });

  it("the scan reads the file and cuts only the GSC block", () => {
    const scanned = scannedSource(src);
    expect(scanned.length).toBeGreaterThan(src.length * 0.8);
    expect(scanned).not.toContain('slug: "emissions"');
    expect(scanned).toContain('slug: "oil-change"');
  });

  it("no service copy outside the GSC block types the shop phone or address", () => {
    const scanned = scannedSource(src);
    expect(TYPED.map((t) => [t, scanned.split(t).length - 1]).filter(([, n]) => n)).toEqual([]);
  });

  it("the rendered copy still carries the real phone and address (read, not dropped)", () => {
    const text = JSON.stringify(SERVICES);
    expect(text.split(BUSINESS.phone.display).length - 1).toBeGreaterThanOrEqual(15);
    expect(text).toContain(BUSINESS.address.full);
  });

  it("the GSC exemption has not expired", () => {
    expect(Date.now()).toBeLessThan(Date.parse(`${GSC_BLOCK.until}T23:59:59-05:00`));
  });
});

/**
 * shared/routes.ts descriptions must stay plain string literals (scripts/validate-route-registry.mjs
 * parses them as text and fails closed otherwise), so they cannot read BUSINESS. Manager ruling
 * 2026-10-31 (option a): keep the literals and fail the build the day one drifts from BUSINESS.
 */
const PHONE_SHAPE = /\(\d{3}\) \d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/g;
const EUCLID_ADDRESS = /\b\d{3,6} Euclid Ave(?:nue)?\b/g;

/** Every phone- or Euclid-address-shaped string in the text that does not match BUSINESS. */
export function driftedFacts(text: string): string[] {
  const phones = (text.match(PHONE_SHAPE) ?? []).filter((p) => p !== BUSINESS.phone.display && p !== BUSINESS.phone.dashed);
  const streets = (text.match(EUCLID_ADDRESS) ?? []).filter((a) => a !== BUSINESS.address.street);
  return [...phones, ...streets];
}

describe("typed shop facts in shared/routes.ts stay equal to BUSINESS", () => {
  const src = fs.readFileSync(path.join(APP, "shared/routes.ts"), "utf8");

  it("positive control: a drifted phone or street is caught, the real ones pass", () => {
    expect(driftedFacts("Call (216) 862-0006 or 216-862-0005. 17625 Euclid Ave, 17626 Euclid Avenue.")).toEqual([
      "(216) 862-0006",
      "17626 Euclid Avenue",
    ]);
    expect(driftedFacts(`Call ${BUSINESS.phone.display}. ${BUSINESS.address.street}.`)).toEqual([]);
  });

  it("the scan finds the typed phone numbers it guards (the scanner saw its subject)", () => {
    expect((src.match(PHONE_SHAPE) ?? []).length).toBeGreaterThanOrEqual(50);
  });

  it("no phone or Euclid address in routes.ts differs from BUSINESS", () => {
    expect(driftedFacts(src)).toEqual([]);
  });
});

describe("BUSINESS.hours.display", () => {
  it("separates the days from the hours without an em dash (number ranges keep their en dash)", () => {
    expect(BUSINESS.hours.display).not.toMatch(/—/);
    expect(BUSINESS.hours.display).toMatch(/Mon–Sat 8AM–6PM/);
  });
});
