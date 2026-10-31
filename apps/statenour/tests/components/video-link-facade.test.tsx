// @vitest-environment jsdom
/**
 * U3 (2026-10-31) · a video link in chat plays in place, and nothing loads before the tap.
 * Before: no embed code at all; a YouTube link was only a link out of the app.
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { VideoLinks } from "@/components/chat/video-link-facade";

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function render(text: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<VideoLinks text={text} />));
}

describe("VideoLinks (U3)", () => {
  it("a YouTube link shows a Play card and loads nothing until the tap", () => {
    render("this one https://youtu.be/dQw4w9WgXcQ");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    act(() => (host.querySelector('button[aria-label="Play YouTube video here"]') as HTMLButtonElement).click());
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
  });

  it("an Instagram reel is a link card, never an iframe", () => {
    render("https://www.instagram.com/reel/Cabc123/");
    expect(host.querySelector("iframe")).toBeNull();
    const a = host.querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toContain("Open on Instagram");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("CONTROL: text without a video link renders nothing", () => {
    render("see https://example.com and call me");
    expect(host.innerHTML).toBe("");
  });
});
