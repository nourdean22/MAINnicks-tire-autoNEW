/**
 * tests/home/change-line-cursor.test.tsx - appearance wave B follow-up (2026-10-23).
 *
 * "Since last visit" advances its cursor once the line has been READ (hooks/use-change-cursor.ts). On a
 * phone the line now sits inside the closed Context fold, so a successful read used to move the cursor
 * past changes the operator never saw: unknown rendered as "seen" (empty-vs-error). The cursor now
 * advances only while the line is shown: the fold is open, or the viewport is xl where it is open.
 * ChangeLine and the fold are real here; the query, the width and the sentence renderer are stubbed.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ wide: false }));

vi.mock("@/hooks/use-min-width", () => ({ useMinWidth: () => h.wide }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      briefChanges: {
        useQuery: () => ({ data: { since: 1 }, isSuccess: true, isError: false }),
      },
    },
  },
}));
vi.mock("@/components/ui/change-set-line", () => ({
  ChangeSetLine: () => <section aria-label="since last visit">Since yesterday</section>,
}));

import { ContextRail } from "@/components/home/context-rail";
import { ChangeLine } from "@/components/home/change-line";
import { CHANGE_CURSOR_SETTLE_MS, cursorKey } from "@/lib/ui/change-cursor";

const KEY = cursorKey("hq");
const START = 1_700_000_000_000;
let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ContextRail>
        <ChangeLine />
      </ContextRail>,
    );
  });
  await act(async () => {
    vi.advanceTimersByTime(10); // the cursor read is deferred a tick
  });
}

const settle = () => act(async () => void vi.advanceTimersByTime(CHANGE_CURSOR_SETTLE_MS + 100));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(START);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  window.localStorage.setItem(KEY, String(START - 3_600_000));
  h.wide = false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the last-visit cursor moves only when the line is shown", () => {
  it("POSITIVE CONTROL: the line rendered, inside a closed fold, and the cursor is the seeded one", async () => {
    await mount();
    const fold = host.querySelector("details") as HTMLDetailsElement;
    expect(host.querySelector('section[aria-label="since last visit"]')).not.toBeNull();
    expect(fold.open).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe(String(START - 3_600_000));
  });

  it("closed fold + successful read: the cursor stays where it was", async () => {
    await mount();
    await settle();
    expect(window.localStorage.getItem(KEY)).toBe(String(START - 3_600_000));
  });

  it("open fold: the cursor advances after the settle time", async () => {
    await mount();
    const fold = host.querySelector("details") as HTMLDetailsElement;
    await act(async () => {
      fold.open = true;
      fold.dispatchEvent(new Event("toggle"));
    });
    await settle();
    expect(Number(window.localStorage.getItem(KEY))).toBeGreaterThan(START);
  });

  it("closing the fold again before the settle time cancels the advance", async () => {
    await mount();
    const fold = host.querySelector("details") as HTMLDetailsElement;
    await act(async () => {
      fold.open = true;
      fold.dispatchEvent(new Event("toggle"));
    });
    await act(async () => {
      fold.open = false;
      fold.dispatchEvent(new Event("toggle"));
    });
    await settle();
    expect(window.localStorage.getItem(KEY)).toBe(String(START - 3_600_000));
  });

  it("wide, then narrow: the desktop open does not leak into the phone fold, and the cursor stays put", async () => {
    h.wide = true;
    await mount();
    const fold = host.querySelector("details") as HTMLDetailsElement;
    expect(fold.open).toBe(true);
    // The browser fires toggle after the programmatic open that the wide viewport forced.
    await act(async () => void fold.dispatchEvent(new Event("toggle")));

    h.wide = false;
    await act(async () => {
      root.render(
        <ContextRail>
          <ChangeLine />
        </ContextRail>,
      );
    });
    await act(async () => void fold.dispatchEvent(new Event("toggle")));
    await settle();

    expect(fold.open, "the phone fold stayed open after the viewport shrank").toBe(false);
    expect(window.localStorage.getItem(KEY), "the cursor counted the Since line as seen").toBe(String(START - 3_600_000));
  });

  it("from xl the line is shown by default: the cursor advances with no tap", async () => {
    h.wide = true;
    await mount();
    await settle();
    expect(Number(window.localStorage.getItem(KEY))).toBeGreaterThan(START);
  });
});
