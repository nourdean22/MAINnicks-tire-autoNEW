/**
 * Admin UI v1 Wave 1: shared TabBar strips scroll sideways instead of overflowing the phone
 * (PLAN.md section 9 item 9; Tires renders nine pills, TireOrdersSection.tsx). Each pill is a 48 px
 * target, the repo floor (apps/nickstire/AGENTS.md). Class shape is the contract here: jsdom has no layout, so the
 * test pins the tokens that produce the behaviour in a real browser.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TabBar } from "@/pages/admin/shared/table";

const NINE = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i + 1}` }));
const has = (el: Element, token: string) => el.className.split(/\s+/).includes(token);

describe.each(["pill", "border"] as const)("TabBar (%s) with nine tabs", (variant) => {
  it("scrolls horizontally without wrapping and keeps every pill at full size", () => {
    render(<TabBar tabs={NINE} activeTab="t0" onChange={() => {}} variant={variant} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(9);
    const strip = buttons[0].parentElement!;
    expect(has(strip, "overflow-x-auto"), strip.className).toBe(true);
    expect(has(strip, "scroll-touch"), strip.className).toBe(true);
    expect(has(strip, "flex-wrap")).toBe(false);
    for (const b of buttons) {
      expect(has(b, "shrink-0"), b.className).toBe(true);
      expect(has(b, "min-h-12"), b.className).toBe(true);
      expect(has(b, "whitespace-nowrap"), b.className).toBe(true);
    }
  });
});
