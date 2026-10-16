/**
 * Admin UI v1 W1 removed StatCard's count-up. The count-up also formatted: numbers rendered rounded
 * with grouping (Math.round(n).toLocaleString()) and digit-only strings gained grouping. The static
 * render keeps both, so 1250.4 never shows as "1,250.4" and "1250" shows as "1,250".
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { StatCard } from "@/pages/admin/shared/cards";

const value = (v: string | number) => {
  const { container, unmount } = render(<StatCard label="Revenue" value={v} icon={null} />);
  const text = container.querySelector(".stat-value")?.textContent ?? "";
  unmount();
  return text;
};

describe("StatCard renders values at once, formatted as the count-up did", () => {
  it("rounds numbers and groups thousands", () => {
    expect(value(1250.4)).toBe("1,250");
    expect(value(1250.6)).toBe("1,251"); // rounds, not floors
    expect(value(7)).toBe("7");
  });
  it("groups digit-only strings, with or without existing commas or a dollar sign", () => {
    expect(value("1250")).toBe("1,250");
    expect(value("1,250")).toBe("1,250");
    expect(value("$1250")).toBe("$1,250");
  });
  it("leaves every other string as given", () => {
    for (const s of ["85/100", "12%", "unknown", "$1,234.50"]) expect(value(s)).toBe(s);
  });
  it("a number that is not finite is shown as itself, not formatted", () => {
    render(<StatCard label="Revenue" value={Number.NaN} icon={null} />);
    expect(screen.getByText("NaN")).toBeTruthy();
  });
});
