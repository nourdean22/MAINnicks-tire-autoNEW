-- Scheduled Instagram/Facebook posts (publish-later queue).
-- Hand-applied (no auto-migrate). Backs the scheduled-posts cron + the
-- Direct Publisher "Schedule" option. Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  platforms JSON NOT NULL,
  caption TEXT NOT NULL,
  imageUrl VARCHAR(1000) NULL,
  videoUrl VARCHAR(1000) NULL,
  imageUrls JSON NULL,
  scheduledAt TIMESTAMP NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  postedAt TIMESTAMP NULL,
  igPostId VARCHAR(64) NULL,
  error VARCHAR(500) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scheduled_due (status, scheduledAt)
);
