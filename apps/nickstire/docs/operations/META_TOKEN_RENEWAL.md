# Meta Page Access Token Renewal Runbook

This guide describes how to regenerate, extend, and update the long-lived Meta Page Access Token used for automated posting to Instagram.

## Context
Automated posting to Instagram requires a Meta Page Access Token. Meta tokens expire:
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

### Option B: Update the Durable Database Record (Durable)
To update the token directly in the database key-value store, execute the following SQL query on your TiDB instance:

```sql
INSERT INTO app_secret_kv (k, v, updatedAt) 
VALUES ('meta_page_access_token', 'your-new-long-lived-page-access-token', NOW())
ON DUPLICATE KEY UPDATE v = VALUES(v), updatedAt = NOW();

INSERT INTO app_secret_kv (k, v, updatedAt)
VALUES ('meta_page_access_token_expires_at', 'YYYY-MM-DD', NOW())
ON DUPLICATE KEY UPDATE v = VALUES(v), updatedAt = NOW();
```

---

## Step 3: Verify the New Token

Verify that the application detects the new token by checking the **Armed State** in the Admin Portal under local growth settings or by querying the tRPC endpoint:
```typescript
// Query localGrowth.automationArmedState
// Ensure `ig.envTokenPresent` or `ig.durableTokenPresent` is true.
```
