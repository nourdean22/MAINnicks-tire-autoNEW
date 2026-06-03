# Session Changelog — 2026-06-03

Nick's Tire admin overhaul + live customer dedup + code-underneath fixes. Operator-facing record of what shipped to production. Code/file detail lives in the linked audit docs in this directory.

## 🔐 Security
- **Closed a customer-data leak (IDOR)** in the public job tracker — anyone with an order number could pull a walk-in customer's status / vehicle / service list **without** proving their phone. Now fails closed (a phone match is required on every path). `3ac1f22f`, `5cd1151d` (+ regression test).

## 👤 Customer data (LIVE on prod)
- **Deduped the customer database** — merged **21 duplicate people** (same name + same vehicle, different phones, with double-counted spend). **1,964 → 1,943** customers; "Total Customers" / VIP / spend tiers are no longer inflated. Fully reversible (timestamped backups kept). `ff71a08b`
- **Dupe-proofed going forward** — a new customer from chat/booking now merges into the existing record instead of spawning a twin. `eae7ad60`
- **Linked 18 orphaned invoices** back to their customers (restores those customers' lifetime value). The remaining ~299 unlinked are anonymous walk-ins / estimates with no real customer — correctly left alone.
- Phones standardized to 10-digit; customer metrics recomputed so the deduped numbers are authoritative.

## 🤖 Automation / crons
- **Two "dead" voice features now actually work** — the confirmation-call bot and the voice-recovery closer were registered but **never scheduled** (a wiring bug), so turning their feature flags on did nothing. Now they fire on the daily tier when enabled. `5cd1151d`
- **Win-back texts fixed** — were shipping literal `{lastService}` / `{vehicleInfo}` placeholders to customers; now personalized or reworded so no broken text goes out. `12953214`
- **Overnight leads** now get the speed-to-lead text (they were aging out of the window before the morning run). `12953214`
- **Retention funnel** re-opens for returning customers (a returning 1-year-lapsed customer was permanently locked out of every tier). `12953214`
- **Work orders** no longer auto-mark "invoiced" without a real billing signal (was closing WOs with zero billing recorded). `12953214`

## 💰 Money / revenue
- Revenue figures reconciled — the top KPI and the deep-intel "Total Revenue" now use the same window; "Monthly Pace" shows true month-to-date. `d4e0f259`, `7cdf96e6`
- WalkIn oil presets re-anchored to the advertised **$49 / $80** (were quoting ~$82 / $127). `d4e0f259`
- SMS Performance double-count fixed — every send was logged twice, inflating all rates ~2×. `c6ffa03c`
- Customer spend/visit counts compute correctly now (hardened the phone match that was under-counting). `12953214`

## 📱 Outreach / compliance
- **TCPA "Reply STOP to opt out"** added to retention / oil-reminder bulk texts that lacked it. `d4e0f259`
- Retired the misleading "you got tires from us" win-back segment (no tire signal behind it). `7cdf96e6`

## 🎨 Admin UI surface (9 waves)
- All **31 admin pages** audited and cleaned: uniform square cards, consistent money/date formatting, honest empty-states + labels (no more false "0 indexed" / "0%/1%" / fake-green statuses), the Next-Service prediction column un-broken, ~40 defect fixes, and dead-page / dead-code removal (incl. the broken NOUR-OS Bridge page). Commits `e9e61cd5` → `715523b5`.

## ⚙️ Infra
- Fixed the recurring `statenour-live-sync` cron **404** — repointed a stale env URL on Railway (`STATENOUR_SYNC_URL`).

## 🟡 Open — needs an operator decision (not shipped)
1. `work_orders.customer_id` is a string space that can't join `customers.id` (int) — reconciliation joins miss; a schema refactor.
2. `customers.segment` has 3 writers on 3 schedules — pick the single owner.
3. "Total revenue" is paid-only on 3 surfaces vs all-invoices on 4 — pick the canonical definition.
4. GBP content generator fabricates names/prices to Google — held pending your go.

---
*Full technical detail:* `SESSION-CHECKPOINT.md` (anchored resume record) · `customer-dedup-plan.md` (§ EXECUTION OUTCOME + rollback) · `code-underneath-audit-{data,logic}.md` · the surface audit set (`money.md`, `outreach.md`, `leads-customers.md`, `ops-system.md`, `voice-content-uniformity.md`).
