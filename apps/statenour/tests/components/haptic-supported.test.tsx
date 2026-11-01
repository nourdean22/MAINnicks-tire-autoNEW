/**
 * UI v3 Wave 0, honesty fix (a): the Settings "Haptic feedback" row must not
 * offer a switch on a device that cannot vibrate.
 *
 * THE DEFECT. lib/ui/haptic.ts fires through navigator.vibrate. Safari has no
 * Vibration API and every iOS browser is WebKit, so on the operator's iPhone
 * all ~48 haptic calls are silent no-ops, yet the Settings row showed a live
 * switch (default ON) that promised feedback it could never give. A control
 * that writes to nothing is a lie with a nice label.
 *
 * The fix is an honest sentence in place of the switch when the device cannot
 * vibrate, and today's switch when it can. No new haptic implementation.
 * Rendered in jsdom with trpc stubbed (the chat-island-header pattern).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = vi.hoisted(() => {
  const config = { defaultMode: null, disabledTools: [] as string[] };
  const stats = { totalBrainMemories: 3, driveIngested: 1, embeddingCoverage: 0.5, lastDriveSync: null, categories: {} };
  // One stable object: the panel lists `utils` as an effect dependency, so a fresh
  // object per render would refetch forever.
  const utils = { operator: { aiConfig: { fetch: async () => config }, coldMemoryStats: { fetch: async () => stats } } };
  const mutation = { mutateAsync: async (patch: unknown) => patch };
  return { utils, mutation };
});

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => stub.utils,
    operator: {
      updateAiConfig: { useMutation: () => stub.mutation },
      resetAiConfig: { useMutation: () => stub.mutation },
      syncDrive: { useMutation: () => stub.mutation },
    },
  },
}));

import { haptic, isSupported } from "@/lib/ui/haptic";
import { AiSettingsPanel } from "@/components/settings/ai-settings-panel";

const STORAGE_KEY = "nour:haptic-enabled";

/** jsdom defines no navigator.vibrate, which is exactly how iOS Safari looks to the page. */
function setVibrate(value: unknown) {
  Object.defineProperty(navigator, "vibrate", { value, configurable: true, writable: true });
}
function clearVibrate() {
  delete (navigator as { vibrate?: unknown }).vibrate;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mountPanel(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AiSettingsPanel />);
  });
  // The config loads through an awaited fetch inside an effect; let it settle.
  for (let i = 0; i < 5 && !container.textContent?.includes("Haptic feedback"); i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container;
}

/** The control container of the row whose label reads "Haptic feedback". */
function hapticRow(el: HTMLElement): HTMLElement {
  const label = [...el.querySelectorAll("label")].find((l) => l.textContent === "Haptic feedback");
  expect(label, "the Haptic feedback row is missing").toBeTruthy();
  const group = label!.parentElement!.querySelector('[role="group"]');
  expect(group, "the row has no control group").toBeTruthy();
  return group as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  clearVibrate();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  clearVibrate();
});

describe("isSupported() is true only when navigator.vibrate is a function", () => {
  it("is false on a browser with no Vibration API (iOS Safari)", () => {
    expect(typeof navigator.vibrate).toBe("undefined");
    expect(isSupported()).toBe(false);
  });

  it("is true once navigator.vibrate is a function (Android Chrome)", () => {
    setVibrate(() => true);
    expect(isSupported()).toBe(true);
  });

  it("is false for a truthy non-function: presence of the key is not support", () => {
    setVibrate(true);
    expect(isSupported()).toBe(false);
  });

  it("haptic.isEnabled follows it: an ON preference cannot make an unsupported device enabled", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(haptic.isEnabled()).toBe(false);
    setVibrate(() => true);
    expect(haptic.isEnabled()).toBe(true);
  });
});

describe("Settings > Haptic feedback row", () => {
  it("unsupported: says so in plain words and renders no switch", async () => {
    const el = await mountPanel();
    const row = hapticRow(el);
    expect(row.textContent).toContain("Not available on this device. This browser has no web vibration support.");
    expect(row.textContent, "the claim must hold for every browser that lacks the API, not just iOS").not.toMatch(/iOS|Safari/);
    expect(row.querySelector('[role="switch"]'), "a dead switch is still on screen").toBeNull();
    // The per-device caption described the switch; with no switch it would be noise.
    expect(el.textContent).not.toContain("Per-device (stored in this browser).");
  });

  it("supported: keeps today's switch, ON by default, and it still writes the preference", async () => {
    setVibrate(() => true);
    const el = await mountPanel();
    const row = hapticRow(el);
    const sw = row.querySelector('[role="switch"]') as HTMLButtonElement | null;
    expect(sw, "the switch disappeared on a device that can vibrate").toBeTruthy();
    expect(sw!.getAttribute("aria-checked")).toBe("true");
    expect(row.textContent).not.toContain("Not available");
    expect(el.textContent).toContain("Per-device (stored in this browser).");

    await act(async () => {
      sw!.click();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
    expect((hapticRow(el).querySelector('[role="switch"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
  });
});
