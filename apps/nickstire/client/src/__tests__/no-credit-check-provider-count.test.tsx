/**
 * /no-credit-check-tires-cleveland: the provider count in the "how the payment programs work"
 * block must match the providers it lists (shared/financing.ts), so the heading and its sub
 * line can never disagree again (Codex on PR 3148: "FIVE" over "Four independent providers").
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { FINANCING_PROVIDERS } from "@shared/financing";

const h = vi.hoisted(() => ({ config: null as any }));

vi.mock("@/components/FocusedServicePage", () => ({
  default: (props: { config: unknown }) => { h.config = props.config; return null; },
}));

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

describe("NoCreditCheckTiresPage provider count", () => {
  it("the included title and sub line both say the number of providers the page lists", async () => {
    const { default: Page } = await import("@/pages/NoCreditCheckTiresPage");
    render(React.createElement(Page));
    const word = WORDS[FINANCING_PROVIDERS.length];
    expect(h.config.included.length).toBeGreaterThanOrEqual(FINANCING_PROVIDERS.length);
    expect(h.config.includedTitle.toLowerCase()).toContain(`the ${word} payment programs`);
    expect(h.config.includedSub.toLowerCase().startsWith(`${word} independent providers`)).toBe(true);
    for (const other of WORDS.filter((w) => w !== word)) {
      expect(h.config.includedSub.toLowerCase()).not.toMatch(new RegExp(`\\b${other} independent providers`));
    }
  });
});
