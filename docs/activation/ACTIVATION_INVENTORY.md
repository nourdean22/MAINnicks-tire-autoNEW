# Revenue Activation Inventory — Nick's Tire & Auto
Generated: 2026-03-29

## System Status

| System | Status | Triggers | Actually Sends | Credentials |
|--------|--------|----------|----------------|-------------|
| Email Notifications | EXISTS | Form subs, booking completion | Yes (Gmail MCP) | MANUS_MCP_ENDPOINT |
| SMS | EXISTS | All forms, status changes, follow-ups | Yes (Twilio) | TWILIO_* (3 vars) |
| Sheets CRM | EXISTS | All forms, invoices | Yes | GOOGLE_SHEETS_CRM_ID + token |
| Review Monitor | NEW | Cron (every 2h) | Yes (alerts on ≤3 star) | GOOGLE_PLACES_API_KEY |
| Follow-Up (24h/7d) | EXISTS | Booking completion | Yes (SMS) | TWILIO_* |
| Review Requests | EXISTS | Booking completion, admin | Yes (SMS) | TWILIO_* |
| Abandoned Forms | EXISTS | Cron (every 30 min) | Yes | — |
| Stale Lead Follow-up | EXISTS | Cron (every 2h) | Yes | — |
| Warranty Alerts | EXISTS | Cron (daily) | Yes | — |

## Form Submission Cascades

### booking.create → 6 downstream calls
1. `notifyNewBooking()` → email to shop + CEO
2. `sendSms()` → booking confirmation to customer
3. `syncBookingToSheet()` → Sheets Bookings tab
4. `scheduleReviewRequest()` → review request queue (delayed SMS)
5. `scheduleRemindersForBooking()` → appointment reminders (24h + 1h SMS)
6. `sendLeadEvent()` → Meta Conversions API (CAPI)

### lead.submit → 3 downstream calls
1. `syncLeadToSheet()` → Sheets Leads tab
2. `notifyNewLead()` → email (routes as "high_value" if urgency ≥ 4 or fleet)
3. `sendLeadEvent()` → Meta CAPI

### callback.submit → 5 downstream calls
1. Creates lead entry with `urgencyScore = 4`
2. `notifyCallbackRequest()` → email
3. `sendSms()` → callback confirmation to customer
4. `syncLeadToSheet()` + `syncCallbackToSheet()` → Sheets
5. `sendLeadEvent()` → Meta CAPI

## Cron Jobs (11 registered)

| Job | Interval | Status | Purpose |
|-----|----------|--------|---------|
| sms-scheduler | 5 min | Active | Appointment reminders (24h + 1h) |
| review-requests | 30 min | Active | Send pending review request SMS |
| abandoned-forms | 30 min | Active | Recover abandoned form submissions |
| dashboard-sync | 15 min | Active | Sync data to Google Sheets |
| stale-lead-followup | 2 hr | Active | Alert on uncontacted leads |
| review-monitor | 2 hr | Active | Fetch Google reviews, alert on low ratings |
| statenour-sync | 4 hr | Active | Push metrics to NOUR OS |
| cleanup | 6 hr | Active | Clean old data |
| daily-report | 12 hr | Active | Business hours report |
| warranty-alerts | 24 hr | Active | Warranty expiration notifications |
| customer-segmentation | 24 hr | Disabled | Customer segmentation (not needed yet) |
| retention-90day | 24 hr | Disabled | 90-day retention sequences (not needed yet) |

## Key Finding: Cron System Was Dead

`startAllJobs()` was never called from server startup. All 11 cron jobs were registered but never executed. The only background tasks actually running were 3 `setInterval` calls directly in index.ts (review request queue, reminders, post-invoice follow-ups).

**Fix:** Added `startAllJobs()` call in server.listen callback. All cron jobs now run on startup + recurring intervals.
