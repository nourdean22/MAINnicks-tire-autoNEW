/**
 * Wave 2V slash-command hygiene (2026-10-19). `/costs` opened the AI Cost page, which is cut: its label
 * ("AI Cost & Health Dashboard") would lie, so the command is gone. `/pinned` is the Brain Memory pinned panel;
 * `/pins` stays as a muscle-memory alias to the same place.
 */
import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS } from "@/hooks/use-slash-commands";

describe("slash commands after the System and Pins cuts", () => {
  it("SUBJECT: the registry is the real one", () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(20);
    expect(SLASH_COMMANDS.some((c) => c.cmd === "/image")).toBe(true);
  });

  it("/costs is gone, and no command navigates to a cut System page", () => {
    expect(SLASH_COMMANDS.some((c) => c.cmd === "/costs")).toBe(false);
    const cut = /^\/system\/(health|fleet|logs|ai-cost|costs|calibration|cockpit-observability)\b/;
    expect(SLASH_COMMANDS.filter((c) => c.navigate && cut.test(c.navigate)).map((c) => c.cmd)).toEqual([]);
  });

  it("/pinned and the /pins alias both open the pinned panel on Brain Memory", () => {
    const target = "/brain?tab=memory#pinned-context";
    expect(SLASH_COMMANDS.find((c) => c.cmd === "/pinned")?.navigate).toBe(target);
    expect(SLASH_COMMANDS.find((c) => c.cmd === "/pins")?.navigate).toBe(target);
  });
});
