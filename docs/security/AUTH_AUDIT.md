# Auth Boundary Audit — Nick's Tire & Auto
Generated: 2026-03-29

## Summary: NO CRITICAL ISSUES FOUND

All admin procedures correctly enforce server-side role checks. No admin routes use publicProcedure. Client-side routing cannot bypass server enforcement.

---

## tRPC Auth Middleware — Verified ✓

### adminProcedure
```typescript
if (!ctx.user || ctx.user.role !== 'admin') {
  throw new TRPCError({ code: "FORBIDDEN" });
}
```
- ✅ Server-side check — cannot be bypassed by client
- ✅ Checks both user existence AND role
- ✅ Returns FORBIDDEN (403), not UNAUTHORIZED (401) — correct semantics

### protectedProcedure
```typescript
if (!ctx.user) {
  throw new TRPCError({ code: "UNAUTHORIZED" });
}
```
- ✅ Server-side check on every call
- ✅ Applied to customer portal routes

### publicProcedure uses in sensitive-looking files
| Router | Procedure | Justification |
|--------|-----------|---------------|
| `admin.ts` → `callTrackingRouter.logCall` | publicProcedure | Phone click tracking — no sensitive data written, customer-facing |
| `advanced.ts` → `portalRouter.requestCode` | publicProcedure | Customer auth flow — must be public for unauthenticated customers |
| `advanced.ts` → `portalRouter.verifyCode` | publicProcedure | Customer auth flow — must be public |
| `advanced.ts` → `portalRouter.myData` | publicProcedure | Token-gated customer data — session token validated in handler |

**All verified legitimate.**

---

## Session Cookie — Verified ✓

| Property | Value | Status |
|----------|-------|--------|
| `httpOnly` | `true` | ✅ JS cannot read cookie |
| `secure` | dynamic (true in prod) | ✅ HTTPS only in production |
| `sameSite` | `"none"` | ⚠️ Cross-site cookies enabled — acceptable for cross-origin admin access, but monitor |
| `path` | `"/"` | ✅ Scoped to site root |
| `maxAge` | 1 year | ℹ️ Long-lived — acceptable for single-admin system |

---

## OAuth Callback — Low Risk ✓

- No state parameter CSRF check
- **Risk level: LOW** — login is owner-only. An attacker would need to initiate OAuth as the owner to exploit. No sensitive data in callback.
- **Future improvement**: Add state param if login is ever opened to non-owner users

---

## Error Sanitization — Verified ✓

In production:
- Raw stack traces stripped from tRPC errors ✅
- INTERNAL_SERVER_ERROR replaced with generic message ✅
- No SQL query details exposed to clients ✅

---

## Minor Findings (Low Severity)

### M1: Math.random() for customer portal session tokens
- **File**: `server/routers/advanced.ts:500`
- **Issue**: `Math.random()` is not cryptographically random
- **Impact**: Customer portal session tokens are slightly guessable (not admin)
- **Fix**: Use `crypto.randomBytes(32).toString('hex')` instead
- **Priority**: LOW — customer portal only, not admin access

### M2: sameSite: "none" broadens cookie scope
- **File**: `server/_core/cookies.ts`
- **Issue**: Allows session cookie to be sent cross-origin
- **Impact**: Low — tRPC uses JSON Content-Type which requires CORS preflight
- **Recommendation**: Consider `sameSite: "lax"` if admin always on same domain
