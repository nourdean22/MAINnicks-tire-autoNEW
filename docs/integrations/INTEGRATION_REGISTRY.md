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

| Integration        | Purpose                     | Required secrets                                                        | Feature flag / trigger    | Owner | Fallback behavior                               | Risk if down |
| ------------------ | --------------------------- | ----------------------------------------------------------------------- | ------------------------- | ----- | ----------------------------------------------- | ------------ |
| Stripe             | Payments/invoice flows      | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`                           | Payment paths active      | Owner | Hide payment actions, preserve inquiry capture  | High         |
| Twilio             | SMS notifications/campaigns | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`        | SMS features or cron jobs | Owner | Log + skip SMS send, keep core flow alive       | Medium-High  |
| Meta CAPI          | Attribution events          | `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID`                               | Conversion event dispatch | Owner | Skip event send, continue user flow             | Medium       |
| Google OAuth       | Admin auth                  | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OWNER_OPEN_ID` | Admin login               | Owner | Admin login unavailable; public site unaffected | High         |
| Google Maps/Places | Reviews/maps enrichments    | `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`       | Review/map requests       | Owner | Return null/no enrichment with warnings         | Medium       |
| Resend             | Transactional email         | `RESEND_API_KEY`, `EMAIL_FROM`                                          | Notification send path    | Owner | Skip email and log warning                      | Medium       |
| Bridge / NOUR OS   | Cross-system sync/events    | `NOUR_OS_API_URL`, `BRIDGE_API_KEY`                                     | Bridge endpoints/jobs     | Owner | Queue/skip sync operations with alerting        | High         |

## Update rule

Any PR that adds/changes integration behavior must update this file in the same PR.
