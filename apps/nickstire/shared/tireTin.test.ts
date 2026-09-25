import { describe, expect, it } from "vitest";
import {
  checkTin, expectedTireCount, isTirePosition, registrationLink, renderRegistrationFormHtml,
  summarizeRegistration, tinAgeYears, tirePositionsForCount REGISTRATION_METHODS, type RegistrationRowLike,
} from "./tireTin";

const NOW = new Date("2026-09-23T12:00:00Z");

describe("checkTin — 49 CFR 574.5 format", () => {
  it("accepts a current 13-symbol TIN (plant 3 + manufacturer code 6 + date 4)", () => {
    const c = checkTin("DOT 3D1 A7B2C4 2324", NOW);
    expect(c).toMatchObject({ status: "valid", normalized: "3D1A7B2C42324", plantCode: "3D1", week: 23, year: 2024 });
    expect(c.issues).toEqual([]);
  });

  it("accepts the older two-symbol-plant layout still on shelves", () => {
    const c = checkTin("dot u2ll lmlr 5107", NOW);
    expect(c).toMatchObject({ status: "valid", normalized: "U2LLLMLR5107", plantCode: "U2", week: 51, year: 2007 });
  });

  it("normalizes spaces, hyphens and the DOT prefix", () => {
    expect(checkTin(" DOT-3D1 a7b2c4-2324 ", NOW).normalized).toBe("3D1A7B2C42324");
  });

  it("rejects symbols the rule never uses, and names the O-for-zero mistake", () => {
    const c = checkTin("3D1AOB2C42324", NOW);
    expect(c.status).toBe("invalid");
    expect(c.issues.join(" ")).toMatch(/O.*zero/);
    expect(checkTin("3D1AGB2C42324", NOW).status).toBe("invalid");
  });

  it("rejects a TIN that is too short or too long", () => {
    expect(checkTin("AB12", NOW).status).toBe("invalid");
    expect(checkTin("3D1A7B2C4232411", NOW).status).toBe("invalid");
    expect(checkTin("", NOW).status).toBe("invalid");
  });

  it("rejects week 00 and a date code in the future", () => {
    expect(checkTin("U2LLLMLR0024", NOW).status).toBe("invalid");
    const future = checkTin("U2LLLMLR1027", NOW);
    expect(future.status).toBe("invalid");
    expect(future.issues.join(" ")).toMatch(/future/);
  });

  it("FLAGS a pre-2000 three-digit date code instead of accepting it", () => {
    const a = checkTin("DOT EJ 4V 1HX 239", NOW);
    expect(a.status).toBe("legacy_date_code");
    expect(a.week).toBe(23);
    expect(a.year).toBeNull();
    expect(a.issues.join(" ")).toMatch(/before 2000/);
    // Four trailing digits that are not a plausible WWYY (week 52 of 2039) fall back to the
    // three-digit reading rather than being accepted.
    expect(checkTin("EJ4V1H5239", NOW).status).toBe("legacy_date_code");
  });

  it("computes tire age from the date code", () => {
    expect(tinAgeYears(checkTin("U2LLLMLR5107", NOW), NOW)).toBe(18);
    expect(tinAgeYears(checkTin("EJ4V1HX239", NOW), NOW)).toBeNull();
  });
});

const row = (p: Partial<RegistrationRowLike> & { position: string }): RegistrationRowLike => ({
  tin: "3D1A7B2C42324", tinStatus: "valid", tireCondition: "new", registrationMethod: "pending", ...p,
});

describe("expectedTireCount", () => {
  it("sums approved, non-declined tire lines only", () => {
    expect(expectedTireCount([
      { type: "tire", quantity: "4.00", approved: true, declined: false },
      { type: "labor", quantity: "1" },
      { type: "tire", quantity: "2", declined: true },
      { type: "tire", quantity: "1", approved: false },
    ])).toBe(4);
  });
});

describe("tire position allocation", () => {
  it("adds deterministic EXTRA slots when an order contains more than seven tires", () => {
    expect(tirePositionsForCount(7)).toEqual(["LF", "RF", "LR", "RR", "LRI", "RRI", "SPARE"]);
    expect(tirePositionsForCount(8)).toEqual(["LF", "RF", "LR", "RR", "LRI", "RRI", "SPARE", "EXTRA1"]);
    expect(tirePositionsForCount(10).slice(-3)).toEqual(["EXTRA1", "EXTRA2", "EXTRA3"]);
    expect(isTirePosition("EXTRA1")).toBe(true);
    expect(isTirePosition("EXTRA999")).toBe(true);
    expect(isTirePosition("EXTRA1000")).toBe(false);
    expect(isTirePosition("EXTRA0")).toBe(false);
  });
});

describe("summarizeRegistration — an unread order is never '0 tires'", () => {
  it("reports UNKNOWN when the order or its rows could not be read", () => {
    expect(summarizeRegistration(null, []).state).toBe("unknown");
    expect(summarizeRegistration(4, null).state).toBe("unknown");
  });

  it("is not_applicable only when the order genuinely has no tire lines and nothing captured", () => {
    expect(summarizeRegistration(0, []).state).toBe("not_applicable");
  });

  it("is visibly INCOMPLETE while TINs are missing", () => {
    const s = summarizeRegistration(4, [row({ position: "LF" }), row({ position: "RF" })]);
    expect(s).toMatchObject({ state: "incomplete", captured: 2, missingTins: 2 });
  });

  it("counts a flagged (legacy/invalid) TIN as missing", () => {
    const s = summarizeRegistration(1, [row({ position: "LF", tinStatus: "legacy_date_code" })]);
    expect(s).toMatchObject({ state: "incomplete", missingTins: 2, invalidPositions: ["LF"] });
  });

  it("stays incomplete until every tire has a registration step recorded", () => {
    const rows = ["LF", "RF", "LR", "RR"].map((position) => row({ position }));
    expect(summarizeRegistration(4, rows)).toMatchObject({ state: "incomplete", missingTins: 0, pendingPositions: ["LF", "RF", "LR", "RR"] });
    const done = rows.map((r) => ({ ...r, registrationMethod: "form_given" }));
    expect(summarizeRegistration(4, done).state).toBe("complete");
  });

  it("method values fit the VARCHAR(32) column", () => {
    for (const m of REGISTRATION_METHODS) expect(m.length).toBeLessThanOrEqual(32);
  });
});

describe("registration form (574.8(a)(1)(i))", () => {
  const input = {
    dealerName: "Nick's Tire & Auto",
    dealerStreet: "17625 Euclid Ave",
    dealerCityStateZip: "Cleveland, OH 44112",
    orderNumber: "WO-TEST-1",
    vehicle: "2015 Honda Civic",
    tires: [
      { position: "LF", tin: "3D1A7B2C42324", brand: "Hankook", tireCondition: "new" },
      { position: "RF", tin: "3D1A7B2C42424", brand: "Hankook", tireCondition: "new" },
      { position: "LR", tin: "U2LLLMLR5123", brand: "Acme", tireCondition: "new" },
      { position: "RR", tin: "U2LLLMLR0122", brand: "Acme", tireCondition: "used" },
    ],
  };

  it("contains every TIN on the order plus the dealer's name and street address", () => {
    const html = renderRegistrationFormHtml(input);
    for (const t of input.tires) expect(html).toContain(t.tin);
    expect(html).toContain("Nick's Tire &amp; Auto");
    expect(html).toContain("17625 Euclid Ave");
    expect(html).toContain("Used — not covered by 574.8");
    expect(html).toContain("hankooktire.com");
    expect(html).not.toContain("Date of sale");
  });

  it("escapes HTML in free-text fields", () => {
    const html = renderRegistrationFormHtml({ ...input, vehicle: "<script>x</script>" });
    expect(html).not.toContain("<script>x");
  });

  it("refuses to render a form with no new tire on it", () => {
    expect(() => renderRegistrationFormHtml({ ...input, tires: [input.tires[3]] })).toThrow(/nothing to register/);
  });

  it("links a verified brand directly and every other brand as a labelled search", () => {
    expect(registrationLink("Hankook")).toEqual({ url: "https://www.hankooktire.com/us/en/register-your-tires.html", verified: true });
    const other = registrationLink("Acme");
    expect(other.verified).toBe(false);
    expect(other.url).toContain("Acme%20tire%20registration");
  });
});
