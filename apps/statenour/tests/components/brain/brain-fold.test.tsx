/**
 * tests/components/brain/brain-fold.test.tsx - bdnick wave D round 2 (2026-10-24).
 *
 * BrainFold is a closed native disclosure on the Brain Memory tab. Three behaviours pinned here:
 *   1. A deep link (#pin-<id>, #pinned-context, #recall-preview, #anti-patterns) that names an element
 *      inside a closed fold opens the fold; otherwise the target scrolls into a hidden box and Nour sees
 *      nothing (chat "View pin", Cmd+Shift+P, /pinned and the command palette all link there).
 *   2. A paused (offline) read is not a failed read: the summary says "(n offline)", not "unreadable".
 *   3. "(n unreadable)" clears when the failed read recovers (a successful Retry).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrainFold } from "@/components/brain/brain-fold";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.history.replaceState(null, "", "/brain");
});

const details = () => host.querySelector("details") as HTMLDetailsElement;
const summary = () => host.querySelector("summary")!.textContent!.replace(/\s+/g, " ").trim();

describe("BrainFold opens for a deep link into its body", () => {
  it("opens on mount when the hash names an element inside it", async () => {
    window.history.replaceState(null, "", "/brain?tab=memory#pin-x");
    await mount(
      <BrainFold title="Context">
        <section id="pinned-context">
          <div id="pin-x">a pin</div>
        </section>
      </BrainFold>,
    );
    expect(details().open).toBe(true);
  });

  it("opens when the hash changes to an element inside it", async () => {
    await mount(
      <BrainFold title="Context">
        <section id="recall-preview">recall</section>
      </BrainFold>,
    );
    expect(details().open).toBe(false);
    await act(async () => {
      window.location.hash = "recall-preview";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(details().open).toBe(true);
  });

  it("stays closed for a hash that names something outside it", async () => {
    window.history.replaceState(null, "", "/brain#contradictions");
    await mount(
      <BrainFold title="Context">
        <section id="recall-preview">recall</section>
      </BrainFold>,
    );
    expect(details().open).toBe(false);
  });
});

describe("BrainFold counts offline apart from unreadable", () => {
  it("says (n offline) for a paused read, never unreadable", async () => {
    await mount(
      <BrainFold title="Self-model">
        <p data-read-state="offline">Preferences will load when the connection returns.</p>
        <section>ok</section>
      </BrainFold>,
    );
    expect(summary()).toBe("Self-model (2) (1 offline)");
  });
});

function Recovering() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOk(true), 5);
    return () => clearTimeout(t);
  }, []);
  return ok ? <section>signal</section> : <p data-read-failed="">signal couldn&apos;t load</p>;
}

describe("BrainFold follows a failed read that recovers", () => {
  it("clears (n unreadable) after a successful retry", async () => {
    await mount(
      <BrainFold title="Signals">
        <Recovering />
        <section>b</section>
      </BrainFold>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(summary()).toBe("Signals (2)");
  });

  it("shows (1 unreadable) while it is still failed (positive control)", async () => {
    await mount(
      <BrainFold title="Signals">
        <p data-read-failed="">x</p>
      </BrainFold>,
    );
    expect(summary()).toBe("Signals (1) (1 unreadable)");
  });
});
