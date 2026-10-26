/**
 * leads-brief-truth.test.tsx · 2026-10-26 (job 2026-10-26-since-1024-audit)
 *
 * The lead brief sits above the Sales Pipeline list. PR 3291 took job applicants (source
 * "careers") out of that list; the brief kept counting them, so an applicant waiting 5 hours
 * read as an SLA breach the list below never showed. And a failed read showed "Loading lead
 * pipeline" forever. Both are pinned here through the real component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  q: { data: undefined as unknown, isLoading: false, isError: false },
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { lead: { list: { useQuery: () => ({ ...h.q, refetch: h.refetch }) } } },
}));

import { LeadsBrief } from "../pages/admin/leads/LeadsBrief";

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const lead = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Test Lead",
  status: "new",
  source: "website",
  createdAt: hoursAgo(5),
  lastFollowUpAt: null,
  estimatedValueCents: 0,
  ...over,
});

beforeEach(() => {
  h.q = { data: undefined, isLoading: false, isError: false };
  h.refetch.mockClear();
});

describe("LeadsBrief", () => {
  it("a job applicant is not a sales lead: no SLA breach for an applicant waiting 5 hours", () => {
    h.q.data = [lead({ id: 7, source: "careers" })];
    render(<LeadsBrief onSlaAction={() => {}} />);
    expect(screen.queryByText(/SLA breach/)).toBeNull();
    expect(screen.getByText(/0 total tracked/)).toBeTruthy();
  });

  it("control: the same lead from the website is an SLA breach", () => {
    h.q.data = [lead({ id: 8 })];
    render(<LeadsBrief onSlaAction={() => {}} />);
    expect(screen.getByText(/SLA breach/)).toBeTruthy();
  });

  it("a failed read says it could not load and offers Retry, never Loading forever", () => {
    h.q.isError = true;
    render(<LeadsBrief onSlaAction={() => {}} />);
    expect(screen.getByText(/couldn't load: unknown, not empty/)).toBeTruthy();
    expect(screen.queryByText(/Loading lead pipeline/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
});
