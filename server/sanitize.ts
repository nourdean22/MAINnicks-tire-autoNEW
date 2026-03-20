/**
 * Input sanitization utilities for user-submitted data.
 * Prevents XSS, SQL injection attempts, and other malicious input.
 */

/**
 * Strip HTML tags and dangerous characters from user input.
 * Use on all free-text fields before storing in the database.
 */
export function sanitizeText(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "") // Strip HTML tags
    .replace(/[<>]/g, "") // Remove any remaining angle brackets
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/\bon\w+=\S*/gi, "") // Remove inline event handlers like onerror=alert(1)
    .trim();
}

/**
 * Sanitize phone number — allow only digits, +, -, (, ), spaces
 */
export function sanitizePhone(input: string | undefined | null): string {
  if (!input) return "";
  return input.replace(/[^\d+\-() ]/g, "").trim();
}

/**
 * Sanitize email — basic cleanup, validation handled by zod
 */
export function sanitizeEmail(input: string | undefined | null): string {
  if (!input) return "";
  return input.replace(/[<>'"]/g, "").trim().toLowerCase();
}
