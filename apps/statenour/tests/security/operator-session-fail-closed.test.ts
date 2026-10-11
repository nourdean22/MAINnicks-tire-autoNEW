/**
 * 07-SN-13 (b) · with Google auth ON and no session, getOperatorSession() returned the MOCK operator.
 * When AUTH_MOCK_USER_EMAIL equals AUTH_ALLOWED_EMAIL, the sign-in page then treated an anonymous
 * visitor as the signed-in owner and redirected them on. Auth on + no session must be null.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: true, session: null as null | { user: { email: string; name?: string } } }));
vi.mock("@/auth", () => ({
  get authEnabled() {
    return state.enabled;
  },
  auth: async () => state.session,
}));

import { getOperatorSession } from "@/lib/auth";

const OWNER = "owner@example.com";

describe("getOperatorSession fails closed (07-SN-13 b)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    state.enabled = true;
    state.session = null;
  });

  it("auth ON + no session -> null, even when the mock email equals the allowed email", async () => {
    vi.stubEnv("AUTH_ALLOWED_EMAIL", OWNER);
    vi.stubEnv("AUTH_MOCK_USER_EMAIL", OWNER);
    expect(await getOperatorSession()).toBeNull();
  });

  it("CONTROL: auth ON + a real session -> that session's operator", async () => {
    state.session = { user: { email: OWNER, name: "Nour" } };
    expect(await getOperatorSession()).toMatchObject({ email: OWNER, name: "Nour", role: "operator" });
  });

  it("CONTROL: auth OFF (local dev) -> still the mock operator", async () => {
    state.enabled = false;
    vi.stubEnv("AUTH_MOCK_USER_EMAIL", OWNER);
    expect(await getOperatorSession()).toMatchObject({ email: OWNER, role: "operator" });
  });
});
