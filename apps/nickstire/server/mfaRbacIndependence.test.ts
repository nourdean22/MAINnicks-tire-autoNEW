/**
 * Turning off the second factor also turned off every role.
 *
 * _core/trpc.ts early-returned when ADMIN_MFA_REQUIRED was unset, injecting
 * MFA_NOT_REQUIRED_STATE — whose adminRole is the literal string "owner"
 * (adminSecurity.ts:34) — and SKIPPING permissionForAdminProcedure entirely.
 *
 * So every user with role === "admin" was an effective owner, and
 * manager / front_desk / tech / accountant / viewer were decorative. One control
 * silently disabling an unrelated one.
 *
 * VERIFIED AGAINST PRODUCTION before enabling: all three admin users
 * (nourdean22@, moeseuclid@, and a leftover dev row) already carry adminRole
 * "owner", and mfaEnabled is 0 for all three. So enforcing the ROLE check changes
 * nobody's access today, while making MFA unconditional would reproduce the
 * lockout that was correctly reversed on 2026-07-16. The two must move
 * separately, which is the whole point.
 */
import { describe, it, expect } from "vitest";
import { readCode, readSource } from "./testUtils/sourceAssertions";

const trpc = readSource("server/_core/trpc.ts");
const trpcCode = readCode("server/_core/trpc.ts");
const status = readSource("server/routers/adminSecurity.ts");

describe("authorization is enforced regardless of MFA posture", () => {
  it("no longer early-returns past the permission check when MFA is off", () => {
    // The exact defect: a return statement that skipped authorization entirely.
    expect(trpcCode).not.toMatch(/if \(!isAdminMfaRequired\(\)\) \{\s*return next\(/);
  });

  it("the permission check is unconditional", () => {
    // permissionForAdminProcedure + hasAdminPermission must sit OUTSIDE any
    // isAdminMfaRequired branch.
    expect(trpc).toMatch(/const requiredPermission = permissionForAdminProcedure\(path, type\)/);
    expect(trpc).toMatch(/if \(!hasAdminPermission\(adminRole, requiredPermission\)\)/);
  });

  it("MFA checks remain conditional — they must not become a lockout", () => {
    // mfaEnabled is 0 for all three production admins. Making these
    // unconditional locks every one of them out.
    expect(trpc).toMatch(/const mfaRequired = isAdminMfaRequired\(\)/);
    expect(trpc).toMatch(/if \(mfaRequired\) \{/);
  });

  it("an UNREADABLE role falls back to today's behaviour, and says so loudly", () => {
    // Deliberately NOT viewer. getAdminSecurityState returns null when the
    // DATABASE is unreachable, not only when a row is missing — so viewer would
    // mean a transient DB hiccup locks the owner out mid-shift. That is the
    // lockout hit live and reversed on 2026-07-16, arriving through a new door.
    //
    // The rule: this change must be a strict improvement over today, never an
    // availability regression.
    //   role readable   -> enforce the real role   (stronger than today)
    //   role unreadable -> today's behaviour       (no worse than today)
    expect(trpc).toMatch(/const effective = security \?\? MFA_NOT_REQUIRED_STATE/);
    // ...and the fail-open is NAMED, not hidden — logged at ERROR so it surfaces
    // as an incident rather than as silence.
    expect(trpc).toMatch(/Roles are NOT being enforced for this request/);
    expect(trpc).toMatch(/log\.error\(/);
  });
});

describe("the client is told the real role", () => {
  it("status no longer hardcodes owner when MFA is off", () => {
    // It returned MFA_NOT_REQUIRED_STATE.adminRole — the literal "owner" — so the
    // sidebar rendered an owner's navigation for every admin.
    expect(status).toMatch(/const stored = await getAdminSecurityState\(ctx\.user\.openId\)/);
    expect(status).toMatch(/stored\?\.adminRole \?\? MFA_NOT_REQUIRED_STATE\.adminRole/);
  });

  it("still reports mfaRequired false so the MFA wall does not render", () => {
    // Enforcement is off; there is no wall to clear. Rendering one would be the
    // reversed lockout returning through the client instead of the server.
    expect(status).toMatch(/mfaRequired: false/);
  });
});
