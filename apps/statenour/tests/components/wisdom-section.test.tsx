// @vitest-environment jsdom
/**
 * Codex review on #3184: wave 2V folded Wisdom into the Brain Memory tab, and WisdomTab fetches the whole
 * corpus on mount, so every plain /brain visit paid for it. WisdomSection mounts it only on a tap or a deep
 * link. Rendered with react-dom/client in jsdom so the click is asserted, not only the markup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ query: "" as string, mounts: 0 }));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(h.query) }));
vi.mock("@/components/brain/wisdom-tab", () => ({
  WisdomTab: () => {
    h.mounts += 1;
    return <div data-testid="wisdom-tab" />;
  },
}));

import { WisdomSection } from "@/components/brain/wisdom-section";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.query = "";
  h.mounts = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<WisdomSection />));

describe("WisdomSection", () => {
  it("a plain visit shows one 44px button and never mounts the corpus fetch", () => {
    render();
    expect(h.mounts).toBe(0);
    expect(container.querySelector("[data-testid=wisdom-tab]")).toBeNull();
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Wisdom library");
    expect(button.className).toContain("min-h-[44px]");
  });

  it("a tap mounts WisdomTab", () => {
    render();
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector("[data-testid=wisdom-tab]")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("?focus=<key> and ?evolution=1 deep links mount it without a tap", () => {
    h.query = "tab=memory&focus=w-123";
    render();
    expect(container.querySelector("[data-testid=wisdom-tab]")).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    h.query = "evolution=1";
    render();
    expect(container.querySelector("[data-testid=wisdom-tab]")).not.toBeNull();
  });

  it("an unrelated query (?tab=memory, ?evolution=0) stays collapsed", () => {
    h.query = "tab=memory&evolution=0";
    render();
    expect(h.mounts).toBe(0);
  });
});
