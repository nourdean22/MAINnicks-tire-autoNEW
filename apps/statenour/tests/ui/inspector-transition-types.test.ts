import { beforeEach, describe, expect, it, vi } from "vitest";

// Pins the transitionTypes that useInspector hands to the router. Without them
// the inspector's ViewTransition has no type to match, so open and close never
// animate. Hook called directly: useCallback is identity, the router is a spy.

const router = { push: vi.fn(), replace: vi.fn() };
const pathname = "/brain";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T,>(fn: T) => fn,
  useEffect: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));
// The store is a zustand hook; stub it so no React hook runs outside a component.
vi.mock("@/lib/state/inspector-store", () => ({
  useInspectorStore: (selector: (s: { setPeek: () => void }) => unknown) => selector({ setPeek: () => {} }),
}));

import { useInspector } from "@/hooks/use-inspector";
import { INSPECT_TRANSITION_TYPES } from "@/lib/ui/inspect-url";

const REF = { kind: "person", id: "p1" } as const;

function setSearch(search: string) {
  (globalThis as { window?: unknown }).window = { location: { search, pathname } };
}

describe("inspector navigation carries transitionTypes", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    setSearch("");
  });

  it("OPEN from a closed page pushes with the open type", () => {
    const { openInspector } = useInspector();
    openInspector(REF);
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining("inspect=person:p1"), {
      scroll: false,
      transitionTypes: [INSPECT_TRANSITION_TYPES.open],
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("moving to another object while open replaces with the swap type", () => {
    setSearch("?inspect=person:p0");
    const { openInspector } = useInspector();
    openInspector(REF);
    expect(router.replace).toHaveBeenCalledWith(expect.stringContaining("inspect=person:p1"), {
      scroll: false,
      transitionTypes: [INSPECT_TRANSITION_TYPES.swap],
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("CLOSE replaces with the close type and drops the inspect param", () => {
    setSearch("?inspect=person:p1");
    const { closeInspector } = useInspector();
    closeInspector();
    expect(router.replace).toHaveBeenCalledWith(expect.not.stringContaining("inspect="), {
      scroll: false,
      transitionTypes: [INSPECT_TRANSITION_TYPES.close],
    });
  });
});
