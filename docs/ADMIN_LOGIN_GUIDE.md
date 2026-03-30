# How to Access the Nick's Tire & Auto Admin Dashboard

## Quick Start

1. Go to **https://nickstire.org/admin**
2. Click **"Sign in"**
3. Select your Google account (**Nourdean22@gmail.com**)
4. You'll be redirected to the admin dashboard

## Prerequisites (one-time setup)

### 1. Google Cloud Console

1. Go to https://console.cloud.google.com
2. Select or create a project (e.g., "Nicks Tire")
3. Go to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: "Nick's Tire Admin"
   - Authorized redirect URIs:
     - `https://nickstire.org/api/oauth/callback`
     - `http://localhost:5173/api/oauth/callback` (for local dev)
5. Copy the **Client ID** and **Client Secret**

### 2. Railway Environment Variables

Go to your Railway project > Variables and set ALL of these:

| Variable | Value | Notes |
|----------|-------|-------|
| `GOOGLE_OAUTH_CLIENT_ID` | (from step 1) | The OAuth Client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | (from step 1) | The OAuth Client Secret |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | (same as above) | Must be set for the build — Vite needs the VITE_ prefix |
| `OWNER_OPEN_ID` | `google:YOUR_GOOGLE_ID` | See "Finding your Google ID" below |
| `JWT_SECRET` | (any random string) | e.g., `nsk_jwt_` + 32 random characters |

### 3. Finding Your Google ID (for OWNER_OPEN_ID)

Your Google ID is NOT your email. It's a numeric ID. To find it:

**Option A:** Log in once, then check Railway logs for:
```
[AUTH] User upserted: google:123456789012345
```
Then set `OWNER_OPEN_ID=google:123456789012345` and redeploy.

**Option B:** Go to https://myaccount.google.com/ > Personal info > scroll to bottom > Your user ID.

**Option C:** After your first login attempt, query the DB:
```sql
SELECT openId FROM users WHERE email = 'Nourdean22@gmail.com';
```

### 4. Redeploy

After setting all env vars, Railway will auto-redeploy. The `VITE_` variable must be present at BUILD time, so a redeploy is required.

## How It Works

1. You click "Sign in" on /admin
2. Browser redirects to Google's OAuth consent screen
3. You authorize with your Google account
4. Google redirects back to `nickstire.org/api/oauth/callback` with a code
5. Server exchanges code for tokens, fetches your profile
6. Server creates/updates your user record
7. If your `openId` matches `OWNER_OPEN_ID`, you get admin role automatically
8. Server sets a JWT session cookie (lasts 1 year)
9. You're redirected to /admin with full access

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Blank page after clicking "Sign in" | `VITE_GOOGLE_OAUTH_CLIENT_ID` is not set on Railway — set it and redeploy |
| Google shows "Error 400: redirect_uri_mismatch" | Add `https://nickstire.org/api/oauth/callback` to Google Console authorized redirect URIs |
| Redirected to homepage instead of admin | `OWNER_OPEN_ID` is not set or doesn't match — check the value |
| "Not authorized" errors in admin | Your user record doesn't have admin role — set `OWNER_OPEN_ID` correctly and log in again |
| Cookie not persisting | Clear all nickstire.org cookies and try again |

## Security Notes

- Session cookies are `httpOnly`, `secure` (HTTPS only), `sameSite: lax`
- JWT tokens expire after 1 year
- Only the Google account matching `OWNER_OPEN_ID` gets admin access
- All admin tRPC procedures check `role === 'admin'` server-side
