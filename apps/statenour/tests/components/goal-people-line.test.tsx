/**
 * The Goals tab's people line (people W4 S3, 2026-10-30): each person on the
 * goal links to their row on /people; no people renders nothing (control).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { GoalPeopleLine } from "@/components/goals/goal-people-line";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function mount(people: Array<{ id: string; name: string }>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<GoalPeopleLine people={people} />));
  return host;
}

describe("GoalPeopleLine", () => {
  it("links each person to their row on /people", () => {
    const el = mount([
      { id: "p1", name: "Demo Ana" },
      { id: "p2", name: "Demo Zed" },
    ]);
    const links = [...el.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Demo Ana", "/people?inspect=person:p1"],
      ["Demo Zed", "/people?inspect=person:p2"],
    ]);
    expect(el.textContent).toMatch(/^With /);
  });

  it("Enter and a click on a name stay with the link: the goal row's handlers never see them (Codex on 3434)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let rowKeys = 0;
    let rowClicks = 0;
    act(() =>
      root!.render(
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            rowKeys++;
            e.preventDefault();
          }}
          onClick={() => rowClicks++}
        >
          <GoalPeopleLine people={[{ id: "p1", name: "Demo Ana" }]} />
        </div>,
      ),
    );
    const a = host.querySelector("a")!;
    a.addEventListener("click", (e) => e.preventDefault()); // keep jsdom from navigating
    act(() => {
      a.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      a.click();
    });
    expect(rowKeys).toBe(0);
    expect(rowClicks).toBe(0);
  });

  it("CONTROL: no people, nothing rendered", () => {
    expect(mount([]).textContent).toBe("");
  });
});
