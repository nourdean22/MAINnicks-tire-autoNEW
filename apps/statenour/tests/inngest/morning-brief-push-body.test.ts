/**
 * Cron-truth audit dim-2 · the push body must never show HTML.
 *
 * The composer emits `<b>Drift:</b>`-style tags; the audio path strips
 * them, the push path didn't — caught the day before the function's
 * first-ever delivery (Inngest re-sync 2026-07-28). Also pins the
 * order: strip THEN slice, so a trim can't cut a tag in half and leak
 * a partial `<` into the notification.
 */
import { describe, it, expect } from "vitest";
import { pushBodyFromBrief } from "@/lib/inngest/functions/morning-brief";

describe("pushBodyFromBrief", () => {
  it("strips the composer's HTML tags", () => {
    const body = pushBodyFromBrief("<b>Drift:</b> 2 goals idle\n<b>Rev (today):</b> $1,240 · 3 jobs");
    expect(body).toBe("Drift: 2 goals idle · Rev (today): $1,240 · 3 jobs");
    expect(body).not.toMatch(/[<>]/);
  });

  it("strips before slicing — a tag spanning the 200-char boundary cannot leak", () => {
    const long = `${"x".repeat(195)}<b>boundary</b>tail`;
    const body = pushBodyFromBrief(long);
    expect(body).not.toMatch(/[<>]/);
  });

  it("collapses newlines to the · separator and caps at 200 chars", () => {
    const body = pushBodyFromBrief(`line one\n\nline two\n${"y".repeat(300)}`);
    expect(body.startsWith("line one · line two")).toBe(true);
    expect(body.length).toBeLessThanOrEqual(200);
  });
});
