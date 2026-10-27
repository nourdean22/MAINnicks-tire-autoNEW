# Shop OS 09: who gets in, and keeping customer data safe

Job 2026-10-26-shop-os. Nour, 2026-10-26: "giving the nickstire.org/admin access" then "i dont want it in the admin i
want it nickstire.org/system". Ruling: the crew works in /system; /admin stays Nour's owner console. Both use the same
login and the same role system.

## 1. What exists today (FACT, code and production read 2026-10-26)

- Login is Google sign-in (`server/_core/oauth.ts`, `sdk.ts`); a dev-only sign-in exists for local use.
- Six roles with server-side permissions already defined (`shared/adminPermissions.ts`): owner, manager, front_desk,
  tech, accountant, viewer. `workorders.manage` is held by owner, manager, front_desk and tech; money by owner,
  manager (and money.view by accountant). Every admin API call is checked on the server, not just hidden in the UI.
- Roles are granted per person with optional expiry (`user_roles` table) by an owner (`adminSecurity.setRole`,
  `security.manage`). An audit log table exists (`audit_log`, `adminSecurity.recordAction`).
- Production right now: only owner-level logins exist and `user_roles` is empty. So no crew member has an account yet,
  and nobody is on a narrower role.

## 2. Plan for the crew

| Person | Role | Sees in /system | Does not see |
|---|---|---|---|
| Nour | owner | everything, plus /admin | |
| Mash, Manny (counter) | front_desk (or manager if Nour wants them on money) | counter, quotes, board, customers, parts ordering | money reports, settings, cameras, exports |
| Zach (tech) | tech | assigned cars, findings, photos, clocks | prices beyond his jobs, customer list, money |
| Bookkeeper, if any | accountant | invoices, reports | customer messaging |

Steps (Nour's part is account creation; agents never create accounts or type passwords):
1. Each person signs in with their OWN Google account (no shared counter login).
2. Nour grants the role in Settings (the existing role control).
3. Google 2-step verification on for every one of those accounts (that is the shop's MFA).
4. The counter PC locks when idle; each person signs back in as themselves.

## 3. The security baseline (research R12, thread eb41af3e; CLAIM until counsel confirms)

Why it matters: the shop sends customers to 8 lease/finance programs. Under the FTC Safeguards Rule (16 CFR 314) a
business that regularly arranges or refers consumer financing can count as a "financial institution". Whether the shop
is covered is a lawyer's call (give them the merchant agreements and how staff use the links). The safe move is to
build the baseline anyway; most of it is good practice and supports Ohio's safe-harbor defense (ORC 1354).

Built into /system from day one:
- Individual accounts, least privilege by role, enforced on the server (exists).
- MFA through Google 2-step on every staff account.
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
