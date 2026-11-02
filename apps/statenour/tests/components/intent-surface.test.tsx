// @vitest-environment jsdom
/**
 * W6 PR 2 · the /now intent surface (components/now/intent-surface.tsx). Phone first: 44 px targets,
 * a 16 px input (iOS zooms below it), no window.confirm/alert/prompt. Cards draw through the REAL
 * ToolResultCard, open. A failed compose says so and offers Retry; an empty one says so and points
 * at Chat; neither reads as "nothing to see".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = {
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  return { trpc: new Proxy({}, { get: (_t, prop) => (prop === "useUtils" ? () => ({}) : procProxy) }) };
});
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </main>
  ),
}));

import { IntentSurface, DEFAULT_INTENTS } from "@/components/now/intent-surface";

const FLEET_PART = {
  type: "tool-getFleetTruth",
  state: "output-available",
  output: { ok: true, statenour: [{ capability: "outbox-drain", state: "fresh", ageH: 0 }], nickstire: [], allFresh: true, queuesClean: true },
};

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<IntentSurface />));
}

async function tap(el: Element | null) {
  if (!el) throw new Error("nothing to tap");
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {});
}

const chip = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label) ?? null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  try {
    localStorage.clear();
  } catch {}
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("/now intent surface", () => {
  it("offers the four starter intents as 44 px targets and a 16 px input", async () => {
    await mount();
    for (const label of DEFAULT_INTENTS) expect(chip(label)?.className).toContain("min-h-11");
    expect(DEFAULT_INTENTS).toHaveLength(4);
    const input = host.querySelector("input");
    expect(input?.className).toContain("text-base");
    expect(input?.getAttribute("aria-label")).toBeTruthy();
  });

  it("a starter intent composes and draws its card open, through the real registry", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, data: { parts: [FLEET_PART], refused: 0, failed: 0 } }));
    await mount();
    await tap(chip("Is everything running"));
    expect(fetchMock).toHaveBeenCalledWith("/api/intent/compose", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ intent: "Is everything running" });
    expect(host.querySelector('[data-testid="fleet-truth-card"]')).not.toBeNull();
    expect(host.textContent).toContain("Fleet checked");
  });

  it("a failed compose says what failed and Retry asks again", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: false, error: "Nick could not compose this screen: provider timed out" }, 502));
    fetchMock.mockResolvedValueOnce(reply({ ok: true, data: { parts: [FLEET_PART], refused: 0, failed: 0 } }));
    await mount();
    await tap(chip("My day"));
    expect(host.textContent).toContain("provider timed out");
    expect(host.querySelector('[data-testid="fleet-truth-card"]')).toBeNull();
    await tap(chip("Retry"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ intent: "My day" });
    expect(host.querySelector('[data-testid="fleet-truth-card"]')).not.toBeNull();
  });

  it("a network failure is a failure, not an empty screen", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await mount();
    await tap(chip("Shop today"));
    expect(host.textContent).toContain("Could not reach");
    expect(host.textContent).not.toContain("found no card");
  });

  it("no card for the ask says so and points at Chat", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, data: { parts: [], refused: 0, failed: 0 } }));
    await mount();
    await tap(chip("Who needs me"));
    expect(host.textContent).toContain("found no card");
    expect(host.querySelector('a[href="/chat"]')).not.toBeNull();
  });

  it("a read that failed on the server shows its own words on its card", async () => {
    const failedPart = { type: "tool-dailyPulse", state: "output-error", errorText: "pulse read timed out after 8s" };
    fetchMock.mockResolvedValue(reply({ ok: true, data: { parts: [FLEET_PART, failedPart], refused: 0, failed: 1 } }));
    await mount();
    await tap(chip("My day"));
    expect(host.textContent).toContain("pulse read timed out after 8s");
    expect(host.querySelector('[data-testid="fleet-truth-card"]')).not.toBeNull();
  });

  it("refused reads are named, so a short screen is not read as everything", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, data: { parts: [FLEET_PART], refused: 2, failed: 0 } }));
    await mount();
    await tap(chip("Shop today"));
    expect(host.textContent).toContain("2 more");
  });

  it("a 200 without parts is a failure, never a crash or an empty screen", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, data: { refused: 0 } }));
    await mount();
    await tap(chip("Shop today"));
    expect(host.textContent).toContain("compose read failed");
    expect(host.textContent).not.toContain("found no card");
  });

  it("an ask he typed becomes a shortcut after it composes, and survives a remount", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, data: { parts: [FLEET_PART], refused: 0, failed: 0 } }));
    await mount();
    const input = host.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "brake jobs this week");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    act(() => root.unmount());
    host.remove();
    await mount();
    expect(chip("brake jobs this week")).not.toBeNull();
    expect(host.querySelectorAll("form + div button")).toHaveLength(4);
  });

  it("blocked storage only loses the shortcuts: the starter intents still show and still compose", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    fetchMock.mockResolvedValue(reply({ ok: true, data: { parts: [FLEET_PART], refused: 0, failed: 0 } }));
    await mount();
    for (const label of DEFAULT_INTENTS) expect(chip(label)).not.toBeNull();
    await tap(chip("Shop today"));
    expect(host.querySelector('[data-testid="fleet-truth-card"]')).not.toBeNull();
    get.mockRestore();
    set.mockRestore();
  });

  it("never uses a native dialog", async () => {
    const spies = [vi.spyOn(window, "confirm"), vi.spyOn(window, "alert"), vi.spyOn(window, "prompt")];
    fetchMock.mockResolvedValue(reply({ ok: false, error: "boom" }, 502));
    await mount();
    await tap(chip("Shop today"));
    await tap(chip("Retry"));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
