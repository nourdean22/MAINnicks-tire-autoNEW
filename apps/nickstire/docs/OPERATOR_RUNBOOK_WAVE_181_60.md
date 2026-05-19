# Operator Runbook — Wave-181.60 Production Apply

**Date prepared:** 2026-05-18
**Audience:** operator (Nour) running from phone or laptop
**Estimated time:** 5 minutes total · 3 migrations · all idempotent

---

## What this runs

Wave-181.60 added 3 small schema changes. The application code already ships, but the new safety properties only activate after the migrations land in prod TiDB. Until applied, the system fails OPEN — nothing breaks, but you don't get the new protections.

| Migration | What it adds | Until applied |
|---|---|---|
| 0040 | `otp_attempts` table | OTP brute-force protection logs failed attempts but doesn't block (in-memory fallback gone) |
| 0041 | `sms_messages.status` += `"sending"` | SMS rehydrate fails silently on restart; "sent" count is inflated by pending |
| 0042 | `alg_estimates.follow_up_{7,30}d_attempted_at` | Declined-recovery can double-send on Railway restart mid-send |

All three are **non-blocking** — apply in any order, any time. Each script is idempotent (safe to re-run).

---

## Procedure

### Pre-flight (30 sec)

```bash
cd ~/path/to/nickstire-repo-staging
git pull origin main
cd apps/nickstire
pnpm install   # only if package.json changed; safe to skip otherwise
```

Confirm `DATABASE_URL` is set in the **repo root** `.env` (two levels above `apps/nickstire`). The apply scripts read from `../../.env`.

```bash
cat ../../.env | grep DATABASE_URL
```

If missing or pointing at a local DB, copy your prod URL into `.env` temporarily. **Don't commit the file.**

### Apply (3 commands, ~30 sec each)

```bash
pnpm exec tsx scripts/apply-wave-181-59-otp-attempts.ts
pnpm exec tsx scripts/apply-wave-181-59-sms-sending.ts
pnpm exec tsx scripts/apply-wave-181-59-declined-recovery-attempted.ts
```

Each script:
- Prints BEFORE state (current table/enum shape)
- Applies the change
- Prints AFTER state (post-check confirming success)
- Records the migration hash in `__drizzle_migrations` (so future `drizzle-kit` runs know it's applied)
- Updates `drizzle/meta/_journal.json` with the migration tag

### Smoke test (1 min)

Hit each surface briefly to confirm the new state machines work:

1. **OTP / portal:** open `nickstire.org/portal`, request a code, enter wrong code 5x → 6th attempt should be blocked with "Try again in N minutes".
2. **SMS rehydrate:** check `/admin → Messages` — sent count should match actual delivered count (no inflation from pending).
3. **Declined recovery:** runs nightly cron, no immediate smoke. Check tomorrow's `cron_log` for `recovery-declined-work` job — it should show `status: completed`, no errors.

### Rollback (only if something explodes)

Each migration has rollback SQL in the comment header of its `.sql` file. Run from MySQL console:

- **0040 rollback:** `DROP TABLE otp_attempts;` — brute-force protection reverts to fail-open. No customer impact, just no protection.
- **0041 rollback:** `UPDATE sms_messages SET status='queued' WHERE status='sending'; ALTER TABLE sms_messages MODIFY COLUMN status ENUM('queued','sent','delivered','failed','received') NOT NULL DEFAULT 'queued';` — only safe if no row currently has `status='sending'`.
- **0042 rollback:** `ALTER TABLE alg_estimates DROP COLUMN follow_up_7d_attempted_at, DROP COLUMN follow_up_30d_attempted_at;` — declined-recovery reverts to prior double-send-risk behavior. No data loss; columns are additive.

---

## After applying

1. Update `truth_os.md` — strike the three migrations from "Migrations pending awareness".
2. Optional: action the $321K declined-work backlog from `/admin → Declined Work`. Wave-181.60 added at-most-once protection, so bulk-send is now safe even if Railway restarts mid-send.

---

## Decision: SMS_KILL_SWITCH

Currently `SMS_KILL_SWITCH=true` on Railway. Originally set when Twilio went dead per wave-103. With wave-181.60's default-route flip, the kill switch only blocks the Twilio FALLBACK — shop gateway sends keep working either way.

**Recommended:** leave `SMS_KILL_SWITCH=true`. The shop gateway is the primary path and the kill switch is now defensive against a Twilio fallback you don't want anyway. Flipping it to `false` only matters if F25e dies and you want Twilio to backstop — which it can't right now because Twilio account is in bad standing.

**Action:** none. Re-evaluate when Twilio is restored.
