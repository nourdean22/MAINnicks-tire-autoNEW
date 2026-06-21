/**
 * Content-Security-Policy builder + per-request nonce.
 *
 * audit-2026-06-21 hardening. Production tightens `script-src` to a
 * per-request nonce + 'strict-dynamic' so an XSS / injection bug cannot
 * execute inline or eval'd script. Dev keeps 'unsafe-inline'/'unsafe-eval'
 * because Next's Turbopack HMR + React Refresh inject eval'd inline scripts
 * that a strict policy would break.
 *
 * The nonce flows two ways out of middleware.ts:
 *   1. onto the REQUEST headers (Content-Security-Policy + x-nonce) so the
 *      Next renderer stamps the SAME nonce on its framework <script> tags —
 *      without this, 'strict-dynamic' blocks hydration and the app is blank;
 *   2. onto the RESPONSE Content-Security-Policy header the browser enforces.
 *
 * Edge-runtime safe: Web Crypto + btoa only (no Node Buffer).
 *
 * NOTE: CSP lives ONLY here (via middleware), never in next.config headers().
 * Two CSP headers would make the browser enforce their intersection, which
 * silently breaks the nonce model.
 */

/** Per-request nonce. base64 keeps it inside the CSP nonce grammar. */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Build the CSP header value. `isDev` relaxes script-src for the dev server;
 * prod is nonce + strict-dynamic with no unsafe-inline / unsafe-eval.
 *
 * connect-src mirrors the prior next.config policy verbatim (OpenAI /
 * Anthropic / VAPI / Ollama Cloud + local) so the AI fallback chain
 * and the VAPI live-call surface keep working.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    scriptSrc,
    // Styles stay 'unsafe-inline' — Tailwind / styled-jsx inject <style>, and
    // style injection is not a script-execution vector.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.openai.com https://*.anthropic.com https://api.vapi.ai https://ollama.com https://*.ollama.com http://localhost:11434 wss:",
    // object-src 'none' (audit-2026-06-21) — block <object>/<embed>/<applet>
    // plugin execution outright; nothing in the app uses them.
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
