/**
 * The Photo check card is reachable: the Instagram admin renders it in the Create (Studio) view and
 * nowhere else, next to the Studio itself, inside the admin shell that hosts ConfirmDialog.
 * Registration is not reachability (assert-the-consumer): this renders the real InstagramAdmin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
vi.mock("@/pages/admin/instagram/Inbox", () => ({ Inbox: h.Null }));
vi.mock("@/pages/admin/instagram/Learn", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Settings", () => ({ default: h.Null }));
vi.mock("@/pages/admin/DraftBoardPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/PatternLab", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Strategy", () => ({ default: h.Null }));
vi.mock("@/components/admin/AutonomyCommandCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/ActionCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Pipeline", () => ({ Pipeline: h.Null }));

import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";

beforeEach(() => window.history.replaceState({}, "", "/admin"));
afterEach(cleanup);

describe("Photo check card mount", () => {
  it("the Create view shows the Studio and the Photo check card", () => {
    window.history.replaceState({}, "", "/admin?igview=create");
    render(<InstagramAdmin />);
    expect(screen.getByText("Studio form")).toBeTruthy();
    expect(screen.getByText("Photo check")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose or take a photo" })).toBeTruthy();
  });

  it("positive control: the Today view does not render it", () => {
    window.history.replaceState({}, "", "/admin?igview=today");
    render(<InstagramAdmin />);
    expect(screen.getByText("Today view")).toBeTruthy();
    expect(screen.queryByText("Photo check")).toBeNull();
  });
});
