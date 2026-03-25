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
    .replace(/data:\s*text\/html/gi, "") // Remove data URI HTML
    .replace(/\0/g, "") // Remove null bytes
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

/**
 * Sanitize a name — allow letters, spaces, hyphens, apostrophes, periods.
 */
export function sanitizeName(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-zA-Z\s'\-\.]/g, "")
    .trim()
    .slice(0, 100); // Max 100 chars for a name
}

/**
 * Sanitize a general message field (descriptions, notes).
 * More permissive than sanitizeName but still strips HTML/scripts.
 */
export function sanitizeMessage(input: string | undefined | null): string {
  if (!input) return "";
  return sanitizeText(input).slice(0, 5000); // Max 5000 chars for messages
}

/**
 * Sanitize all string fields in an object.
 * Useful for bulk-sanitizing form data.
 */
export function sanitizeFormData<T extends Record<string, unknown>>(data: T): T {
  const sanitized = { ...data };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string") {
      if (key.toLowerCase().includes("phone")) {
        (sanitized as any)[key] = sanitizePhone(value);
      } else if (key.toLowerCase().includes("email")) {
        (sanitized as any)[key] = sanitizeEmail(value);
      } else if (key.toLowerCase().includes("name") && !key.toLowerCase().includes("service")) {
        (sanitized as any)[key] = sanitizeName(value);
      } else {
        (sanitized as any)[key] = sanitizeMessage(value);
      }
    }
  }
  return sanitized;
}
