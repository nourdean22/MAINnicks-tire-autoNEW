/**
 * tests/hooks/use-provider-health.test.tsx · de-Venice control-plane lock.
 *
 * Locks the tone→bool contract of `useProviderHealth()`: silence is the
 * reward for health. Only overallTone 'amber'/'red' resolves to
 * unhealthy (false); 'green' and undefined (initial load / transport
 * error) resolve to healthy (true) — same default the legacy
 * useState(true) gave. A regression that flips the undefined default
 * would flash the degraded dot on every cold load.
 *
 * The vitest env is Node (no jsdom · no testing-library — see
 * vitest.config.ts + the house precedent in mobile-a11y.test.tsx /
 * level-up-directive-card.test.ts). So we EXECUTE the hook the
 * no-jsdom way: mock the tRPC client, then drive the hook through a
 * one-shot probe component rendered with react-dom/server. The hook
 * runs for real; we read its boolean out of the static markup. This
 * asserts behavior, not source text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Controllable tRPC client mock. `useProviderHealth` only touches
// `trpc.system.providerHealth.useQuery`, so that's all we stub. The
// query options arg is ignored — the hook never reads it back.
const useQueryMock = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      providerHealth: {
        useQuery: (...args: unknown[]) => useQueryMock(...args),
      },
    },
  },
}));

// Imported AFTER the mock is registered (vi.mock is hoisted, so this is
// safe — the import resolves the mocked module).
import { useProviderHealth } from "@/components/chat/use-provider-health";

/**
 * Render the hook once and surface its boolean result as text we can
 * assert against. Returns the string "true" / "false".
 */
function runHook(): string {
  function Probe() {
    const healthy = useProviderHealth();
    return <>{String(healthy)}</>;
  }
  return renderToStaticMarkup(<Probe />);
}

beforeEach(() => {
  useQueryMock.mockReset();
});

describe("useProviderHealth · tone → healthy-bool mapping", () => {
  it("green tone → healthy (true)", () => {
    useQueryMock.mockReturnValue({ data: { overallTone: "green" } });
    expect(runHook()).toBe("true");
  });

  it("undefined data (cold load / transport error) → healthy (true)", () => {
    useQueryMock.mockReturnValue({ data: undefined });
    expect(runHook()).toBe("true");
  });

  it("amber tone → unhealthy (false)", () => {
    useQueryMock.mockReturnValue({ data: { overallTone: "amber" } });
    expect(runHook()).toBe("false");
  });

  it("red tone → unhealthy (false)", () => {
    useQueryMock.mockReturnValue({ data: { overallTone: "red" } });
    expect(runHook()).toBe("false");
  });
});
