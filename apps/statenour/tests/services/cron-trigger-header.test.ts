/**
 * A heal's trigger id rides the cron fetch as x-cron-trigger-id (2026-10-11).
 * cronHandler stamps it on the run's row; resolveTimedOutHeals matches on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { runManifestCron, triggerCronByPath } from "@/lib/services/cron-control";

const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok", { status: 200 }));
const sentHeaders = () => new Headers(fetchSpy.mock.calls[0][1]?.headers);

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  process.env.CRON_SECRET = "s3cret";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cron trigger: x-cron-trigger-id", () => {
  it("triggerCronByPath sends the trigger id as a header, next to the cron bearer", async () => {
    await triggerCronByPath("/api/cron/drift-check", "heal:cmabc123def456ghi789jkl0");
    expect(sentHeaders().get("x-cron-trigger-id")).toBe("heal:cmabc123def456ghi789jkl0");
    expect(sentHeaders().get("authorization")).toBe("Bearer s3cret");
  });

  it("runManifestCron passes it through to the route fetch", async () => {
    const anyRoute = (await import("@/config/crons")).CRONS.find(
      (c) => c.mode !== "retired" && c.path && !c.name.startsWith("mega"),
    );
    expect(anyRoute).toBeTruthy();
    await runManifestCron(anyRoute!.name, "heal:cmabc123def456ghi789jkl0");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentHeaders().get("x-cron-trigger-id")).toBe("heal:cmabc123def456ghi789jkl0");
  });

  it("CONTROL: a plain trigger sends no trigger id header", async () => {
    await triggerCronByPath("/api/cron/drift-check");
    expect(sentHeaders().has("x-cron-trigger-id")).toBe(false);
  });
});
