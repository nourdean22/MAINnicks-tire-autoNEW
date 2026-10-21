/**
 * Instagram > Controls: the one view that holds every stop switch for autonomous posting and replies.
 *
 * Order is the contract (kill switch and limits first, then the send switches, image autopost,
 * the comment responder, and the read-only pipeline health last). Registration is not reachability
 * (assert-the-consumer): this renders the real InstagramAdmin shell, so it also proves the gear
 * menu and every old deep link (?igview=pipeline, ?igview=control) reach it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({ Null: () => null }));

vi.mock("@/lib/trpc", () => {
  const idleQuery = () => ({ data: undefined, isLoading: false, isError: false, fetchStatus: "idle", refetch: () => {} });
  const mutation = { useMutation: () => ({ mutateAsync: async () => ({}), isPaused: false, reset: () => {} }) };
  return {
    trpc: {
      contentAdmin: { reelJobsNeedingAttention: { useQuery: idleQuery } },
      instagramAdmin: { getPipelineHealth: { useQuery: idleQuery } },
      instagramStudio: { uploadEvidencePhoto: mutation, checkPhoto: mutation, brandedPhoto: mutation },
    },
  };
});
vi.mock("@/pages/admin/instagram/StudioV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Today", () => ({ default: () => <p>Today view</p> }));
vi.mock("@/pages/admin/instagram/QueueV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Learn", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Settings", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Strategy", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/ActionCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/PhotoCheckCard", () => ({ PhotoCheckCard: h.Null }));
// The five parts of Controls, each reduced to a marker so the test reads order, not their internals.
vi.mock("@/components/admin/AutonomyCommandCenter", () => ({ default: () => <section>part: autonomy</section> }));
vi.mock("@/pages/admin/instagram/SendSwitchesCard", () => ({ SendSwitchesCard: () => <section>part: send switches</section> }));
vi.mock("@/pages/admin/instagram/ImageAutopostCard", () => ({ ImageAutopostCard: () => <section>part: image autopost</section> }));
vi.mock("@/pages/admin/instagram/CommentResponderCard", () => ({ CommentResponderCard: () => <section>part: comment responder</section> }));
vi.mock("@/pages/admin/instagram/Pipeline", () => ({ Pipeline: () => <section>part: pipeline health</section> }));

import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";

const ORDER = [
  "part: autonomy", "part: send switches", "part: image autopost", "part: comment responder", "part: pipeline health",
];

beforeEach(() => window.history.replaceState({}, "", "/admin"));
afterEach(cleanup);

describe("Controls renders every stop switch, in order", () => {
  it("?igview=controls shows all five parts, in the contract order", () => {
    window.history.replaceState({}, "", "/admin?igview=controls");
    render(<InstagramAdmin />);
    const nodes = ORDER.map((t) => screen.getByText(t));
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${ORDER[i - 1]} before ${ORDER[i]}`).toBeTruthy();
    }
  });

  it.each(["pipeline", "control"])("the old ?igview=%s deep link reaches the same view", (old) => {
    window.history.replaceState({}, "", `/admin?igview=${old}`);
    render(<InstagramAdmin />);
    for (const t of ORDER) expect(screen.getByText(t)).toBeTruthy();
  });

  it("the gear menu has a Controls entry that opens it and writes the URL", async () => {
    render(<InstagramAdmin />);
    expect(screen.queryByText("part: autonomy")).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More surfaces" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Controls" }));
    expect(new URL(window.location.href).searchParams.get("igview")).toBe("controls");
    expect(screen.getByText("part: autonomy")).toBeTruthy();
  });

  it("positive control: Today does not show any of them", () => {
    window.history.replaceState({}, "", "/admin?igview=today");
    render(<InstagramAdmin />);
    expect(screen.getByText("Today view")).toBeTruthy();
    for (const t of ORDER) expect(screen.queryByText(t)).toBeNull();
  });
});

describe("the cut views are gone and their links do not strand", () => {
  it.each(["community", "inbox", "patterns"])("?igview=%s lands on Today", (old) => {
    window.history.replaceState({}, "", `/admin?igview=${old}`);
    render(<InstagramAdmin />);
    expect(screen.getByText("Today view")).toBeTruthy();
  });

  it("no cut view is offered in the gear menu or the primary row", async () => {
    render(<InstagramAdmin />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "More surfaces" }), { button: 0, ctrlKey: false });
    await screen.findByRole("menuitem", { name: "Controls" });
    const offered = [...screen.getAllByRole("menuitem"), ...screen.getAllByRole("tab")].map((n) => n.textContent ?? "");
    for (const cut of ["Community", "Planning board", "Pattern Lab", "Pipeline health", "Autonomy control"]) {
      expect(offered.join("|")).not.toContain(cut);
    }
  });
});
