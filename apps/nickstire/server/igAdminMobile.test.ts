/**
 * iOS-PWA mobile regression pins for the Instagram admin (Wave 3, 2026-07-24).
 *
 * Source assertions (the repo's established pattern for client invariants that
 * have no DOM test harness — see adminLockout.test.ts, emptyIsNotUnknown.test.ts,
 * deferredPublishOwnership.test.ts). Each pin is a one-line fact whose
 * regression broke the operator's phone in a specific, verified way.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), `client/src/pages/admin/${p}`), "utf8");

describe("the primary tab grid fits its container", () => {
  it("TabsList override carries h-auto — base tabs.tsx fixes h-9, and a multi-row/odd-fit grid without it paints panel content over the lower tabs", () => {
    expect(read("instagram/InstagramAdmin.tsx")).toMatch(/TabsList className="grid h-auto w-full grid-cols-/);
  });
});

describe("irreversible actions take two in-DOM taps (window.confirm is dead in the installed PWA)", () => {
  it("QueueV2 publish goes through the payload-confirm panel, not straight to mutate", () => {
    const q = read("instagram/QueueV2.tsx");
    expect(q).toMatch(/setConfirmPublishId/);
    expect(q).toMatch(/Yes — publish now/);
  });

  it("ReelQueue reject is armed then confirmed, never one icon tap", () => {
    // (Ported from the legacy Queue, deleted in the reel-absorption wave.)
    const q = read("instagram/ReelQueue.tsx");
    expect(q).toMatch(/setConfirmRejectId/);
    // the destructive mutate only fires from the confirm row
    expect(q).not.toMatch(/onClick=\{\(\) => rejectDraft\.mutate/);
  });

  it("ReelQueue publish is two-tap through the exact-payload panel (an upgrade over the legacy one-tap)", () => {
    const q = read("instagram/ReelQueue.tsx");
    expect(q).toMatch(/setConfirmPublishId/);
    expect(q).toMatch(/Yes — publish now/);
  });

  it("ActionCenter ambiguous-publish resolutions are armed Buttons, not 11px links", () => {
    const a = read("instagram/ActionCenter.tsx");
    expect(a).toMatch(/armedResolve/);
    expect(a).not.toMatch(/className="text-\[11px\] text-green-600 underline"/);
  });
});

describe("touch-hostile controls are gone", () => {
  it("legacy Studio's clear-media button is no longer hover-revealed (invisible-but-tappable on iOS)", () => {
    expect(read("instagram/Studio.tsx")).not.toMatch(/opacity-0 group-hover:opacity-100/);
  });

  it("Inbox cards use dvh so the reply composer survives the iOS keyboard", () => {
    const i = read("instagram/Inbox.tsx");
    expect(i).toMatch(/h-\[70dvh\] lg:h-\[600px\]/);
    expect(i).not.toMatch(/flex flex-col h-\[600px\]/);
  });

  it("Inbox tone chips meet the 44px minimum (a mis-tap silently changed the AI reply's tone)", () => {
    expect(read("instagram/Inbox.tsx")).toMatch(/min-h-11 px-3 text-xs rounded border capitalize/);
  });
});

describe("scheduling is explicit about time", () => {
  it("the datetime input carries min=now and an Eastern-time preview with a countdown", () => {
    const q = read("instagram/QueueV2.tsx");
    expect(q).toMatch(/min=\{nowLocalIso\(\)\}/);
    expect(q).toMatch(/America\/New_York/);
  });
});
