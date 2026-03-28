CREATE TABLE IF NOT EXISTS `daily_execution` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `date` DATE NOT NULL,
  `mission` TEXT,
  `notes` TEXT,
  `status` ENUM('on_track', 'drifting', 'off_track') NOT NULL DEFAULT 'on_track',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_daily_date` (`date`)
);

CREATE TABLE IF NOT EXISTS `daily_habits` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `date` DATE NOT NULL,
  `habit_key` VARCHAR(50) NOT NULL,
  `completed` TINYINT(1) NOT NULL DEFAULT 0,
  `completed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_habit_date_key` (`date`, `habit_key`)
);
