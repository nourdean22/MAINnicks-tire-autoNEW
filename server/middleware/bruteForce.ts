/**
 * Brute Force Protection — Rate limits OTP attempts per phone
 * - 5 failed attempts in 15 min → block for 1 hour
 * - 3 OTP requests in 10 min → rate limit
 */

const attempts = new Map<string, { count: number; lastAttempt: number; blockedUntil?: number }>();
const otpRequests = new Map<string, { count: number; firstRequest: number }>();

export function checkBruteForce(phone: string): { allowed: boolean; retryAfter?: number } {
  const key = phone.replace(/\D/g, "").slice(-10);
  const now = Date.now();
  const record = attempts.get(key);

  if (record?.blockedUntil && now < record.blockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
  }

  if (record && record.count >= 5 && now - record.lastAttempt < 900_000) {
    record.blockedUntil = now + 3_600_000;
    return { allowed: false, retryAfter: 3600 };
  }

  return { allowed: true };
}

export function checkOtpRateLimit(phone: string): { allowed: boolean; retryAfter?: number } {
  const key = phone.replace(/\D/g, "").slice(-10);
  const now = Date.now();
  const record = otpRequests.get(key);

  if (record && record.count >= 3 && now - record.firstRequest < 600_000) {
    return { allowed: false, retryAfter: Math.ceil((record.firstRequest + 600_000 - now) / 1000) };
  }

  // Reset window if expired
  if (record && now - record.firstRequest >= 600_000) {
    otpRequests.set(key, { count: 1, firstRequest: now });
  } else if (record) {
    record.count++;
  } else {
    otpRequests.set(key, { count: 1, firstRequest: now });
  }

  return { allowed: true };
}

export function recordFailedAttempt(phone: string): void {
  const key = phone.replace(/\D/g, "").slice(-10);
  const record = attempts.get(key) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  attempts.set(key, record);
}

export function clearAttempts(phone: string): void {
  const key = phone.replace(/\D/g, "").slice(-10);
  attempts.delete(key);
  otpRequests.delete(key);
}
