/**
 * UI v3 W1a, header diet: the eyebrow renders only when it adds information.
 *
 * 43 pages share one eyebrow + title + description header, so a repeat of the title or of the
 * parent hub ("System / observability" over "Observability" under /system) is read on every one
 * of them. eyebrowAddsInformation is the one test, kept pure so this file can break it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CORE_PAGE_PATHS, eyebrowAddsInformation, isCorePage } from "@/components/layout/header-diet";

describe("eyebrowAddsInformation", () => {
  it("is false for an exact repeat of the title", () => {
    expect(eyebrowAddsInformation("Journal", "Journal")).toBe(false);
  });

  it("is false for a near repeat: case, punctuation, plural", () => {
    expect(eyebrowAddsInformation("JOURNAL!", "Journal")).toBe(false);
    expect(eyebrowAddsInformation("  cron   health. ", "Cron Health")).toBe(false);
    expect(eyebrowAddsInformation("Crons", "Cron")).toBe(false);
  });

  it("is false when every segment repeats the title or the parent label", () => {
    expect(eyebrowAddsInformation("System / observability", "Observability", "system")).toBe(false);
    expect(eyebrowAddsInformation("System", "Anything", "System")).toBe(false);
    expect(eyebrowAddsInformation("Brain · People", "People", "brain")).toBe(false);
  });

  it("is true when a segment says something the title and parent do not", () => {
    expect(eyebrowAddsInformation("Execution Deck", "Missions")).toBe(true);
    expect(eyebrowAddsInformation("Mastery · Journal", "Journal")).toBe(true);
    expect(eyebrowAddsInformation("System / observability", "Observability")).toBe(true);
    expect(eyebrowAddsInformation("Brain · people", "People")).toBe(true);
  });

  it("is false for empty input, whatever the title", () => {
    expect(eyebrowAddsInformation("", "Journal")).toBe(false);
    expect(eyebrowAddsInformation("   ", "Journal")).toBe(false);
    expect(eyebrowAddsInformation(null, "Journal")).toBe(false);
    expect(eyebrowAddsInformation(undefined, "Journal")).toBe(false);
    expect(eyebrowAddsInformation("·", "Journal")).toBe(false);
  });

  it("is true for a non-string node, which cannot be compared", () => {
    expect(eyebrowAddsInformation(createElement("span", null, "Journal"), "Journal")).toBe(true);
  });

  it("does not treat a hyphen inside a word as a separator", () => {
    expect(eyebrowAddsInformation("Check-in", "Check")).toBe(true);
  });
});

describe("isCorePage", () => {
  it("lists the seven core pages once", () => {
    expect([...CORE_PAGE_PATHS]).toEqual(["/", "/missions", "/chat", "/brain", "/people", "/journal", "/stats"]);
  });

  it("matches each core pathname, with or without a trailing slash", () => {
    for (const p of CORE_PAGE_PATHS) {
      expect(isCorePage(p), p).toBe(true);
      if (p !== "/") expect(isCorePage(`${p}/`), `${p}/`).toBe(true);
    }
  });

  it("does not match a sub-route, a look-alike prefix, or no pathname", () => {
    for (const p of ["/system", "/system/observability", "/brain/discover", "/missionsx", "/people/abc", "", "/settings"]) {
      expect(isCorePage(p), p).toBe(false);
    }
    expect(isCorePage(null)).toBe(false);
  });
});
