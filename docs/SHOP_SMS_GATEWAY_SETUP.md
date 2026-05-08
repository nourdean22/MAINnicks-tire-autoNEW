# Shop SMS Gateway Setup — Wave-103

**Goal:** route the shop's transactional SMS (booking confirmations,
drop-off recaps, Nick's voice-call address texts, callback confirms)
through the **Samsung F25e on the Verizon line (216-862-0005)**
instead of the Twilio number, so the customer sees the same number
they already trust.

Twilio stays as the fallback. If the F25e is offline or runs out of
battery, every send automatically rolls over to Twilio + you get a
Telegram alert.

---

## What you need

- Samsung F25e (the shop phone — the one carrying 216-862-0005)
- A reliable wifi or LTE connection on that phone
- 5 minutes of operator setup time

---

## Step 1 · Install the app

1. On the F25e, open the **Play Store**.
2. Search for **SMS Gateway** by **Capevace** (or use this direct
   link: https://play.google.com/store/apps/details?id=com.capevace.smsgateway).
3. Install + open it.
4. Grant the SMS + contacts permissions when prompted (Android
   requires this so the app can use the native SmsManager and read
   delivery status).

---

## Step 2 · Enable the cloud server

The app has 3 modes — Local server, Private server, Cloud server.
We're using **Cloud server** because it's free, requires no port
forwarding, and works behind any NAT/firewall.

1. In the app, tap **Cloud server**.
2. Toggle it **ON**.
3. The app generates a **username** + **password**. Tap the eye
   icon to reveal them, then **copy both**.
4. Note the API URL it shows (default: `https://api.sms-gate.app/3rdparty/v1`).

---

## Step 3 · Add credentials to Railway

On the dev computer (or Railway dashboard):

```bash
railway variables --service nickstire \
  --set SHOP_SMS_GATEWAY_USERNAME=<paste-username> \
  --set SHOP_SMS_GATEWAY_PASSWORD=<paste-password>
```

(Or paste them into Railway → nickstire service → Variables tab.)

The URL is hardcoded to the Capevace cloud default and rarely
needs changing. If you do need to override it, set
`SHOP_SMS_GATEWAY_URL`.

---

## Step 4 · Configure the inbound webhook

This is what lets customer **replies** flow back into the admin
dashboard so you can see the whole conversation.

1. In the app, tap **Webhooks** → **Add webhook**.
2. **URL:** `https://nickstire.org/api/webhooks/sms-gateway`
3. **Events:** check all three —
   - `sms:received` (customer replied)
   - `sms:delivered` (your text reached them)
   - `sms:failed` (delivery failed — you'll get a Telegram alert)
4. The app generates a **signing secret**. Copy it.
5. Set it in Railway:
   ```bash
   railway variables --service nickstire \
     --set SHOP_SMS_GATEWAY_WEBHOOK_SECRET=<paste-secret>
   ```
6. Save the webhook in the app.

The signing secret means the webhook will reject any forged calls —
only the real Capevace cloud relay can trigger our handler.

---

## Step 5 · Verify it works

1. Restart the nickstire service on Railway so the new env vars are
   picked up (push or `railway up`).
2. From the admin Voice Receptionist page, hit **DIAL NOW** to call
   yourself. Have Nick text you the address. Confirm it shows up
   from **216-862-0005** instead of `+1 216 769 9977` (Twilio).
3. Reply to that text. Within ~10 seconds it should show up in the
   admin SMS dashboard threaded against your customer record.

---

## What's routed through the shop number

| Send type                        | Route       | Why |
|----------------------------------|-------------|-----|
| Booking confirmation             | shop → twilio fallback | Customer recognizes the number |
| Drop-off check-in                | shop → twilio fallback | Same line they just visited |
| Voice call address recap (Nick)  | shop → twilio fallback | They just called this number |
| Callback confirmation            | shop → twilio fallback | Outgoing callback comes from same line |
| Marketing / winback campaigns    | twilio                  | Bulk + opt-out compliance |
| Review request follow-ups        | twilio                  | Bulk |
| 7-day SMS recovery (declined)    | twilio                  | Bulk |
| Internal Telegram alerts         | telegram                | n/a |

Bulk/marketing stays on Twilio because Twilio handles opt-out
keyword enforcement, dedicated A2P registration, and won't get the
shop's personal line flagged for spam.

---

## When the F25e goes offline

Every send hits the gateway first, with a **10-second timeout**.
If the gateway returns failure (phone offline, Capevace down,
credentials wrong), the code:

1. Logs a warning with the reason.
2. **Fires a Telegram alert** to your bot so you know to fix it:
   > ⚠️ Shop SMS gateway offline · falling back to Twilio for 4127
   > Reason: timeout
3. **Falls through to Twilio** so the customer still gets the text.

You'll never lose a message. You'll just get a notification when
the F25e needs attention.

---

## Operator runbook

**Phone died / not getting alerts:**
- Plug it in. App auto-restarts the cloud connection within 30s.
- Verify by texting yourself from any other phone — you should see
  it pop up in the admin SMS dashboard.

**Customer reply not showing in admin:**
- Check the F25e is online + connected to wifi/LTE.
- Open the Capevace app → Webhooks → tap the webhook → check
  recent deliveries. Failed ones show why (signature mismatch,
  network error, etc.).

**Need to disable the shop route temporarily:**
- Easiest: blank out `SHOP_SMS_GATEWAY_USERNAME` in Railway. Every
  send falls through to Twilio with no gateway attempt.
- Or set `SMS_KILL_SWITCH=true` to disable all outbound SMS.

---

## Architecture note

```
Customer text replies
     │
     ▼
F25e (216-862-0005) ── SmsManager native API
     │
     ├── Outbound: Capevace cloud relay POST → Android → Verizon SMS
     │
     └── Inbound: Android intent → Capevace cloud → POST webhook
                                                        │
                                                        ▼
                              nickstire.org/api/webhooks/sms-gateway
                                            │
                                            ├── Signature validated (HMAC-SHA256)
                                            ├── recordInboundShopSms() → conversation thread
                                            └── communication_log → admin SMS view
```

Source: `server/sms.ts:sendSmsViaShopGateway()` +
`server/routes/webhooks/smsGateway.ts`.

---

**Wave-103 ships:** May 8, 2026
