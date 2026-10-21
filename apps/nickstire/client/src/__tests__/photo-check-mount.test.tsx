/**
 * The Photo check card is reachable: the Instagram admin shows it in the Create (Studio) view and
 * nowhere else, above the Studio itself, inside the admin shell that hosts ConfirmDialog. It stays
 * mounted (hidden) on the other views so a render in flight is not lost on a tab switch.
 * Registration is not reachability (assert-the-consumer): this renders the real InstagramAdmin.
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
vi.mock("@/pages/admin/instagram/StudioV2", () => ({ default: () => <p>Studio form</p> }));
vi.mock("@/pages/admin/instagram/Today", () => ({ default: () => <p>Today view</p> }));
vi.mock("@/pages/admin/instagram/QueueV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Learn", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Settings", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Strategy", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/ActionCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Controls", () => ({ Controls: h.Null }));

import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";

beforeEach(() => window.history.replaceState({}, "", "/admin"));
afterEach(cleanup);

describe("Photo check card mount", () => {
  it("the Create view shows the Studio and the Photo check card", () => {
    window.history.replaceState({}, "", "/admin?igview=create");
    render(<InstagramAdmin />);
    const studio = screen.getByText("Studio form");
    const card = screen.getByText("Photo check");
    // The card comes first: a long Studio form would otherwise bury it on a phone.
    expect(card.compareDocumentPosition(studio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose or take a photo" })).toBeTruthy();
  });

  it("positive control: the Today view does not show it (it is mounted but hidden)", () => {
    window.history.replaceState({}, "", "/admin?igview=today");
    render(<InstagramAdmin />);
    expect(screen.getByText("Today view")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose or take a photo" })).toBeNull();
    expect(screen.getByText("Photo check").closest("[hidden]")).not.toBeNull();
  });

  it("leaving Create mid-render does not unmount the card, so a paid picture still lands", () => {
    window.history.replaceState({}, "", "/admin?igview=create");
    render(<InstagramAdmin />);
    const card = screen.getByText("Photo check");
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    expect(screen.getByText("Today view")).toBeTruthy();
    // Same node, still in the document: its state (an in-flight render, a scorecard) survives.
    expect(card.isConnected).toBe(true);
    expect(card.closest("[hidden]")).not.toBeNull();
  });
});
