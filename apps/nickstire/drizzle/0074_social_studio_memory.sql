-- Social Studio Memory — Stored briefs/drafts and testimonials database tables.
-- Backs the Carousel Studio and Faceless Reel Studio memory/grounding.

CREATE TABLE IF NOT EXISTS social_drafts (
  id VARCHAR(64) PRIMARY KEY,
  contentType VARCHAR(16) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  briefJson TEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_social_drafts_type (contentType),
  INDEX idx_social_drafts_created (createdAt)
);

CREATE TABLE IF NOT EXISTS customer_testimonials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  author VARCHAR(100) NULL,
  text TEXT NOT NULL,
  rating INT NOT NULL DEFAULT 5,
  source VARCHAR(50) NOT NULL DEFAULT 'manual',
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_testimonials_rating (rating)
);
