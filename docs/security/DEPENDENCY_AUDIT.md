# Dependency Audit — Nick's Tire & Auto
Generated: 2026-03-29 | Tool: pnpm audit

## Summary
8 vulnerabilities found in transitive (indirect) dependencies.
**No direct dependencies have known critical vulnerabilities.**

| Severity | Count | Action |
|----------|-------|--------|
| Critical | 0 | — |
| High | 2 | Monitor — both transitive |
| Moderate | 5 | Monitor |
| Low | 1 | Monitor |

---

## Findings

### HIGH — qs (Prototype Pollution)
- **Package**: `qs@6.13.0` (via `express@4.21.2 > body-parser > qs`)
- **Patched in**: `>=6.14.2`
- **Path**: Transitive — express pulls it in
- **Fix**: Wait for Express 5 which bumps qs. Or add pnpm override: `"qs": ">=6.14.2"`
- **Exploitability**: Low — requires attacker to send crafted query strings that reach qs parsing; tRPC routes use JSON bodies, not query strings

### HIGH — lodash-es (Prototype Pollution)
- **Package**: `lodash-es@<=4.17.22`
- **Patched in**: `>=4.17.23`
- **Path**: Transitive dependency
- **Fix**: Add pnpm override if lodash-es is pulled in by a direct dep

### MODERATE — fast-xml-parser (ReDoS)
- **Package**: `fast-xml-parser` (two versions affected)
- **Path**: Likely pulled in by AWS SDK
- **Fix**: AWS SDK update will resolve

### MODERATE — path-to-regexp (ReDoS)
- **Package**: `path-to-regexp@<0.1.13`
- **Path**: Via express
- **Fix**: Express version bump

### MODERATE — esbuild (Development only)
- **Package**: `esbuild@<=0.24.2`
- **Path**: Build tool — dev only
- **Fix**: `pnpm update esbuild`
- **Risk**: Dev/build tooling — not in production runtime

---

## Applied pnpm Overrides (if needed)

Add to `package.json` under `"pnpm"` key:
```json
"pnpm": {
  "overrides": {
    "qs": ">=6.14.2"
  }
}
```

---

## Recommended Actions

| Priority | Action | Effort |
|----------|--------|--------|
| LOW | Update esbuild (dev dep only) | 5 min |
| LOW | Add qs override in package.json | 5 min |
| MONITOR | Watch for Express 5 final release | — |
| MONITOR | Watch for AWS SDK patch for fast-xml-parser | — |

---

## engines field
Added to `package.json`:
```json
"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }
```
This prevents accidental deploys on old Node versions that lack ESM/async support.
