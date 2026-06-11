-- Update 'walk-in' strings to NULL first to prevent casting errors
UPDATE work_orders SET customer_id = NULL WHERE customer_id = 'walk-in';

-- Convert column types to int
ALTER TABLE vehicles MODIFY customer_id int(11) NOT NULL;
ALTER TABLE work_orders MODIFY customer_id int(11) NULL;
ALTER TABLE warranties MODIFY customer_id int(11) NULL;
ALTER TABLE push_subscriptions MODIFY customer_id int(11) NULL;
ALTER TABLE comebacks MODIFY customer_id int(11) NULL;
ALTER TABLE customer_status_messages MODIFY customer_id int(11) NULL;
ALTER TABLE service_affinity_predictions MODIFY customer_id int(11) NOT NULL;
