# Load-Bearing Systems Protection Matrix

This document lists areas where breakage creates outsized operational or revenue risk.

## Protection policy

Any PR touching these areas should include:

1. explicit impact statement
2. focused validation evidence
3. rollback instructions
4. owner acknowledgement in review

## Protected surfaces

| Surface                          | Typical paths                                                                                                            | Failure impact                                                 | Required PR evidence                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| Auth/Admin access                | `server/_core`, auth middleware/routers                                                                                  | Admin lockout or privilege issues                              | auth path tests + manual sanity                                       |
| Payments                         | Stripe handlers, payment routes                                                                                          | Direct revenue disruption                                      | payment path test + rollback note                                     |
| Lead/booking conversion          | booking/lead/contact flows                                                                                               | Lost inbound conversions                                       | smoke test evidence                                                   |
| SMS Gateway (shop F25e, primary) | `server/sms.ts` `via:"shop"` path, `server/routes/webhooks/smsGateway.ts`, `server/cron/jobs/smsGatewayHealthMonitor.ts` | Customer-facing transactional SMS degradation                  | shop-gateway send + inbound webhook signature test                    |
| Twilio/SMS (fallback + bulk)     | SMS modules/routes/jobs (Twilio path)                                                                                    | Bulk campaign + drip degradation; backup path for shop gateway | send/queue behavior verification                                      |
| Cron/background jobs             | `/api/cron/*`, job schedulers                                                                                            | Silent automation failure                                      | trigger test + logs                                                   |
| Bridge/sync systems              | bridge connectors/sync modules                                                                                           | Cross-system drift and stale records                           | sync path validation                                                  |
| DB schema/migrations             | `drizzle/`, `drizzle.config.ts`                                                                                          | Data integrity and runtime query failures                      | migration plan + rollback                                             |
| Webhook verification             | Meta/Twilio/SMS Gateway webhook handlers                                                                                 | spoof/abuse or dropped events                                  | signature validation tests (HMAC for SMS Gateway uses body+timestamp) |
| Social publish & ad render       | `server/services/adStudio/*` (puppeteer render), `server/routers/adStudio.ts`, `server/services/metaSocial.ts` (carousel/reel post), `server/services/scheduledPosts.ts` + pulse-tier `scheduled-posts` cron | Ads/reels fail to generate or post — marketing + paid-boost disruption (no direct revenue loss; fails clean) | render smoke test (Generate) + Meta post-path check + claim-safety lint; arms `REEL_PUBLISH_ENABLED`/`META_IG_USER_ID` |

## Merge gate recommendation

If protected surfaces are touched, reviewer should block merge until evidence and rollback notes are present.
