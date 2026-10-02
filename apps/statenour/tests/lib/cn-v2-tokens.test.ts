/**
 * `cn` must resolve conflicts on the UI v2 radius and shadow scales.
 *
 * tailwind-merge only knows the scales in its theme; a token it has never heard of
 * is kept alongside the stock one, so `cn("rounded-control", "rounded-full")` with the
 * stock merger emits BOTH and the stylesheet's alphabetical order decides the paint
 * (PR #2878 review). lib/utils.ts extends the theme; this test pins that and keeps a
 * positive control on the stock merger so the gate cannot pass vacuously.
 */
import { describe, expect, it } from "vitest";
import { twMerge } from "tailwind-merge";
import { cn } from "@/lib/utils";

describe("cn · UI v2 radius + shadow scales", () => {
  it("positive control: the stock merger keeps both radius classes", () => {
    expect(twMerge("rounded-control rounded-full")).toBe("rounded-control rounded-full");
  });

  it("last-wins holds for the v2 radius scale, in both directions and on sides", () => {
    expect(cn("rounded-control", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-full", "rounded-micro")).toBe("rounded-micro");
    expect(cn("rounded-surface", "rounded-md")).toBe("rounded-md");
    expect(cn("rounded-t-float", "rounded-t-surface")).toBe("rounded-t-surface");
    expect(cn("rounded-overlay!", "rounded-control!")).toBe("rounded-control!");
  });

  it("last-wins holds for the v2 shadow scale", () => {
    expect(cn("shadow-l1", "shadow-l2")).toBe("shadow-l2");
    expect(cn("shadow-l2", "shadow-none")).toBe("shadow-none");
  });

  it("everything else merges as before", () => {
    expect(cn("bg-content", "bg-red-500")).toBe("bg-red-500");
    expect(cn("text-[13px]", "text-[14px]")).toBe("text-[14px]");
    expect(cn("p-2", { "p-4": true })).toBe("p-4");
    expect(cn("rounded-control", "border-edge-default")).toBe("rounded-control border-edge-default");
  });
});
