/**
 * Mission predicate tests · v10.0.154
 *
 * The single source of truth for "is this an Inbox catch-all vs a
 * real user-chosen project?" — three surfaces depend on this matching
 * (Plan view, Track/Stats tile, active-project cap), so the helper
 * is exercised against every shape we've seen in the wild.
 */

import { describe, it, expect } from "vitest";
import {
  isInboxMission,
  isUserProject,
} from "@/lib/services/mission-helpers";

describe("isInboxMission", () => {
  it("matches the legacy bare 'Inbox' title", () => {
    expect(isInboxMission("Inbox")).toBe(true);
  });

  it("matches per-domain inbox titles (lowercase domain)", () => {
    expect(isInboxMission("Inbox - business")).toBe(true);
    expect(isInboxMission("Inbox - personal")).toBe(true);
    expect(isInboxMission("Inbox - health")).toBe(true);
    expect(isInboxMission("Inbox - content")).toBe(true);
    expect(isInboxMission("Inbox - finance")).toBe(true);
  });

  it("matches per-domain inboxes regardless of capitalization", () => {
    expect(isInboxMission("INBOX")).toBe(true);
    expect(isInboxMission("inbox - business")).toBe(true);
    expect(isInboxMission("Inbox - BUSINESS")).toBe(true);
  });

  it("tolerates extra whitespace around the title or hyphen", () => {
    expect(isInboxMission("  Inbox  ")).toBe(true);
    expect(isInboxMission("Inbox  -  business")).toBe(true);
  });

  it("does NOT match real project names that happen to contain 'inbox'", () => {
    expect(isInboxMission("Email Inbox Migration")).toBe(false);
    expect(isInboxMission("Cleanup the Inbox folder")).toBe(false);
    expect(isInboxMission("Inbox Zero Project")).toBe(false);
  });

  it("does not match arbitrary mission titles", () => {
    expect(isInboxMission("home garage cave 1.0")).toBe(false);
    expect(isInboxMission("rising dragon 2.0 projects")).toBe(false);
    expect(isInboxMission("Q3 strategic plan")).toBe(false);
  });

  it("safely returns false for null / undefined / empty", () => {
    expect(isInboxMission(null)).toBe(false);
    expect(isInboxMission(undefined)).toBe(false);
    expect(isInboxMission("")).toBe(false);
  });

  it("rejects multi-word domain suffixes (only single-word domains auto-create)", () => {
    // The auto-domain path always normalizes to one of the 5 enum
    // values (business/personal/health/content/finance) — never a
    // two-word phrase. Be conservative so legitimate "Inbox - Q4 plan"
    // names are NOT auto-classified as inboxes.
    expect(isInboxMission("Inbox - Q4 plan")).toBe(false);
    expect(isInboxMission("Inbox - rising dragon")).toBe(false);
  });
});

describe("isUserProject", () => {
  it("inverts isInboxMission for filter() use", () => {
    expect(isUserProject({ title: "Inbox" })).toBe(false);
    expect(isUserProject({ title: "Inbox - business" })).toBe(false);
    expect(isUserProject({ title: "home garage cave 1.0" })).toBe(true);
  });

  it("works with the full mission shape we get from prisma", () => {
    const m = {
      id: "abc",
      title: "rising dragon 2.0 projects",
      status: "ACTIVE",
      domain: "BUSINESS",
    };
    expect(isUserProject(m)).toBe(true);
  });

  it("filters an array correctly", () => {
    const list = [
      { title: "Inbox" },
      { title: "Inbox - business" },
      { title: "home garage cave 1.0" },
      { title: "rising dragon 2.0 projects" },
      { title: "Inbox - personal" },
    ];
    const userProjects = list.filter(isUserProject);
    expect(userProjects).toHaveLength(2);
    expect(userProjects.map((p) => p.title)).toEqual([
      "home garage cave 1.0",
      "rising dragon 2.0 projects",
    ]);
  });
});
