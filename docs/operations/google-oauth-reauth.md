# Google OAuth Re-authentication Runbook

This runbook explains how to diagnose, troubleshoot, and re-authenticate expired Google OAuth integration tokens for Statenour OS.

---

## 1. Background

Statenour OS integrates with Google APIs (Gmail, Google Drive, Calendar) to ingest data for Nour's personal command center. It supports multiple Google accounts:
- **Primary:** `moeseuclid@gmail.com` (Account key: `primary`)
- **Personal:** `nourdean22@gmail.com` (Account key: `personal`)

If background ingests fail silently or return `401 Unauthorized` / `invalid_grant` errors, it typically means a refresh token has expired or been revoked.

---

## 2. Diagnostics

To inspect the health of all registered Google integrations, run the diagnostic script in standard PowerShell:

```powershell
cd C:\Users\nourd\NOURCITY\apps\statenour
pnpm exec tsx --env-file=.env.local scripts/google-oauth-diagnostics.ts
```

This script will output:
- Active integrations starting with `google_oauth:`
- Email, account key, and health status
- Last synchronization timestamp
- The specific failure counts (if any)
- Ready-to-use re-authentication links for local and production environments

---

## 3. Re-authentication Flow

To re-authorize an account, you must visit the authentication start endpoint scoped by that account's key.

### Step 1: Select the correct URL
Depending on the environment you are diagnosing, select the link below:

* **Primary Account (`moeseuclid@gmail.com`):**
  - Local: [http://localhost:3000/api/oauth/google-data/start?account=primary](http://localhost:3000/api/oauth/google-data/start?account=primary)
  - Production: [https://bdnick.info/api/oauth/google-data/start?account=primary](https://bdnick.info/api/oauth/google-data/start?account=primary)

* **Personal Account (`nourdean22@gmail.com`):**
  - Local: [http://localhost:3000/api/oauth/google-data/start?account=personal](http://localhost:3000/api/oauth/google-data/start?account=personal)
  - Production: [https://bdnick.info/api/oauth/google-data/start?account=personal](https://bdnick.info/api/oauth/google-data/start?account=personal)

### Step 2: Perform the OAuth Handshake
1. Copy and paste the appropriate link into a browser where you are logged into that Google account.
2. Google will prompt you to choose the account and grant permissions to Statenour.
3. Confirm/allow the requested scopes (Calendar, Drive, etc.).
4. Once completed, you will be redirected back to the Statenour dashboard with a success message.

### Step 3: Verify Health
Run the diagnostics script again to verify that the status has returned to `HEALTHY` and the failure count is reset to `0`.
