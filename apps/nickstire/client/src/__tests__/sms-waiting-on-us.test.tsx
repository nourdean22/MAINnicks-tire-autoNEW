/**
 * "Waiting on us" in the Messages header (2026-10-23, job admin-opportunities-path).
 *
 * The header used to sum sms_conversations.unreadCount: 129 on the day the real
 * number of customers waiting on a human was 1 (sms_response_jobs human_pending,
 * served by smsConversations.humanPendingSummary). Opening a thread clears
 * unread and the crew answers on the phone, so the sum never decays and trains
 * everyone to ignore a badge, including the one real wait. The header now reads
 * the server's own count. The per-thread dot in the list is a different thing
 * (this thread has unopened texts) and stays.
 *
 * THREE STATES, NEVER TWO. The server THROWS when it cannot count, so an error
 * is UNKNOWN. A paused query (offline PWA) has no data and no error and is
 * UNKNOWN too. A real zero is a zero with a successful read behind it.
 *
 * THE CONSUMER. A component that is never mounted counts nothing, so the last
 * block reads SmsSection.tsx (comments stripped, with a planted-positive control
 * for the stripper) and requires the mount and the end of the unread sum.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";

const h = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false },
  inputs: [] as unknown[][],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    smsConversations: {
      humanPendingSummary: {
        useQuery: (...args: unknown[]) => {
          h.inputs.push(args);
          return h.result;
        },
      },
    },
  },
}));

import WaitingOnUs from "../pages/admin/outreach/WaitingOnUs";

beforeEach(() => {
  h.result = { data: undefined, isLoading: false, isError: false };
  h.inputs.length = 0;
});
afterEach(cleanup);

describe("WaitingOnUs reads the server's human-pending count", () => {
  it("shows the real number: 1 customer waiting", () => {
    h.result = { data: { humanPending: 1, overdue: 0, oldestWaitingMinutes: 12 }, isLoading: false, isError: false };
    render(<WaitingOnUs />);
    expect(screen.getByText(/^1 waiting on us/)).toBeTruthy();
  });

  it("names how many are past the SLA when some are", () => {
    h.result = { data: { humanPending: 3, overdue: 2, oldestWaitingMinutes: 95 }, isLoading: false, isError: false };
    render(<WaitingOnUs />);
    expect(screen.getByText(/^3 waiting on us/)).toBeTruthy();
    expect(screen.getByText(/2 overdue/)).toBeTruthy();
  });

  it("says nobody is waiting only after a successful read of zero", () => {
    h.result = { data: { humanPending: 0, overdue: 0, oldestWaitingMinutes: null }, isLoading: false, isError: false };
    render(<WaitingOnUs />);
    expect(screen.getByText(/None waiting on us/)).toBeTruthy();
  });

  it("a failed read is UNKNOWN: never zero, never 'none waiting'", () => {
    h.result = { data: undefined, isLoading: false, isError: true };
    render(<WaitingOnUs />);
    expect(screen.getByText(/unknown/i)).toBeTruthy();
    expect(screen.queryByText(/None waiting/)).toBeNull();
    expect(screen.queryByText(/\b0 waiting/)).toBeNull();
  });

  it("a failed refresh over an old count is still UNKNOWN, not the old count", () => {
    h.result = { data: { humanPending: 1, overdue: 0, oldestWaitingMinutes: 5 }, isLoading: false, isError: true };
    render(<WaitingOnUs />);
    expect(screen.getByText(/unknown/i)).toBeTruthy();
    expect(screen.queryByText(/^1 waiting/)).toBeNull();
  });

  it("a paused query (offline PWA: no data, no error, not loading) is UNKNOWN too", () => {
    h.result = { data: undefined, isLoading: false, isError: false };
    render(<WaitingOnUs />);
    expect(screen.getByText(/unknown/i)).toBeTruthy();
    expect(screen.queryByText(/None waiting/)).toBeNull();
  });

  it("while loading it shows no number at all", () => {
    h.result = { data: undefined, isLoading: true, isError: false };
    render(<WaitingOnUs />);
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.queryByText(/waiting on us/i)).toBeNull();
    expect(screen.getByText(/Checking who is waiting/)).toBeTruthy();
  });

  it("polls, so a reply sent elsewhere clears the number within a minute", () => {
    h.result = { data: { humanPending: 0, overdue: 0, oldestWaitingMinutes: null }, isLoading: false, isError: false };
    render(<WaitingOnUs />);
    const opts = h.inputs[0][1] as { refetchInterval: number };
    expect(opts.refetchInterval).toBeLessThanOrEqual(60_000);
  });
});

/** Strip // lines, block comments and JSX comments so prose cannot satisfy or defeat a source check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("the consumer: SmsSection mounts it and no longer sums unread", () => {
  const sms = stripComments(
    readFileSync(resolve(process.cwd(), "client/src/pages/admin/outreach/SmsSection.tsx"), "utf8"),
  );

  it("positive control: the comment stripper hides a commented name and keeps a live one", () => {
    expect(stripComments("// totalUnread\n/* totalUnread */\nconst a = 1;")).not.toContain("totalUnread");
    expect(stripComments("const totalUnread = 1;")).toContain("totalUnread");
  });

  it("the Messages header mounts <WaitingOnUs />", () => {
    expect(sms).toMatch(/import WaitingOnUs from "\.\/WaitingOnUs";/);
    expect(sms).toContain("<WaitingOnUs />");
  });

  it("nothing sums unreadCount any more", () => {
    expect(sms).not.toContain("totalUnread");
    expect(sms).not.toMatch(/reduce\([^)]*unreadCount/);
  });

  it("the per-thread unread dot is still there", () => {
    expect(sms).toContain("const unread = (c.unreadCount ?? 0) > 0;");
  });
});
