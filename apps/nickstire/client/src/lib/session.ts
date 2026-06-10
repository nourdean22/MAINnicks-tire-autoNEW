/**
 * session — canonical browser visitor-id (journey-join wave 2026-06).
 *
 * HONESTY NOTE: the id lives in localStorage (`nick_session_id`, the same
 * key trackEvent/customer_events has used since the visual-engagement wave)
 * so it is really a per-DEVICE/VISITOR id that persists across visits, not
 * a single browsing session. Joins on it are exact-key and truthful — but
 * docs/UI must call it visitor-scoped, never "this one visit".
 *
 * Single source of truth: SEO.tsx trackEvent, utm.getUtmData(), and
 * trackPhoneClick all read THIS function so every captured surface
 * (customer_events, call_events, leads, bookings, callbacks, tire_orders)
 * carries the same key.
 */

let _cached: string | null = null;

export function getSessionId(): string | null {
  if (_cached) return _cached;
  try {
    let id = window.localStorage.getItem("nick_session_id");
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      window.localStorage.setItem("nick_session_id", id);
    }
    _cached = id;
    return id;
  } catch {
    /* localStorage unavailable (private mode etc.) — null, never fabricated */
    return null;
  }
}
