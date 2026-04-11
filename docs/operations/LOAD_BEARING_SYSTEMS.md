# Load-Bearing Systems Protection Matrix

This document lists areas where breakage creates outsized operational or revenue risk.

## Protection policy

Any PR touching these areas should include:

1. explicit impact statement
2. focused validation evidence
3. rollback instructions
4. owner acknowledgement in review

## Protected surfaces

| Surface                 | Typical paths                           | Failure impact                            | Required PR evidence              |
| ----------------------- | --------------------------------------- | ----------------------------------------- | --------------------------------- |
| Auth/Admin access       | `server/_core`, auth middleware/routers | Admin lockout or privilege issues         | auth path tests + manual sanity   |
| Payments                | Stripe handlers, payment routes         | Direct revenue disruption                 | payment path test + rollback note |
| Lead/booking conversion | booking/lead/contact flows              | Lost inbound conversions                  | smoke test evidence               |
| Twilio/SMS              | SMS modules/routes/jobs                 | Notification and follow-up degradation    | send/queue behavior verification  |
| Cron/background jobs    | `/api/cron/*`, job schedulers           | Silent automation failure                 | trigger test + logs               |
| Bridge/sync systems     | bridge connectors/sync modules          | Cross-system drift and stale records      | sync path validation              |
| DB schema/migrations    | `drizzle/`, `drizzle.config.ts`         | Data integrity and runtime query failures | migration plan + rollback         |
| Webhook verification    | Meta/Twilio webhook handlers            | spoof/abuse or dropped events             | signature validation tests        |

## Merge gate recommendation

If protected surfaces are touched, reviewer should block merge until evidence and rollback notes are present.
