/**
 * bdnick wave E2 round 2 (2026-10-24): the Goals tab's coach banner says when its read failed.
 *
 * THE DEFECT. useCoachEvents swallowed every failure ("the channel is advisory") and the banner hid
 * on zero events, so a failed read looked exactly like "nothing to coach". The hook now reports
 * `failed` (the last read failed) and `read` (some read ever succeeded); the banner, where the page
 * asks for it (`showReadState`, Stats Goals), says "could not load" with Retry when nothing was ever
 * read, and keeps the cached nudges under a stale note when a refresh failed. Pages that do not ask
 * keep the old silent behaviour (control below). The real hook runs against a stubbed fetch; each
 * case uses its own `limit`, because the hook caches per surface and limit for the session.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CoachEventBanner } from "@/components/mastery/coach-event-banner";

const EVENT = {
  eventId: "e1",
  kind: "goal_drift",
  subjectId: "g1",
  priority: "P1",
  title: "Run goal is drifting",
  surfaces: ["goals"],
  dismissable: true,
  extra: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const ok = (events: unknown[]) => Promise.resolve(new Response(JSON.stringify({ events }), { status: 200 }));
const down = () => Promise.resolve(new Response("{}", { status: 500 }));

let root: Root | null = null;
let el: HTMLDivElement;

async function mount(node: React.ReactNode) {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function unmount() {
  if (root) await act(async () => root!.unmount());
  el?.remove();
  root = null;
}

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CoachEventBanner on the Goals tab", () => {
  it("a failed read with nothing cached says it could not load, with Retry, never silence", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await mount(<CoachEventBanner surface="goals" limit={11} showReadState />);
    const note = el.querySelector('[data-read-state="error"]');
    expect(note, "a failed read rendered as nothing to coach").toBeTruthy();
    expect(note!.textContent).toMatch(/could not load/i);
    expect([...note!.querySelectorAll("button")].some((b) => b.textContent === "Retry")).toBe(true);
  });

  it("a 500 is a failed read too", async () => {
    vi.stubGlobal("fetch", vi.fn(down));
    await mount(<CoachEventBanner surface="goals" limit={12} showReadState />);
    expect(el.querySelector('[data-read-state="error"]')).toBeTruthy();
  });

  it("a failed refresh keeps the cached nudge under a stale note", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok([EVENT])));
    await mount(<CoachEventBanner surface="goals" limit={13} showReadState />);
    expect(el.textContent).toContain("Run goal is drifting");
    await unmount();
    // the cache is older than the hook's 55 s staleness window, and the next read fails
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 120_000);
    vi.stubGlobal("fetch", vi.fn(down));
    await mount(<CoachEventBanner surface="goals" limit={13} showReadState />);
    expect(el.querySelector('[data-read-state="stale"]'), "no stale note over the cached nudge").toBeTruthy();
    expect(el.textContent).toContain("Run goal is drifting");
  });

  it("control: a successful empty read renders nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok([])));
    await mount(<CoachEventBanner surface="goals" limit={14} showReadState />);
    expect(el.innerHTML).toBe("");
  });

  it("control: a page that does not ask keeps the silent banner", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await mount(<CoachEventBanner surface="goals" limit={15} />);
    expect(el.innerHTML).toBe("");
  });
});
