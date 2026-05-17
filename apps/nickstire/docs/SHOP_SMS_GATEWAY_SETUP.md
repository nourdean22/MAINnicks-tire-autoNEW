# Shop SMS Gateway — Operator Runbook

**Status:** ✅ Live in production. Shipped wave-103 → 109 (May 2026).

---

## What it is

Customer-facing transactional SMS routes through the **Samsung F25e on
the Verizon line at 216-862-0005**. Customers see texts from the shop's
real number (the same line they call) instead of a Twilio number.

The F25e runs the open-source **SMS Gateway** by Capevace (`me.capcom.smsgateway`)
which forwards messages between the nickstire backend and the phone's
native Verizon SIM via Capevace's free cloud relay.

If the F25e ever goes offline, customer-facing sends auto-fall-back to
Twilio + you get a Telegram alert.

---

## What's currently configured

- **App:** SMS Gateway v1.60.0 (sideloaded from
  github.com/capcom6/android-sms-gateway/releases — Play Store version
  is a different fork)
- **Mode:** Cloud Server (free tier, no signup needed — app auto-registers)
- **Cloud relay:** `https://api.sms-gate.app/3rdparty/v1`
- **Device ID:** `f_U1jrQBy_g8W-2pWz7g4` (the F25e)
- **Default SMS app on F25e:** Google Messages (correct — Capevace doesn't
  need to be the default; it uses cloud-relay push instead of broadcast)

**Railway env vars** on the `MAINnicks-tire-auto` service:
- `SHOP_SMS_GATEWAY_USERNAME` — Capevace cloud username
- `SHOP_SMS_GATEWAY_PASSWORD` — Capevace cloud password
- `SHOP_SMS_GATEWAY_URL` — `https://api.sms-gate.app/3rdparty/v1`
- `SHOP_SMS_GATEWAY_WEBHOOK_SECRET` — HMAC signing key for inbound webhooks

The credentials are stored ONLY in Railway env (not in this repo).

---

## How to verify it's working (60-second check)

1. Open `nickstire.org/admin` → SMS section.
2. Look at the **SMS GATEWAYS** card:
   - **Primary** should show 🟢 ONLINE + "Last seen: Xm ago" (under 10 min)
   - **Fallback** should show Twilio status (currently kill-switched while
     Twilio is down; this is fine)
3. From any conversation, send a test reply. Customer's phone should
   show the text from `+1 216-862-0005`.

A cron job (`sms-gateway-health` in the pulse tier) also pings the
gateway every 15 min and Telegrams you if it goes offline >30 min.

---

## When the F25e goes offline

Symptoms:
- Telegram alert: "🚨 SHOP SMS GATEWAY OFFLINE"
- Admin SMS page shows red dot + "OFFLINE"
- Customer-facing sends fail and fall through to Twilio (with their own
  Telegram alert per fallback)

Recovery checklist (in order):
1. **Plug it in.** Battery dead is the #1 cause.
2. **Check wifi/LTE.** Capevace cloud is HTTPS so any data connection works.
3. **Open the app once.** Tap the SMS Gateway icon. The OFFLINE banner at
   the bottom should flip back to ONLINE within 5 sec.
4. **Cloud Server toggle ON?** Settings → Home tab → Cloud server (right side).
5. **Phone rebooted recently?** "Start on boot" toggle should be ON in
   Cloud server settings — verify it didn't get reset.

If recovery doesn't work in 5 min:
- Check Railway env — confirm `SHOP_SMS_GATEWAY_*` env vars are still set
- Check the F25e didn't lose its Verizon connection (test by texting from
  another phone — does Google Messages show the text? if no = SIM problem)
- Last resort: pull a fresh APK from the GitHub releases, reinstall.

---

## Re-pairing the F25e (worst-case)

If the gateway needs full re-setup (lost device, factory reset, etc.):

1. **Install the app** — pull latest from
   github.com/capcom6/android-sms-gateway/releases (you must be the operator
   approving this APK install on the phone — it's not on Play Store)
2. **Disable Google Play Protect for this install** — Play Store → profile
   → Play Protect → Settings → toggle off "Scan apps" → install → re-enable
3. **Open app, grant SMS + Phone + Contacts permissions**
4. **HOME tab → toggle Cloud server ON**
5. **Tap the OFFLINE banner at the bottom** → triggers cloud signup dialog
   → tap CONTINUE on SIGN UP. Username + password generate automatically.
6. **HOME → Cloud server section** — copy:
   - Username (e.g. `BY9G1A`)
   - Password (e.g. `5lhjcnqp-caenp`)
7. **Set them on Railway:**
   ```
   railway variables --service MAINnicks-tire-auto \
     --set SHOP_SMS_GATEWAY_USERNAME=<copied-username> \
     --set SHOP_SMS_GATEWAY_PASSWORD=<copied-password>
   ```
8. **Generate a webhook signing secret** + paste into Settings → Webhooks…
   → Signing Key. Generate via:
   ```
   openssl rand -hex 32
   ```
   (Or any 64-char hex string)
9. **Set on Railway:** `SHOP_SMS_GATEWAY_WEBHOOK_SECRET=<the-secret>`
10. **Register the 3 inbound webhooks** with the Capevace cloud (use the API,
    don't fight the UI — it's faster):
    ```bash
    USER=BY9G1A; PASS=5lhjcnqp-caenp
    for event in sms:received sms:delivered sms:failed; do
      curl -u "$USER:$PASS" -X POST https://api.sms-gate.app/3rdparty/v1/webhooks \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"https://nickstire.org/api/webhooks/sms-gateway\",\"event\":\"$event\"}"
    done
    ```
11. **Lock down the phone for 24/7 operation:**
    ```bash
    adb shell dumpsys deviceidle whitelist +me.capcom.smsgateway
    adb shell cmd appops set me.capcom.smsgateway RUN_IN_BACKGROUND allow
    adb shell cmd appops set me.capcom.smsgateway WAKE_LOCK allow
    adb shell settings put global stay_on_while_plugged_in 7
    ```
    + In the app: HOME → toggle "Start on boot" ON

---

## What routes through the shop gateway

| Send type | Route |
|-----------|-------|
| Booking confirmations | shop → twilio fallback |
| Drop-off recaps | shop → twilio fallback |
| Status updates (job stage changes) | shop → twilio fallback |
| Nick AI's address recap text | shop → twilio fallback |
| Lead confirmations + financing pre-approval | shop → twilio fallback |
| Appointment reminders | shop → twilio fallback |
| Callback confirmations + fallback | shop → twilio fallback |
| Emergency customer responses | shop → twilio fallback |
| No-show outreach | shop → twilio fallback |
| Re-engagement (admin-triggered) | shop → twilio fallback |
| Portal verification codes | shop → twilio fallback |
| Post-invoice review request | shop → twilio fallback |
| Stale-lead nudge + warranty reminders | shop → twilio fallback |
| Referral notifications + VIP welcomes | shop → twilio fallback |
| Expired-booking rebook | shop → twilio fallback |
| Admin → customer 1:1 messages (any) | shop → twilio fallback |
| **Manager-on-duty SMS** (booking/lead alerts) | shop (target = VAPI transfer #) |
| Marketing campaigns + bulk drips | twilio (compliance) |
| Daily owner report | twilio (avoids self-loop) |
| Emergency owner alert | twilio (target may be 0005) |
| Review request batches | twilio (bulk rate limits) |

---

## The kill switch

`SMS_KILL_SWITCH=true` on Railway blocks **only the Twilio path**. Shop
gateway sends always work regardless. Set it to `true` when Twilio is
having issues so phone-AI flows don't sit on a 15s circuit-breaker
timeout. Set it to `false` (or unset) when Twilio is restored.

Current state (May 2026): `SMS_KILL_SWITCH=true` (Twilio is down).

---

## Architecture

```
OUTBOUND (admin → customer):
  admin SMS panel ─┐
  Nick AI tool ────┤
  Booking flow ────┼─→ sendSms(phone, body, via:"shop")
  Cron job ────────┘
                       │
                       ▼
               sendSmsViaShopGateway()
                       │
                       │ HTTPS Basic auth (BY9G1A:5lhjc...)
                       ▼
        api.sms-gate.app/3rdparty/v1/message
                       │
                       │ FCM push
                       ▼
              SMS Gateway app on F25e
                       │
                       │ Android SmsManager
                       ▼
                  Verizon network
                       │
                       ▼
                Customer's phone
                (sees: +1 216-862-0005)


INBOUND (customer → shop):
  Customer texts 216-862-0005
                       │
                       ▼
                  Verizon network
                       │
                       ▼
                       F25e (Google Messages app receives)
                       │
                       │ SMS Gateway app's content observer
                       │ on content://sms/inbox catches it
                       ▼
        api.sms-gate.app cloud (forwards to webhook)
                       │
                       │ POST + HMAC-SHA256(body+timestamp)
                       ▼
   nickstire.org/api/webhooks/sms-gateway
                       │
                       ├── Signature verified
                       ├── recordInboundShopSms() → conversation thread
                       └── communicationLog → admin SMS dashboard
```

---

**Last updated:** 2026-05-08, end of wave-109.
