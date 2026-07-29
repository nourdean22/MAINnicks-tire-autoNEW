# Instagram platform-spec registry

One row per externally-imposed technical rule the pipeline enforces or relies
on. **A number without a source and a retrieval date is a rumor** — this file
exists so internal policies stop being presented as Meta requirements and so
spec drift has one place to land. Re-verify a row before tightening code to it.

Status legend: `required` (platform rejects violations) · `recommended`
(platform states a preference) · `internal` (our own delivery standard) ·
`discrepancy` (our value differs from the platform's stated one — canary owed).

| Rule | Our enforced value | Platform-stated value | Status | Source (retrieved) | Enforced at | Last canary |
|---|---|---|---|---|---|---|
| Reel resolution | 1080×1920, hard-thrown on mismatch | ≥720px minimum | required (ours stricter) | Instagram Help 1038071743007909 (plan-supplied 2026-07-29; re-verify on first canary) | `reelAssembly.ts` probe check | 2026-07-17 (job 660002 published era) |
| Reel aspect | 9:16 fixed | 1.91:1 – 9:16 accepted | required (ours stricter) | same Help page | `reelAssembly.ts` scale/crop | same |
| Frame rate | 30 fps | ≥30 fps min (Help); 23–60 fps (API collection) | required | Help + Meta API Postman collection (plan-supplied 2026-07-29) | `reelAssembly.ts` | same |
| Video codec | H.264 yuv420p + faststart | HEVC or H.264 | required | Meta API collection | `reelAssembly.ts` | same |
| Audio codec/bitrate | AAC stereo **192 kbps** | AAC 48 kHz **128 kbps** listed | **discrepancy** — publishes have succeeded historically; classify via canary transcode inspect (claim-aac-canary) | Meta API collection | `reelAssembly.ts:430` | owed |
| Reel duration | 15–22 s target (brief contract) | 3 s – 15 min accepted | internal | Meta API collection | brief gen + QA | n/a |
| Reel cover | first frame unless brief sets one; judged in review room | cover NOT editable after upload; recommended 420×654 | required (irreversibility) | Instagram Help | ReelQueue review room instruction | n/a |
| Feed photo | 1080×1350 (4:5) | up to 1080 px preserved at supported ratios | recommended | Instagram Help 1631821640426723 (plan-supplied 2026-07-29) | `visualFamily.ts` FEED_W/H | n/a |
| Story geometry | 1080×1920 + safe top 250 / bottom 320 | no official pixel contract published | internal | — | `visualFamily.ts` STORY_SAFE_* | n/a |
| Reel UI overlap zones | top 12% / bottom 22% / right 13% (advisory overlay) | no official pixel contract published | internal | — | ReelQueue `REEL_SAFE` | n/a |
| Loudness | integrated LUFS window + true-peak ≤ −1 dBTP | none published for IG | internal | — | `audioQa.ts` AUDIO_DELIVERY | 2026-07-18 era renders |
| Public media URL for publish | S3 bucket URL (`S3_BUCKET`), CloudFront optional for permanence | container `video_url` must be publicly retrievable | required | Meta API collection | `storage.ts` fail-closed + delivery-issue row | continuous (every publish) |
| Publish lifecycle | container → poll status → publish → persist id; ambiguity parks + reconciler asks Meta | container/status/media_publish flow | required | Meta API collection | `metaSocial.ts` + `publishAttemptLedger` + `publishReconciler` | continuous |
| `media_product_type` | persisted per media on every sync (migration 0106, applied 2026-07-29) | use it to distinguish REELS from VIDEO post-publish | recommended | Meta API collection | `metaSocial.fetchInstagramMedia` fields + `instagram-data` sync writeback | verify first post-deploy sync |

Maintenance: when a canary runs, fill `Last canary`; when Meta moves a value,
update the row AND the enforcing code in the same PR. Rows sourced
"plan-supplied 2026-07-29" cite URLs delivered in the operator's plan and were
not independently re-fetched — re-verify each on its first canary.
