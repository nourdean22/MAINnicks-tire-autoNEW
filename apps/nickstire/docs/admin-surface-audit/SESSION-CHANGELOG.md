# Session Changelog — 2026-06-03

Nick's Tire admin overhaul + live customer dedup + code-underneath fixes + the 3 architecture decisions + the SMS voice rewrite. Operator-facing record of what shipped to production. Code/file detail lives in the linked audit docs in this directory.

## 🔐 Security
- **Closed a customer-data leak (IDOR)** in the public job tracker — anyone with an order number could pull a walk-in customer's status / vehicle / service list **without** proving their phone. Now fails closed (a phone match is required on every path). `3ac1f22f`, `5cd1151d` (+ regression test).

## 👤 Customer data (LIVE on prod)
- **Deduped the customer database** — merged **21 duplicate people** (same name + same vehicle, different phones, with double-counted spend). **1,964 → 1,943** customers; "Total Customers" / VIP / spend tiers are no longer inflated. Fully reversible (timestamped backups kept). `ff71a08b`
- **Dupe-proofed going forward** — a new customer from chat/booking now merges into the existing record instead of spawning a twin. `eae7ad60`
- **Linked 18 orphaned invoices** back to their customers (restores those customers' lifetime value). The remaining ~299 unlinked are anonymous walk-ins / estimates with no real customer — correctly left alone.
- **Redirected dead `customerMetrics.totalRevenue` reads** — Fixed the bug where `customerMetrics.totalRevenue` was always 0 in the database (never written by the refreshers) by redirecting reads in both `customersRouter.vipLookup` and `customerPsychoProfile` service to `customers.totalSpent` (the live spent value in cents).
- Phones standardized to 10-digit; customer metrics recomputed so the deduped numbers are authoritative.

## 🏗️ Architecture decisions 1–3 (wave-182, `96ba44d9` — all pure-code, reversible, no schema migration, no prod data-write)
1. **Work-order ↔ customer joins no longer miss.** `work_orders.customer_id` is polymorphic (a numeric customer id **or** a raw phone string for AI-chat/walk-in jobs **or** the "WALK-IN" sentinel). The reconciliation joins matched only the numeric form, so every phone-keyed job was silently dropped from a customer's backlog and visit history. Both joins now resolve each job to its customer by numeric-id **or** last-10-digit phone. *(Chose this over adding a new indexed column + a production backfill — unnecessary at 1,943 customers and it would add drift risk.)* Bonus: revived a visit-date sync query that had been **throwing every run** (wrong column names) so visit dates were never syncing from work orders; and killed a "comeback" miscount where every anonymous walk-in was treated as the same returning customer.
2. **`customers.segment` now has one owner.** It was being rewritten by a redundant job registered **three times** (firing 10+×/day, sometimes on stale data) *and* by the main enrichment pipeline. The pipeline is now the single authoritative writer (with full coverage); the redundant job is a no-op (reversible).
3. **"Total revenue" means one thing everywhere = PAID/collected.** Six surfaces already used paid-only (the headline KPIs); three diverged to all-invoices and were inflated by unpaid/pending/refunded. Standardized the Customers analytics panel (5 queries) **and** the feed into Nick's intelligence (3 queries) to collected revenue.

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

## 📲 SMS voice rewrite (wave-182, `4238dbc0` + `55dd7bad`)
- **Every customer text rewritten (~80 messages)** to a tighter voice — business/purpose-first, concrete, low-pressure, quietly persuasive. **No name or personal details** in any message (your call), no planted negatives ("no pressure" / "problems get worse" / "if anything's wrong"), nothing salesy or obvious — all inside your existing brand-voice rules.
- **Honesty fixes:** removed the **Uber/Lyft ride** promise (claimed 8× — not a real program), dropped a fake "referral code" (it was just the phone's last 4 digits), killed every "same-day" promise and "this is Nick personally" line, and stopped quoting repair prices the system shouldn't (only the $60 tire / $49 oil / $80 synthetic anchors stay). Kept only what you confirmed real: $25 referral, 10% VIP/win-back, 4.9★/1,700+, $10-down financing.
- **Compliance:** "Reply STOP" now on **every** win-back and drip text (was missing on all 20 win-back + every drip — a TCPA gap).
- **Wrong-price-proofed the AI texter** — the model that drafts SMS replies now knows the only 3 prices it may quote, so it can't invent a number.
- **Consistency:** one business name everywhere ("Nick's Tire & Auto"), fixed a stale used-tire price ($40→$60), replaced the "Trusted Shop" tagline (a word your brand voice bans).
- **Reliability:** phone-keyed walk-in jobs (booked by the AI chat) were **silently getting no texts** — no drop-off, pickup, or review messages, and the drop-off flow actually errored out for them. Fixed with a shared customer-resolver (numeric-id → phone fallback). *(The audit's "double-send" turned out not to be a real auto-bug — that path is a manual admin button, not a cron.)*

## 🎨 Admin UI surface (9 waves)
- All **31 admin pages** audited and cleaned: uniform square cards, consistent money/date formatting, honest empty-states + labels (no more false "0 indexed" / "0%/1%" / fake-green statuses), the Next-Service prediction column un-broken, ~40 defect fixes, and dead-page / dead-code removal (incl. the broken NOUR-OS Bridge page). Commits `e9e61cd5` → `715523b5`.

## ⚙️ Infra
- Fixed the recurring `statenour-live-sync` cron **404** — repointed a stale env URL on Railway (`STATENOUR_SYNC_URL`).

## 📞 VAPI phone receptionist — slimmed down + deployed live (`0c4fa0fe`)
- **Tightened the receptionist's brain front-to-back** — the AI's instructions went from ~40,000 to ~17,300 characters (**56% leaner**) with **no change to what it does**. It had bloated over time with old audit notes, repeated rules, and long example scripts; all of that is gone, every actual behavior stays (tire-first, the 3 real prices only, the free-check/written-quote pitch, transfer-on-first-ask, the tow play, after-hours handling, etc.).
- **Deployed live to the phone line** — pushed to the VAPI assistant; your forward/transfer number was preserved, all 10 tools intact, same Brian voice + greeting. The leaner prompt is answering calls now.
- **Quick check when you can:** dial the shop and try a used-tire question, a "how much for brakes?" (should give the free-check close, *no* price), and a "let me talk to a person" (should transfer after taking your number). One-line revert if anything's off. Full before/after behavior map: `vapi-receptionist-simplification.md`.

## 🟡 Still open
- **GBP content generator** fabricates names/prices to Google — **held** pending your go (say "unhold GBP").
- **Optional polish:** a couple of VAPI voicemail micro-tweaks (recovery voicemail could add the "we honor the quote" line; confirmation voicemail the address) — deploy-gated (needs a VAPI re-push to take effect).

---
*Full technical detail:* `SESSION-CHECKPOINT.md` (anchored resume record) · `customer-dedup-plan.md` (§ EXECUTION OUTCOME + rollback) · `code-underneath-audit-{data,logic}.md` · the surface audit set (`money.md`, `outreach.md`, `leads-customers.md`, `ops-system.md`, `voice-content-uniformity.md`).
