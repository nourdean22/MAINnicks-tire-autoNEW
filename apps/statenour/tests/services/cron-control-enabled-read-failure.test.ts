/**
 * A failed kill-switch read is logged, not silent (audit 03-X4, 2026-10-11).
 *
 * isCronEnabled fails OPEN on purpose (an unreadable switch never stops a cron), but
 * its catch returned true with no trace: a switch the operator turned off and the DB
 * could not read looked exactly like a switch that was on. Fail-open stays; the
 * failure now leaves a warn line naming the job.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findUnique: vi.fn(), warn: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { findUnique: h.findUnique } } }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: h.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { isCronEnabled } from "@/lib/services/cron-control";

beforeEach(() => {
  h.findUnique.mockReset();
  h.warn.mockReset();
});

describe("isCronEnabled: read failure", () => {
  it("a rejected read stays enabled AND warns once with the job name", async () => {
    h.findUnique.mockRejectedValue(new Error("db down"));
    await expect(isCronEnabled("x")).resolves.toBe(true);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith("kill_switch_read_failed", expect.objectContaining({ jobName: "x", message: "db down" }));
  });

  it("an unparseable row stays enabled AND warns", async () => {
    h.findUnique.mockResolvedValue({ content: "{bad json" });
    await expect(isCronEnabled("x")).resolves.toBe(true);
    expect(h.warn).toHaveBeenCalledWith("kill_switch_read_failed", expect.objectContaining({ jobName: "x" }));
  });

  it("CONTROL: no row is enabled with no warn; a disabled row is false", async () => {
    h.findUnique.mockResolvedValueOnce(null);
    await expect(isCronEnabled("x")).resolves.toBe(true);
    h.findUnique.mockResolvedValueOnce({ content: JSON.stringify({ enabled: false }) });
    await expect(isCronEnabled("x")).resolves.toBe(false);
    expect(h.warn).not.toHaveBeenCalled();
  });
});
