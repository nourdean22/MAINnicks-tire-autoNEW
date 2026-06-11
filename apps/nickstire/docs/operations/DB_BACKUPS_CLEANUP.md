---
clarity-gate-version: 2.1
processed-date: 2026-06-11
processed-by: Antigravity + Nour
clarity-status: CLEAR
hitl-status: REVIEWED
hitl-pending-count: 0
points-passed: 1-9
document-sha256: 9e09f2ec99d6a926cc41ea00dc02c5bf155b3ec561e5db233cefa2722b926119
hitl-claims:
  - id: claim-backup-tables-exist
    text: "The following 10 temporary tables currently exist in the live TiDB database instance."
    value: "10 tables exist"
    source: "Database audit via mysql2 connection"
    location: "DB_BACKUPS_CLEANUP.md#L13"
    round: B
    confirmed-by: Nour
    confirmed-date: 2026-06-11
---

# DB Backup Tables Cleanup Runbook

This guide documents the temporary backup tables created during the database deduplication process on `2026-06-03` in the TiDB instance and outlines the procedure for dropping them after receiving explicit owner approval.

> [!CAUTION]
> **DO NOT drop any backup tables without written approval from the business owner/lead engineer.**
> These tables represent snapshot states before the deduplication run and are essential for restoring data if any historical discrepancies are discovered.

---

## 1. Identified Backup Tables

The following 10 temporary tables currently exist in the live TiDB database instance:

1. `_bak_customers_dedup_20260603`
2. `_bak_invoices_dedup_20260603`
3. `_bak_work_orders_dedup_20260603`
4. `_bak_leads_dedup_20260603`
5. `_bak_bookings_dedup_20260603`
6. `_bak_warranties_dedup_20260603`
7. `_bak_comebacks_dedup_20260603`
8. `_bak_customer_status_messages_dedup_20260603`
9. `_bak_push_subscriptions_dedup_20260603`
10. `_bak_service_affinity_predictions_dedup_20260603`

---

## 2. Retention Policy

- **Minimum Retention Period**: Keep these tables for at least **90 days** from the deduplication date (`2026-06-03`) to ensure no billing or reporting discrepancies arise in Statenour or Nick's Tire dashboards.
- **Verification Gate**: Before dropping, verify that the active database table counts (e.g. `invoices`, `customers`) match the expected deduped stats and that all monthly financial reconciliations for June 2026 are completed and approved.

---

## 3. SQL Cleanup Script

After receiving explicit owner approval, connect to your TiDB database (using the secure `DATABASE_URL` link) and execute the following SQL commands:

```sql
-- Disable foreign key checks temporarily to avoid dependency blockers
SET FOREIGN_KEY_CHECKS = 0;

-- Drop deduplication backup tables
DROP TABLE IF EXISTS `_bak_customers_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_invoices_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_work_orders_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_leads_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_bookings_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_warranties_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_comebacks_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_customer_status_messages_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_push_subscriptions_dedup_20260603`;
DROP TABLE IF EXISTS `_bak_service_affinity_predictions_dedup_20260603`;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
```

Verify that all tables were dropped successfully by running:
```sql
SHOW TABLES LIKE '_bak_%_20260603';
```
*(This query should return 0 rows.)*

---

## HITL Verification Record

### Round A: Derived Data Confirmation

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|-------|--------|-------------|------|
| 1 | The following 10 temporary tables currently exist in the live TiDB database instance | ✓ Confirmed | Nour | 2026-06-11 |

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | REVIEWED
