-- Migration 0070: Align all customerId columns to int
-- Matches customers.id (int autoincrement primary key)
--
-- PREREQUISITE: Run preflight read-only audit first to verify data.
-- This migration is NOT reversible without a backup restore.

-- ═══ Phase 1: Data cleanup (all nullable tables) ═══
-- Null out walk-in sentinels (case-insensitive) in all varchar tables
UPDATE work_orders SET customer_id = NULL WHERE LOWER(customer_id) = 'walk-in';
UPDATE warranties SET customer_id = NULL WHERE LOWER(customer_id) = 'walk-in';
UPDATE comebacks SET customer_id = NULL WHERE LOWER(customer_id) = 'walk-in';
UPDATE customer_status_messages SET customer_id = NULL WHERE LOWER(customer_id) = 'walk-in';
UPDATE push_subscriptions SET customer_id = NULL WHERE LOWER(customer_id) = 'walk-in';

-- Null out empty strings
UPDATE work_orders SET customer_id = NULL WHERE customer_id = '';
UPDATE warranties SET customer_id = NULL WHERE customer_id = '';
UPDATE comebacks SET customer_id = NULL WHERE customer_id = '';
UPDATE customer_status_messages SET customer_id = NULL WHERE customer_id = '';
UPDATE push_subscriptions SET customer_id = NULL WHERE customer_id = '';

-- ═══ Phase 2: Type conversion ═══
-- vehicles: NOT NULL (every vehicle must belong to a customer)
ALTER TABLE vehicles MODIFY customer_id int(11) NOT NULL;
-- work_orders: NULL allowed (walk-in / anonymous)
ALTER TABLE work_orders MODIFY customer_id int(11) NULL;
-- warranties: NULL allowed (walk-in warranty edge case)
ALTER TABLE warranties MODIFY customer_id int(11) NULL;
-- push_subscriptions: NULL allowed (anonymous browser push)
ALTER TABLE push_subscriptions MODIFY customer_id int(11) NULL;
-- comebacks: NULL allowed (walk-in comeback)
ALTER TABLE comebacks MODIFY customer_id int(11) NULL;
-- customer_status_messages: NULL allowed (message without linked customer)
ALTER TABLE customer_status_messages MODIFY customer_id int(11) NULL;
-- service_affinity_predictions: NOT NULL (predictions always linked to customer)
ALTER TABLE service_affinity_predictions MODIFY customer_id int(11) NOT NULL;
