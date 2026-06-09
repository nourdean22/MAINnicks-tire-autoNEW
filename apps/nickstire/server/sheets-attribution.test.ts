/**
 * Unit tests for attributionCells — the fixed 5-cell attribution tail
 * appended to Leads/Bookings/Callbacks sheet rows.
 *
 * Pins the three contracts that keep the owner's CRM trustworthy:
 *  1. ALWAYS exactly 5 cells (column alignment across every submit path,
 *     including paths with no web attribution — SMS bot, emergency).
 *  2. Honest blanks — missing attribution stays "", never invented.
 *  3. Landing Page is pathname-normalized (stored value is the full href;
 *     raw hrefs would leak UTM noise and fragment the column).
 */
import { describe, it, expect } from "vitest";
import { attributionCells, SHEET_ATTRIBUTION_HEADERS } from "./sheets-sync";

describe("attributionCells", () => {
  it("matches the header count exactly (alignment contract)", () => {
    expect(SHEET_ATTRIBUTION_HEADERS).toHaveLength(5);
    expect(attributionCells(undefined)).toHaveLength(5);
    expect(attributionCells(null)).toHaveLength(5);
    expect(attributionCells({})).toHaveLength(5);
    expect(
      attributionCells({ utmSource: "google", utmMedium: "cpc", utmCampaign: "x", landingPage: "https://nickstire.org/brakes", referrer: "https://google.com/" }),
    ).toHaveLength(5);
  });

  it("returns 5 honest blanks when no attribution exists (SMS bot / emergency paths)", () => {
    expect(attributionCells(undefined)).toEqual(["", "", "", "", ""]);
    expect(attributionCells({})).toEqual(["", "", "", "", ""]);
  });

  it("maps full attribution in header order: source, medium, campaign, landing, referrer", () => {
    expect(
      attributionCells({
        utmSource: "instagram",
        utmMedium: "social",
        utmCampaign: "summer_brakes",
        landingPage: "https://nickstire.org/used-tires-cleveland?utm_source=instagram&utm_medium=social",
        referrer: "https://l.instagram.com/",
      }),
    ).toEqual(["instagram", "social", "summer_brakes", "/used-tires-cleveland", "https://l.instagram.com/"]);
  });

  it("normalizes Landing Page to a pathname (UTM variants cannot fragment the column)", () => {
    const a = attributionCells({ landingPage: "https://nickstire.org/brakes?utm_source=google" });
    const b = attributionCells({ landingPage: "https://nickstire.org/brakes?utm_source=facebook#cta" });
    expect(a[3]).toBe("/brakes");
    expect(a[3]).toBe(b[3]);
  });

  it("keeps partial attribution partial — present fields fill, missing stay blank", () => {
    expect(attributionCells({ utmSource: "voice-agent", utmCampaign: "vapi-rack-check" })).toEqual([
      "voice-agent",
      "",
      "vapi-rack-check",
      "",
      "",
    ]);
  });

  it("treats null fields as blanks, not strings", () => {
    expect(
      attributionCells({ utmSource: null, utmMedium: null, utmCampaign: null, landingPage: null, referrer: null }),
    ).toEqual(["", "", "", "", ""]);
  });
});
