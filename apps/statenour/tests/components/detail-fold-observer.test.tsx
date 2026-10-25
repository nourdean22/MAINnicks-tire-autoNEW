// @vitest-environment jsdom
/**
 * DetailFold's summary counts `data-read-failed` markers its children render AFTER mount (a closed
 * <details> keeps them mounted). That count lives in a MutationObserver effect that a static render
 * never runs, so this test mounts for real: a child toggles a marker by state, a marker OUTSIDE the
 * fold must never count, and the summary follows the child both ways. Delete the effect and it goes red.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DetailFold } from "@/components/system/detail-fold";
import { BrainFold } from "@/components/brain/brain-fold";

function Harness({ unreadable = 0 }: { unreadable?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button id="flip" onClick={() => setFailed((v) => !v)}>
        flip
      </button>
      <p id="outside" data-read-failed>
        a failed block outside the fold
      </p>
      <DetailFold unreadable={unreadable}>{failed ? <p data-read-failed>inside failed</p> : <p>inside fine</p>}</DetailFold>
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
const summary = () => container.querySelector("summary")!.textContent ?? "";
const flip = async () => {
  act(() => {
    container.querySelector<HTMLButtonElement>("#flip")!.click();
  });
  await settle();
};

/** One child per state a fold must report, mounted after the fold so the observer, not the first render, counts it. */
function StateHarness({ marker }: { marker: Record<string, string> | null }) {
  const [on, setOn] = useState(false);
  const child = on && marker ? <p {...marker}>inside</p> : <p>inside fine</p>;
  return (
    <>
      <button id="flip" onClick={() => setOn((v) => !v)}>
        flip
      </button>
      <DetailFold>{child}</DetailFold>
      <BrainFold title="Detail">{child}</BrainFold>
    </>
  );
}
const summaries = () => [...container.querySelectorAll("summary")].map((s) => (s.textContent ?? "").replace(/\(\d+\)\s*/, "").trim());

describe("DetailFold counts offline and stale like BrainFold (lens B row 6)", () => {
  for (const [name, marker, words] of [
    ["offline", { "data-read-state": "offline" }, "1 offline"],
    ["stale", { "data-read-state": "stale" }, "1 stale"],
    ["error", { "data-read-state": "error" }, "1 unreadable"],
  ] as const) {
    it(`a child rendering data-read-state="${name}" is counted, and the two folds say the same`, async () => {
      act(() => root.render(<StateHarness marker={marker} />));
      await settle();
      expect(summaries()).toEqual(["Detail", "Detail"]);
      await flip();
      const [system, brain] = summaries();
      expect(system, "DetailFold").toContain(words);
      expect(system).toBe(brain);
      await flip();
      expect(summaries()).toEqual(["Detail", "Detail"]);
    });
  }
});

describe("DetailFold marker count", () => {
  it("a marker outside the fold never counts, and a healthy fold claims nothing", async () => {
    act(() => root.render(<Harness />));
    await settle();
    expect(summary()).toBe("Detail");
  });

  it("a child that starts failing after mount makes the summary say 1 unreadable, and recovery clears it", async () => {
    act(() => root.render(<Harness />));
    await settle();
    await flip();
    expect(summary()).toContain("1 unreadable");
    await flip();
    expect(summary()).not.toContain("unreadable");
  });

  it("adds to what the page itself knows", async () => {
    act(() => root.render(<Harness unreadable={2} />));
    await settle();
    expect(summary()).toContain("2 unreadable");
    await flip();
    expect(summary()).toContain("3 unreadable");
  });
});
