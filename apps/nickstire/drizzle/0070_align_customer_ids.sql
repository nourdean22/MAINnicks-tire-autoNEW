-- Customer ID alignment migration
-- Requires preflight checks before production execution.
-- Converts legacy walk-in/empty customer_id values to NULL for nullable tables.
-- Does not add foreign key constraints.

UPDATE work_orders SET customer_id = NULL WHERE customer_id IS NOT NULL AND LOWER(customer_id) = 'walk-in';
UPDATE work_orders SET customer_id = NULL WHERE customer_id = '';

UPDATE warranties SET customer_id = NULL WHERE customer_id IS NOT NULL AND LOWER(customer_id) = 'walk-in';
UPDATE warranties SET customer_id = NULL WHERE customer_id = '';

UPDATE push_subscriptions SET customer_id = NULL WHERE customer_id IS NOT NULL AND LOWER(customer_id) = 'walk-in';
UPDATE push_subscriptions SET customer_id = NULL WHERE customer_id = '';

UPDATE comebacks SET customer_id = NULL WHERE customer_id IS NOT NULL AND LOWER(customer_id) = 'walk-in';
UPDATE comebacks SET customer_id = NULL WHERE customer_id = '';

UPDATE customer_status_messages SET customer_id = NULL WHERE customer_id IS NOT NULL AND LOWER(customer_id) = 'walk-in';
UPDATE customer_status_messages SET customer_id = NULL WHERE customer_id = '';

ALTER TABLE vehicles MODIFY customer_id int(11) NOT NULL;
ALTER TABLE work_orders MODIFY customer_id int(11) NULL;
ALTER TABLE warranties MODIFY customer_id int(11) NULL;
ALTER TABLE push_subscriptions MODIFY customer_id int(11) NULL;
ALTER TABLE comebacks MODIFY customer_id int(11) NULL;
ALTER TABLE customer_status_messages MODIFY customer_id int(11) NULL;
ALTER TABLE service_affinity_predictions MODIFY customer_id int(11) NOT NULL;
