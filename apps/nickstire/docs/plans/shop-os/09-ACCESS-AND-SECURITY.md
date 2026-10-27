# Shop OS 09: who gets in, and keeping customer data safe

Job 2026-10-26-shop-os. Nour, 2026-10-26: "giving the nickstire.org/admin access" then "i dont want it in the admin i
want it nickstire.org/system". Ruling: the crew works in /system; /admin stays Nour's owner console. Both use the same
login and the same role system.

## 1. What exists today (FACT, code and production read 2026-10-26)

- Login is Google sign-in (`server/_core/oauth.ts`, `sdk.ts`); a dev-only sign-in exists for local use.
- Six roles with server-side permissions already defined (`shared/adminPermissions.ts`): owner, manager, front_desk,
  tech, accountant, viewer. `workorders.manage` is held by owner, manager, front_desk and tech; money by owner,
  manager (and money.view by accountant). Every admin API call is checked on the server, not just hidden in the UI.
- A new Google sign-in is stored as `users.role = 'user'`; only the owner's openId is promoted to `admin`
  (`server/db.ts`), and every admin procedure requires `role = 'admin'` (`server/_core/trpc.ts`).
- `adminSecurity.setRole` (`security.manage`) only updates `adminRole` on a user who is ALREADY `admin`
  (`server/services/adminSecurity.ts:152`). It does not promote a new login, does not write `user_roles` or an expiry,
  and no screen calls it. So today a crew login cannot be onboarded from the app at all.
- Two role gaps for the crew plan below: `front_desk` holds no `money.view` or `money.manage`, so it cannot open or
  close invoices or record payments; `tech` holds only `admin.view` and `workorders.manage`, and clock in/out
  (`dispatch.*`) maps to `bookings.manage`, which tech lacks.
- The app's own MFA gate exists (`isAdminMfaRequired()`, `server/_core/trpc.ts`) but is OFF by default since #772.
  An audit log table exists (`audit_log`, `adminSecurity.recordAction`).
- Production right now: only owner-level logins exist and `user_roles` is empty. So no crew member has an account yet,
  and nobody is on a narrower role.

## 2. Plan for the crew

| Person | Role | Sees in /system | Does not see |
|---|---|---|---|
| Nour | owner | everything, plus /admin | |
| Mash, Manny (counter) | front_desk + the new checkout permission (P0 task 2), or manager if Nour wants them on all money | counter, quotes, board, customers, parts ordering, close ticket and record payment | money reports, settings, cameras, exports |
| Zach (tech) | tech (clock in/out needs P0 task 3) | assigned cars, findings, photos, clocks | prices beyond his jobs, customer list, money |
| Bookkeeper, if any | accountant | invoices, reports | customer messaging |

Steps (Nour's part is account creation; agents never create accounts or type passwords):
1. Each person signs in with their OWN Google account (no shared counter login).
2. Nour approves them in the staff provisioning control (P0 task 1). Until that ships, the only path is a one-row
   production write per person, which is a protected operation: Nour's explicit go each time.
3. MFA through the app's own gate turned on for every staff role (P0 task 4). Google 2-step cannot be relied on: the
   app asks Google only for `openid email profile` and never learns whether 2-step is on. The alternative is shop Google
   Workspace accounts with 2-step enforced in the Workspace admin console.
4. The counter PC locks when idle; each person signs back in as themselves.

P0 build tasks this plan depends on (before the first crew login):
1. Owner-only staff provisioning: one audited action that promotes a signed-in user to staff (`role = 'admin'`), sets
   `adminRole`, and records an optional expiry; plus revoke. `setRole` alone cannot do this.
2. A narrow checkout permission (close ticket, record payment; no money reports or refunds) given to the counter, or
   Nour's call to make the counter `manager`.
3. Tech self-clock: map `dispatch.clockIn` / `dispatch.clockOut` to `workorders.manage` (or wrap them as
   `system.clockIn` / `system.clockOut`), limited to the caller's own tech record.
4. The MFA gate required for every staff role on /system, with the setup flow tested on a phone first.

## 3. The security baseline (research R12, thread eb41af3e; CLAIM until counsel confirms)

Why it matters: the shop sends customers to 8 lease/finance programs. Under the FTC Safeguards Rule (16 CFR 314) a
business that regularly arranges or refers consumer financing can count as a "financial institution". Whether the shop
is covered is a lawyer's call (give them the merchant agreements and how staff use the links). The safe move is to
build the baseline anyway; most of it is good practice and supports Ohio's safe-harbor defense (ORC 1354).

Built into /system from day one:
- Individual accounts, least privilege by role, enforced on the server (exists; staff onboarding is P0 task 1).
- MFA on every staff account through the app's MFA gate (or Workspace-enforced 2-step), never assumed from Google.
- No customer or ticket data copied to outside stores: the existing work-order Google Sheet sync
  (`workOrderService.ts:171`, on when `GOOGLE_SHEETS_CRM_ID` is set) is off for /system work orders.
- Audit log of sign-ins, role changes, record edits, exports, refunds, payment-status changes, financing actions:
  who, when, what, which record; logs not editable by staff.
- No card numbers, SSNs, driver's-license images or full finance applications stored: providers keep those; we keep
  only a reference and a status.
- Customer-facing links (approval, invoice) use unguessable tokens; changing a number in the link never shows another
  customer.
- Encryption in transit (HTTPS) and at rest (TiDB, backups); keys and API secrets only in Railway variables.
- Backups with a real restore test; retention schedule (tax records 4 years per ORC 5739.11; dispose of financing data
  when no longer needed).
- Texts: consent recorded per purpose; promotional texts need separate written opt-in; STOP honored at once; automated
  texts on a registered route (UPSTREAMS 2026-09-23).
- A one-page incident plan: who to call, FTC notice within 30 days if 500+ consumers' covered data is taken, Ohio
  resident notice within 45 days when the statute's data types are involved (ORC 1349.19).

## 4. Owed decisions
1. Nour: which role each crew member gets (table above is the proposal).
2. Nour: ask the shop's lawyer or accountant whether the financing referrals make the shop an FTC "financial
   institution" (hand them section 3).
3. Nour: should the counter close tickets and take payments? Recommendation: yes, through the narrow checkout
   permission (P0 task 2), not full `manager`.
