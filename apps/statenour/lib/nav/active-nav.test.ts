import { describe, it, expect } from "vitest";
import { resolveActiveNav } from "./active-nav";
import type { NavItem } from "@/components/layout/nav-items";

const ic = (() => null) as unknown as NavItem["icon"];
const items: NavItem[] = [
  { href: "/", label: "Home", icon: ic },
  { href: "/missions", label: "Missions", icon: ic },
  { href: "/stats", label: "Stats", icon: ic },
  { href: "/system", label: "System", icon: ic },
  { href: "/system/crons", label: "Crons", icon: ic },
  { href: "https://nickstire.org/admin", label: "Admin", icon: ic, external: true },
  { href: "/market?tab=radar", label: "Radar", icon: ic },
];

describe("resolveActiveNav", () => {
  it("matches root only exactly", () => {
    expect(resolveActiveNav("/", items)?.label).toBe("Home");
    expect(resolveActiveNav("/missions", items)?.label).toBe("Missions");
  });

  it("matches exact and sub-paths", () => {
    expect(resolveActiveNav("/stats", items)?.label).toBe("Stats");
    expect(resolveActiveNav("/system/crons/x", items)?.label).toBe("Crons");
  });

  it("prefers the most specific (longest base) match", () => {
    expect(resolveActiveNav("/system", items)?.label).toBe("System");
    expect(resolveActiveNav("/system/crons", items)?.label).toBe("Crons");
  });

  it("ignores external items", () => {
    expect(resolveActiveNav("/people", items)).toBeNull();
  });

  it("strips query strings on nav hrefs when matching", () => {
    expect(resolveActiveNav("/market", items)?.label).toBe("Radar");
  });

  it("returns null for unknown paths", () => {
    expect(resolveActiveNav("/nonexistent", items)).toBeNull();
  });
});
