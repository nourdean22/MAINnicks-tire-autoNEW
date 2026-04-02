CREATE TABLE IF NOT EXISTS `conversation_memory` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `visitorKey` VARCHAR(255) NOT NULL,
  `category` VARCHAR(50) NOT NULL,
  `content` TEXT NOT NULL,
  `sessionId` INT NULL,
  `confidence` FLOAT NOT NULL DEFAULT 0.8,
  `reinforcements` INT NOT NULL DEFAULT 1,
  `lastAccessed` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_memory_visitor` (`visitorKey`),
  INDEX `idx_memory_category` (`category`)
);
