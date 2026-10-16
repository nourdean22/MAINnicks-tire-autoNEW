| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-13-lease-content-type | 2026-10-13 | agent-os lease writes: POST bodies declare application/json (GitHub answered 415) | platform | MERGED | #3006 (squash 62741280) | first real lease receipt still owed: a live acquire runs in CI or a non-proxied environment; this sandbox's proxy 403s POST git/blobs by policy | offline canary with a positive control; the injected json() seam in lease-store tests hid the header path |
