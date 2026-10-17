/**
 * W4 fix round 2 (b): the character sheet draws no weekly claim from a read that failed.
 *
 * THE DEFECT. With the 7-day read failed, every stat arrives with rising7dXp 0 and
 * `rising7dUnknown: true` (lib/mastery/character-sheet.ts). The sheet still named the highest
 * stat as "Neglected stat (7d idle)" and dropped every ▲ marker, so an unread week looked like a
 * measured idle week. The fix shows the unknown state ONCE and makes neither claim; the
 * MEASURED-ZERO control keeps the neglect line and the ▲ markers for a read that succeeded.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      characterSheet: { useQuery: () => ({ data: h.data, isLoading: false, error: null, refetch: () => {} }) },
    },
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { CharacterSheet } from "@/components/mastery/character-sheet";

const stat = (key: string, branch: string, level: number, rising7dXp: number, unknown = false) => ({
  key,
  label: key,
  shortLabel: key,
  description: "",
  color: "#888",
  branch,
  xp: level * 100,
  level,
  tier: "Adept",
  tierEmoji: "",
  xpIntoLevel: 10,
  xpForNext: 100,
  progressPct: 10,
  rising7dXp,
  ...(unknown ? { rising7dUnknown: true } : {}),
  goals: [],
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(data: unknown[]): Promise<HTMLDivElement> {
  h.data = data;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<CharacterSheet />);
  });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
});

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("CharacterSheet with an unreadable week", () => {
  it("control: a measured week keeps the neglect line and the ▲ markers", async () => {
    const el = await mount([stat("focus", "mind", 9, 0), stat("strength", "body", 7, 12)]);
    const text = el.textContent ?? "";
    expect(text).toContain("Neglected stat (7d idle)");
    expect(text).toContain("▲12");
    expect(text).not.toMatch(/couldn.t be read/i);
  });

  it("shows the unknown state once and claims no idle stat and no gains", async () => {
    const el = await mount([stat("focus", "mind", 9, 0, true), stat("strength", "body", 7, 4, true)]);
    const text = el.textContent ?? "";
    expect(text, "an unread week was told as a neglected stat").not.toContain("Neglected stat (7d idle)");
    expect(text, "a partial weekly number was drawn as a gain").not.toContain("▲");
    expect(count(text, "This week's XP couldn't be read."), "the unknown state must show exactly once").toBe(1);
  });
});
