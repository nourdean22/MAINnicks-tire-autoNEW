# Admin Roles + 2FA — Design Plan

Status: **DESIGN COMPLETE, IMPL DEFERRED** (2026-04-22).
Blocker: implementing a second auth factor requires a session-flow refactor
that is risky to do without a staging environment. Tracked here so when we
sit down for a dedicated auth sprint, the thinking is already done.

---

## Multi-admin roles

### Current state

`drizzle/schema.ts:users.role` is a 2-value enum: `"user" | "admin"`.
`OWNER_OPEN_ID` env auto-promotes to admin on first login. Everyone else
stays user. Admin gets full access to every admin route.

### Target state

```ts
role: mysqlEnum("role", [
  "user",         // customers (public site features, portal)
  "front_desk",   // takes calls, creates bookings, SMS customers
  "tech",         // shop-floor view only (ShopFloorMobile)
  "manager",      // full ops but no financials / no integrations
  "owner",        // = current admin role, full access
]).default("user").notNull()
```

### Gating helpers

New `server/_core/roles.ts`:

```ts
export type Role = "user" | "front_desk" | "tech" | "manager" | "owner";
export function hasRole(user: { role: Role }, required: Role): boolean {
  const rank: Record<Role, number> = {
    user: 0, tech: 1, front_desk: 2, manager: 3, owner: 4,
  };
  return rank[user.role] >= rank[required];
}
```

New tRPC procedure factories:

```ts
export const techProcedure = t.procedure.use(loggerMiddleware).use(
  requireRole("tech"),
);
export const frontDeskProcedure = requireRole("front_desk");
export const managerProcedure = requireRole("manager");
export const ownerProcedure = requireRole("owner");
```

`adminProcedure` becomes an alias for `managerProcedure` to preserve
backward compat with existing 300+ admin endpoints.

### Section gating (client)

Admin nav already groups sections by label (COMMAND / PIPELINE / OUTREACH /
SYSTEM). Add a minimum-role per section in `shared.tsx`:

```ts
{
  id: "shopFloor",
  label: "Shop Floor",
  icon: ...,
  minRole: "tech",  // techs see this
},
{
  id: "compliance",
  label: "Compliance",
  ...
  minRole: "owner", // only Nour
},
{
  id: "integrations",
  ...
  minRole: "owner",
},
```

Filter `NAV_GROUPS` at render time based on `useAuth().user.role`.

### Role-assignment UI

New `client/src/pages/admin/TeamSection.tsx`:
- Lists all users with admin-adjacent roles
- Dropdown to assign/revoke (owner only)
- "Invite" flow: generates a magic link + prefills role
- Shows last login + IP (pulls from compliance log)

### Migration

```sql
ALTER TABLE users
  MODIFY COLUMN role ENUM('user','front_desk','tech','manager','owner')
  NOT NULL DEFAULT 'user';

UPDATE users SET role = 'owner' WHERE role = 'admin';
```

Zero data loss. Drizzle schema + migration file.

---

## 2FA (TOTP)

### Current state

Admin login = Google OAuth only. No second factor. Anyone with access to
the owner's Google account gets full shop admin. Google already has 2FA
upstream, so this isn't critical, but defensibility matters.

### Target state

- Enrollment: `/admin/security/2fa` page
- Generate TOTP secret (`speakeasy` or `otpauth` lib)
- Display QR for Authenticator app scan
- User enters code once to confirm setup
- Store `totp_secret` encrypted (AES-256 with env key) + `totp_enrolled_at`
- Generate 10 backup codes, hashed (bcrypt) in `backup_codes` JSON column

- Login flow (after Google OAuth succeeds):
  - If user has TOTP enrolled → redirect to `/admin/verify` instead of `/admin`
  - `/admin/verify` accepts 6-digit code or backup code
  - On success, set a second cookie `admin_2fa_verified` that lasts 12h
  - All adminProcedure calls require BOTH session cookie + 2fa cookie

- Recovery: backup codes one-time-use, regenerable by owner

### Schema additions

```ts
totpSecret: varchar("totpSecret", { length: 64 }),  // encrypted
totpEnrolledAt: timestamp("totpEnrolledAt"),
backupCodes: json("backupCodes"),  // Array<{hash, usedAt?}>
```

### Dependencies

```
pnpm add otpauth qrcode
```

~12 KB combined. Trivial.

### Implementation phases

1. **Phase 1 — enrollment only**: page that lets owner set up TOTP,
   doesn't enforce at login yet. Let owner confirm it works. 2h work.
2. **Phase 2 — enforcement**: login-flow redirect for users with TOTP
   enrolled. Backup code entry path. 4h work.
3. **Phase 3 — team rollout**: once multi-admin roles are live,
   require 2FA for anyone with manager+ role. Owner-configurable
   threshold. 2h work.

Total: ~1 focused day.

### Risks

- Locking owner out if TOTP app is lost and backup codes unavailable.
  Mitigation: `DISABLE_2FA_VIA_ENV=1` env-variable emergency bypass.
  Railway has an audit log of env changes — if this flag flips, the
  action is traceable.
- Browser clock skew — TOTP allows ±1 window (30s default) by default;
  that's fine.
- Redirect loops during the flow — test thoroughly in staging.

### Decision

Ship **roles first** (2 focused sessions), then 2FA (1 focused day).
Both are pure additive work — no behavior change for existing owner-only
deployment.

---

## Why this is a separate doc, not code right now

Two reasons:
1. **Staging gap.** We don't have a staging environment for nickstire.
   Changing the auth flow without one is how you lock yourself out of
   production. The risk/reward is wrong.
2. **Current threat model is small.** Nour is the only admin, on a
   personal MacBook + phone, both of which have OS-level auth. The
   2-admin-minimum case is the one where role gating + 2FA start mattering.

Ship when: second admin joins, OR threat model changes (e.g. a breach
somewhere adjacent), OR a staging environment exists.
