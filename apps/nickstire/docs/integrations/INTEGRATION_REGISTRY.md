# Integration Registry (Source of Operational Truth)

Use this registry as the authoritative integration map.

## Fields

- **Integration**: system/vendor name
- **Purpose**: why it exists in platform
- **Required secrets**: env keys needed
- **Feature flag / trigger**: how it is enabled
- **Owner**: accountable operator/team
- **Fallback behavior**: behavior when unavailable
- **Risk if down**: business impact severity

## Registry Table

| Integration                       | Purpose                                                                                                        | Required secrets                                                                                                    | Feature flag / trigger                                      | Owner | Fallback behavior                                                                                  | Risk if down |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- | ------------ |
| Stripe                            | Payments/invoice flows                                                                                         | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`                                                                       | Payment paths active                                        | Owner | Hide payment actions, preserve inquiry capture                                                     | High         |
| Shop SMS Gateway (Capevace, F25e) | **Primary** SMS — customer-facing transactional. Sends from 216-862-0005 (shop's real Verizon line). Wave-103+ | `SHOP_SMS_GATEWAY_USERNAME`, `SHOP_SMS_GATEWAY_PASSWORD`, `SHOP_SMS_GATEWAY_URL`, `SHOP_SMS_GATEWAY_WEBHOOK_SECRET` | All `sendSms(..., { via: "shop" })` calls + inbound webhook | Owner | Auto-fallback to Twilio + Telegram alert; cron `sms-gateway-health` pings every 15min              | High         |
| Twilio                            | **Fallback** SMS + bulk/marketing campaigns + voice receipt                                                    | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`                                                    | Bulk sends, drip sequences, daily report, owner alerts      | Owner | Log + skip SMS send via `SMS_KILL_SWITCH=true` (only blocks Twilio path; shop gateway still works) | Medium       |
| Meta CAPI                         | Attribution events                                                                                             | `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID`                                                                           | Conversion event dispatch                                   | Owner | Skip event send, continue user flow                                                                | Medium       |
| Google OAuth                      | Admin auth                                                                                                     | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OWNER_OPEN_ID`                                             | Admin login                                                 | Owner | Admin login unavailable; public site unaffected                                                    | High         |
| Google Maps/Places                | Reviews/maps enrichments                                                                                       | `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`                                                   | Review/map requests                                         | Owner | Return null/no enrichment with warnings                                                            | Medium       |
| Resend                            | Transactional email                                                                                            | `RESEND_API_KEY`, `EMAIL_FROM`                                                                                      | Notification send path                                      | Owner | Skip email and log warning                                                                         | Medium       |
| Meta Social (Instagram & FB)      | Auto-posting & inbox moderation (Graph API)                                                                    | `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_APP_ID`, `META_APP_SECRET` (DB overrides)        | Admin console posting & comment replies                     | Owner | Skip post/reply, log Graph API failures, display connection alert                                  | Medium       |
| Higgsfield CLI                    | Video clip & carousel image generation                                                                         | `HIGGSFIELD_CREDENTIALS_JSON` (DB override)                                                                         | Autopost scheduler / image generation trigger               | Owner | Fallback to OpenAI / Gemini image generation, log CLI failure                                      | Low          |
| Bridge / NOUR OS                  | Cross-system sync/events                                                                                       | `NOUR_OS_API_URL`, `BRIDGE_API_KEY`                                                                                 | Bridge endpoints/jobs                                       | Owner | Queue/skip sync operations with alerting                                                           | High         |

## Update rule

Any PR that adds/changes integration behavior must update this file in the same PR.
