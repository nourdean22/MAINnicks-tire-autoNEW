-- Phase 3: Performance indexes for frequently-queried columns
-- These indexes dramatically speed up the most common queries:
-- booking list, lead list, customer lookup, analytics, and SMS conversations.

-- Bookings: admin dashboard sorts by date, filters by status
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(createdAt);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);
CREATE INDEX IF NOT EXISTS idx_bookings_stage ON bookings(stage);
CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(referenceCode);

-- Leads: sorted by date, filtered by source/urgency
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(createdAt);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_urgency ON leads(urgencyScore);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

-- Customers: lookup by phone (the primary identifier)
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit ON customers(lastVisitDate);

-- Service history: lookup by userId, customerId
CREATE INDEX IF NOT EXISTS idx_service_history_user ON service_history(userId);
CREATE INDEX IF NOT EXISTS idx_service_history_date ON service_history(serviceDate);

-- Analytics snapshots: queried by date range
CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_snapshots(date);

-- SMS conversations: lookup by phone
CREATE INDEX IF NOT EXISTS idx_sms_conv_phone ON sms_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_sms_conv_updated ON sms_conversations(updatedAt);

-- SMS messages: lookup by conversation
CREATE INDEX IF NOT EXISTS idx_sms_msg_conv ON sms_messages(conversationId);

-- Review requests: queue processing queries by status + scheduledAt
CREATE INDEX IF NOT EXISTS idx_review_req_status ON review_requests(status);
CREATE INDEX IF NOT EXISTS idx_review_req_scheduled ON review_requests(scheduledAt);

-- Service reminders: queue processing
CREATE INDEX IF NOT EXISTS idx_reminders_status ON service_reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_next_due ON service_reminders(nextDueDate);

-- Coupons: active coupon lookup
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(isActive);

-- Dynamic articles: published articles for blog/sitemap
CREATE INDEX IF NOT EXISTS idx_articles_status ON dynamic_articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON dynamic_articles(slug);
