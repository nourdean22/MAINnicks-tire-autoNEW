---
clarity-gate-version: 2.1
processed-date: 2026-06-11
processed-by: Antigravity + Nour
clarity-status: CLEAR
hitl-status: REVIEWED
hitl-pending-count: 0
points-passed: 1-9
document-sha256: 64867c44b7674f3ed08c54c10d9d9535b9d5e383d912a6faa640bccb6c986885
hitl-claims:
  - id: claim-token-exp-user
    text: "Long-lived user access tokens expire in 60 days."
    value: "60 days"
    source: "Meta Graph API Access Token Documentation"
    location: "META_TOKEN_RENEWAL.md#L8"
    round: A
    confirmed-by: Nour
    confirmed-date: 2026-06-11
  - id: claim-token-exp-page
    text: "Long-lived page access tokens do not expire as long as the user's password doesn't change and the app permissions aren't revoked."
    value: "no expiration (conditional)"
    source: "Meta Graph API Access Token Documentation"
    location: "META_TOKEN_RENEWAL.md#L9"
    round: A
    confirmed-by: Nour
    confirmed-date: 2026-06-11
---

# Meta Page Access Token Renewal Runbook

This guide describes how to regenerate, extend, and update the long-lived Meta Page Access Token used for automated posting to Instagram.

## Context
Automated posting to Instagram requires a Meta Page Access Token. Meta tokens expire (as documented in Meta Graph API v20.0 guidelines):
- Short-lived user tokens expire in **2 hours**.
- Long-lived user access tokens expire in **60 days**.
- Long-lived page access tokens **do not expire** as long as the user's password doesn't change and the app permissions aren't revoked. However, it is a best practice to check them periodically and rotate them if needed.

If the token expires or is revoked, the Instagram automated posting feature will fail.

---

## Step 1: Generate a New Long-Lived Page Access Token

1. Go to the **[Meta for Developers Portal](https://developers.facebook.com/)** and log in.
2. Open the **Tools** menu and select **Graph API Explorer**.
3. In the top-right:
   - Select your **App** in the dropdown.
   - For **User or Page**, select your Facebook user account.
   - Under **Permissions**, ensure you have:
     - `instagram_basic`
     - `instagram_content_publish`
     - `pages_show_list`
     - `pages_read_engagement`
     - `pages_manage_posts`
4. Click **Generate Access Token**. This yields a **short-lived User Access Token** (valid for 2 hours).
5. Exchange the short-lived user token for a **long-lived User Access Token** (60 days) by calling this endpoint:
   ```bash
   GET https://graph.facebook.com/v20.0/oauth/access_token?
     grant_type=fb_exchange_token&
     client_id={your-app-id}&
     client_secret={your-app-secret}&
     fb_exchange_token={short-lived-user-access-token}
   ```
   Save the returned `access_token` from the response (this is the long-lived user token).
6. Retrieve your Facebook Page ID and Page Access Token by calling:
   ```bash
   GET https://graph.facebook.com/v20.0/me/accounts?access_token={long-lived-user-access-token}
   ```
7. Locate the entry for your business Page and copy the `access_token` field. This is your **long-lived Page Access Token**.

---

## Step 2: Update the Token in Nick's Tire Application

The application looks for the token in two places (environment variable or database). The database token is **durable** and survives redeploys.

### Option A: Update the Environment Variable
Set the following environment variable in your hosting platform (e.g. Railway):
```env
META_PAGE_ACCESS_TOKEN="your-new-long-lived-page-access-token"
META_PAGE_ACCESS_TOKEN_EXPIRES_AT="YYYY-MM-DD"
```
*(Replace `YYYY-MM-DD` with the actual token expiration date if applicable, or set it to 60 days from today to receive timely warnings in the admin console.)*

### Option B: Update the Durable Database Record (SQL)
To update the token directly in the database key-value store, execute the following SQL query on your database instance:

```sql
INSERT INTO app_secret_kv (k, v, updatedAt) 
VALUES ('meta_page_access_token', 'your-new-long-lived-page-access-token', NOW())
ON DUPLICATE KEY UPDATE v = VALUES(v), updatedAt = NOW();

INSERT INTO app_secret_kv (k, v, updatedAt)
VALUES ('meta_page_access_token_expires_at', 'YYYY-MM-DD', NOW())
ON DUPLICATE KEY UPDATE v = VALUES(v), updatedAt = NOW();
```

### Option C: Admin Console UI Configuration (Recommended)
You can configure and renew the Meta Page Access Token and other variables directly in the Admin Console Settings:
1. Log into the **Nick's Tire Admin Console**.
2. Select the **Settings** sub-tab under the **Instagram/Social** section.
3. Use the **Meta Social Config** panel to update the Page ID, App ID, App Secret, Instagram User ID, and the newly minted access token (which is secure-persisted directly to `app_secret_kv`).
4. You can also configure the active **Image Generator Provider** (DALL-E, Gemini Direct, or Higgsfield CLI) and set/verify the **Higgsfield Credentials JSON** payload directly from the UI.
5. Saving the configuration automatically flushes runtime caches so the changes take effect instantly.

---

## Step 3: Verify the New Token

Verify that the application detects the new token by checking the **Armed State** in the Admin Portal under local growth settings or by querying the tRPC endpoint:
```typescript
// Query localGrowth.automationArmedState
// Ensure `ig.envTokenPresent` or `ig.durableTokenPresent` is true.
```

Presence is not proof of a usable token. After the armed-state check, make a
read-only Graph identity request for the configured Instagram Business Account
and confirm the returned account matches `nicks_tire_euclid` before any live
post. Never print the token or include it in a URL, log, caption, artifact, or
operator response.

For an approved reel, the current publisher requires a permanent public HTTPS
video URL. It creates a `REELS` container with `share_to_feed=true`, waits for
`status_code=FINISHED`, calls `media_publish` once, and records the returned
media ID plus a read-back permalink. A timeout after `media_publish` is
ambiguous and must be reconciled against recent media or the publish-attempt
ledger before retrying. Local Windows file paths cannot be sent directly to
Meta; use the configured durable media bucket/public object URL.

---

## HITL Verification Record

### Round A: Derived Data Confirmation
- Claim claim-token-exp-user (Meta Graph API Access Token Documentation) ✓
- Claim claim-token-exp-page (Meta Graph API Access Token Documentation) ✓

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|-------|--------|-------------|------|

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | REVIEWED
