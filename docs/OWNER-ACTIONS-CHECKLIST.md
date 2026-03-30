# OWNER ACTIONS — Everything Needed to Make the System Fully Live

## PRIORITY 1 — ADMIN ACCESS (15 minutes, do first)

### Google Cloud Console Setup
- [ ] Go to https://console.cloud.google.com
- [ ] Select or create project "Nicks Tire"
- [ ] Go to APIs & Services > Credentials
- [ ] Click Create Credentials > OAuth 2.0 Client ID
  - Application type: Web application
  - Name: "Nick's Tire Admin"
  - Authorized redirect URIs: `https://nickstire.org/api/oauth/callback`
  - Also add: `http://localhost:5173/api/oauth/callback` (for local dev)
- [ ] Copy the Client ID and Client Secret

### Railway Environment Variables
- [ ] Set `GOOGLE_OAUTH_CLIENT_ID` = (Client ID from above)
- [ ] Set `GOOGLE_OAUTH_CLIENT_SECRET` = (Client Secret from above)
- [ ] Set `VITE_GOOGLE_OAUTH_CLIENT_ID` = (same Client ID — needed at build time)
- [ ] Set `JWT_SECRET` = any random 32+ character string
- [ ] Set `OWNER_OPEN_ID` = (see "Finding Your Google ID" below)
- [ ] Railway will auto-redeploy after setting vars

### First Login
- [ ] Go to https://nickstire.org/admin
- [ ] Click "Sign In"
- [ ] Authorize with Google (Nourdean22@gmail.com)
- [ ] You should see the admin dashboard with 33 sections

### Finding Your Google ID (for OWNER_OPEN_ID)
After your first login attempt, check Railway logs for:
```
[AUTH] User upserted: google:123456789012345
```
Set `OWNER_OPEN_ID=google:123456789012345` on Railway and redeploy.

---

## PRIORITY 2 — BRIDGE CONNECTION (5 minutes)

### Generate a Bridge Key
Pick any random string (e.g., `nsk_bridge_` + 32 random characters)

### Railway (nickstire)
- [ ] Set `BRIDGE_API_KEY` = your generated key

### Vercel (NOUR OS)
- [ ] Set `BRIDGE_API_KEY` = same key as Railway
- [ ] Set `NICKS_ADMIN_URL` = `https://nickstire.org`

### Verify
Visit https://autonicks.com/command — the bridge status dot should turn green and show revenue/lead/booking data from the shop.

---

## PRIORITY 3 — TELEGRAM ALERTS (5 minutes)

Telegram vars are already set on Vercel. To also get alerts from nickstire:

### Railway (nickstire)
- [ ] Set `TELEGRAM_BOT_TOKEN` = (same token as on Vercel)
- [ ] Set `TELEGRAM_CHAT_ID` = (same chat ID as on Vercel)

### Verify
A test message should appear in your Telegram when a new lead comes in.

---

## PRIORITY 4 — NAP CITATIONS (30 minutes, this week)

Old "Moe's Tire and Auto Euclid" listings hurt local SEO. Fix these:

### Sites to Update
- [ ] **Google Business Profile** — verify at business.google.com, ensure name is "Nick's Tire & Auto"
- [ ] **Facebook Business Page** — update name and contact info
- [ ] **Yelp** — search "Moe's Tire Euclid", claim and update or request correction
- [ ] **BBB** — request name change
- [ ] **Birdeye** — contact support to update
- [ ] **AutoTechIQ** — contact support to update or remove

### NAP Must Be Identical Everywhere
- Name: **Nick's Tire & Auto**
- Address: **17625 Euclid Ave, Cleveland, OH 44112**
- Phone: **(216) 862-0005**
- Website: **https://nickstire.org**

---

## PRIORITY 5 — DAILY OPERATIONS (ongoing)

- [ ] Complete 5 daily non-negotiables at autonicks.com/habits
- [ ] Follow up estimate 1613 (HUGGINS CINA — 12+ days overdue)
- [ ] Check Google Ads dashboard weekly — CPL and lead count
- [ ] Post on Instagram at least 1x/week
- [ ] Start local NOUR OS agent: PowerShell → cd to local-agent → python main.py

---

## OPTIONAL — NICE TO HAVE

- [ ] Set `GOOGLE_PLACES_API_KEY` on Railway — enables competitor monitoring
- [ ] Set `META_PIXEL_ID` + `META_CONVERSIONS_ACCESS_TOKEN` — enables Facebook conversion tracking
- [ ] Order NFC review cards (10 cards, ~$100)
- [ ] Set up Meta retargeting campaign ($500/mo budget)
- [ ] Get bloodwork (testosterone, thyroid, vitamin D, metabolic panel)
