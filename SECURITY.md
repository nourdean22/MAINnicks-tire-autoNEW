# Security Policy

This repository contains business-critical workflows and integration paths. Security issues are treated as operationally urgent.

---

## 1) Reporting vulnerabilities

Do **not** disclose security issues in public issues or PR comments.

Report privately to the project owner/maintainer with:

- affected area and file/path references
- reproduction steps
- impact assessment
- exploit prerequisites
- mitigation suggestions (if available)

---

## 2) Response targets

- acknowledgment target: within 72 hours
- triage priority assigned after initial validation
- remediation timeline depends on severity and blast radius

---

## 3) Severity model (practical)

### Critical

- auth bypass / privilege escalation
- payment compromise
- secret exfiltration path
- remote code execution vectors

### High

- webhook verification bypass
- sensitive data exposure
- admin-only function leakage

### Medium

- hardening gaps with realistic preconditions
- incomplete input validation in sensitive handlers

### Low

- defense-in-depth opportunities without immediate exploit path

---

## 4) Priority security surfaces

- authentication + authorization boundaries
- admin endpoints and role enforcement
- payment/Stripe handlers
- webhook signature validation (Twilio/Meta/etc.)
- environment secret management
- integration bridge endpoints and shared keys

---

## 5) Secure-change checklist (for contributors)

Before merge for sensitive changes:

1. validate permission gates
2. validate request/input sanitization
3. ensure no sensitive logs are introduced
4. verify secret usage and fallback behavior
5. include rollback considerations in PR notes

---

## 6) Disclosure and coordination

Please allow maintainers reasonable time to investigate and patch before any public disclosure.
