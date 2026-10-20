/**
 * /admin/<slug>[/<id>] path redirect (review round 1, 2026-10-19): the id rides along
 * only to Customers, where ?id= opens a customer. A /admin/leads/123 link from
 * StateNour must never later open customer 123.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

const h = vi.hoisted(() => ({ rest: "", redirects: [] as Array<{ to: string; replace?: boolean }> }));

vi.mock("wouter", () => ({
  useParams: () => ({ "*": h.rest }),
  Redirect: (props: { to: string; replace?: boolean }) => {
    h.redirects.push(props);
    return null;
  },
}));

import AdminPathRedirect from "../pages/admin/AdminPathRedirect";

const go = (rest: string) => {
  h.rest = rest;
  h.redirects.length = 0;
  render(React.createElement(AdminPathRedirect));
  return h.redirects[h.redirects.length - 1];
};

afterEach(() => { h.redirects.length = 0; });

describe("AdminPathRedirect", () => {
  it("/admin/leads/123 lands on Sales Pipeline with no id", () => {
    const r = go("leads/123");
    expect(r.to).toBe("/admin?tab=leads");
    expect(r.replace).toBe(true);
  });

  it("/admin/customers/123 keeps the id (it opens that customer)", () => {
    expect(go("customers/123").to).toBe("/admin?tab=customers&id=123");
  });

  it("/admin/callbacks lands on Voice > Calls", () => {
    expect(go("callbacks").to).toBe("/admin?tab=voiceReceptionist&voiceTab=calls");
  });

  it("an unknown slug is passed on so the admin can say the link is bad", () => {
    expect(go("nope").to).toBe("/admin?tab=nope");
  });
});
