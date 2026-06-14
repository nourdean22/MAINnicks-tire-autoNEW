# Weekly GBP Photo Queue

**Status: DRAFT/MANUAL — shot list only, no uploads.**

## Opportunity
GBP photos are sporadic and mostly customer-uploaded. Fresh owner photos
(a steady weekly drip) lift local ranking and trust. Google favors
active, recently-photographed profiles.

## What's automated vs manual
- **Automated:** `client/src/lib/gbpPhotoQueue.ts` generates a balanced,
  deterministic 6-task weekly rotation across 11 categories.
- **Manual:** the owner shoots and uploads to GBP → Photos. No code
  touches Google Photos or the GBP API.

## Each task gives you
Title · category · exact shot instructions · why it helps · a caption
suggestion. Upload destination is always **Google Business Profile →
Photos**.

## Privacy + safety rules (every photo)
- No visible license plates unless blurred.
- No customer faces without their spoken permission.
- No private paperwork / screens with personal data.
- No unsafe shop scenes.
- Tidy the background — clutter reads as careless.

## Owner weekly routine (~20 min)
Pull the week's 6 tasks, shoot them during normal work, upload to GBP
with the suggested captions. Aim for 3-6 fresh photos/week.

## Truth source
`client/src/lib/gbpPhotoQueue.ts`. Future: an admin card that renders the
current week + a "copy instructions" button (integration plan doc).
