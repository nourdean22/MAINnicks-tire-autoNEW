/**
 * The customer's inspection page shows what the tech MEASURED and, once the
 * work is done, the PROOF it was done (0143). Before this change the page knew
 * only a colour, free text and one photo, so a verified repair looked the same
 * as an open one: this test fails against that page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const trpcState = vi.hoisted(() => ({
  inspection: null as unknown,
  mutate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const procedure = (key: string) => ({
    useQuery: () => ({ data: key === "inspection.byToken" ? trpcState.inspection : undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
    useMutation: () => ({ mutate: trpcState.mutate, mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false, isError: false, reset: vi.fn() }),
  });
  const utils = () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn().mockResolvedValue(undefined) }) }) });
  const trpc = new Proxy({}, {
    get: (_t, ns) => {
      if (ns === "useUtils" || ns === "useContext") return utils;
      return new Proxy({}, { get: (_t2, proc) => procedure(`${String(ns)}.${String(proc)}`) });
    },
  });
  return { trpc };
});
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/inspection/abc", vi.fn()],
  useRoute: () => [true, { token: "abcdefghijklmnopqrstuvwxyz" }],
  useParams: () => ({ token: "abcdefghijklmnopqrstuvwxyz" }),
  useSearch: () => "",
}));
vi.mock("@/components/PageLayout", () => ({ default: ({ children }: any) => React.createElement("div", null, children) }));
vi.mock("@/components/LocalBusinessSchema", () => ({ default: () => null }));

const baseInspection = {
  id: 1, vehicleInfo: "2018 Honda Civic", mileage: 88_000, customerName: "A. Customer", technicianName: "Joe",
  overallCondition: "fair", createdAt: "2026-10-01T12:00:00Z", summaryNotes: null, isPublished: 1,
};

describe("InspectionReport · measurements and verification (0143)", () => {
  afterEach(() => cleanup());

  it("renders the found measurements, every photo, and the verified-work block", async () => {
    trpcState.inspection = {
      ...baseInspection,
      items: [
        {
          id: 7, component: "Front brake pads", category: "brakes", condition: "red", estimatedCost: 240, decision: "approved",
          notes: null, recommendedAction: "Replace pads and rotors", photoUrl: "https://x/before-1.jpg",
          photoUrls: ["https://x/before-1.jpg", "https://x/before-2.jpg"],
          measurements: [{ metric: "brake_pad_mm", value: 3, position: "front" }],
          verification: {
            verifiedAt: "2026-10-03T15:00:00Z", verifiedBy: "Joe", note: "New pads and rotors, road tested",
            photoUrls: ["https://x/after.jpg"], measurements: [{ metric: "brake_pad_mm", value: 11, position: "front" }],
          },
        },
      ],
    };
    const { default: InspectionReport } = await import("../pages/InspectionReport");
    render(<InspectionReport />);

    expect(screen.getByText("Pads front 3 mm")).toBeTruthy();
    expect(screen.getByText("Pads front 11 mm")).toBeTruthy();
    expect(screen.getByText(/Completed and verified by Joe/)).toBeTruthy();
    expect(screen.getByText("New pads and rotors, road tested")).toBeTruthy();
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual(
      expect.arrayContaining(["https://x/before-1.jpg", "https://x/before-2.jpg", "https://x/after.jpg"]),
    );
    expect(screen.getByText(/1 repair completed and verified/)).toBeTruthy();
    // A verified item is done: no approve / not-now buttons for it.
    expect(screen.queryByText(/Approve this fix/)).toBeNull();
  });

  it("an unverified flagged item still offers the decision buttons and shows the single legacy photo", async () => {
    trpcState.inspection = {
      ...baseInspection,
      items: [
        { id: 8, component: "LF tire", category: "tires", condition: "yellow", estimatedCost: 120, decision: null, notes: null, recommendedAction: null, photoUrl: "https://x/tire.jpg", photoUrls: [], measurements: [{ metric: "tread_depth_32nds", value: 4, position: "LF" }], verification: null },
      ],
    };
    const { default: InspectionReport } = await import("../pages/InspectionReport");
    render(<InspectionReport />);
    expect(screen.getByText('LF 4/32"')).toBeTruthy();
    expect(screen.getByText(/Approve this fix/)).toBeTruthy();
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toContain("https://x/tire.jpg");
    expect(screen.queryByTestId("verification")).toBeNull();
  });
});
