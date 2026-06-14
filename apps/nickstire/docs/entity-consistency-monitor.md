# Brand / Entity Consistency Monitor

**Status: MANUAL_OWNER_TASK — tracker only, no external edits.**

## Opportunity
Identity drift across listings (different names/addresses/phones)
splits citation signal and suppresses local SEO. One canonical NAP
everywhere compounds ranking.

## Canonical identity (enforce everywhere)
- Name: **Nick's Tire & Auto**
- Address: **17625 Euclid Ave, Cleveland, OH 44112**
- Phone: **(216) 862-0005**
- Website: **nickstire.org**
- Instagram: **@nicks_tire_euclid**

## What's automated vs manual
- **Automated:** the platform list + canonical values + per-platform
  check fields live in `client/src/lib/entityConsistency.ts`.
- **Manual:** the owner logs into each platform and aligns the NAP. No
  code can or should edit external listings. Nothing is marked "fixed"
  until the owner verifies it.

## Order of attack (highest local-SEO value first)
GBP → Yelp → Facebook → BBB → CARFAX → Acima → MapQuest → old Google
Sites remnants. Full per-platform action + access + risk in the lib.

## Why automation can't do this
Every platform needs authenticated owner access, most have CAPTCHAs and
verification steps, and automated listing edits violate their terms.

## Truth source
`client/src/lib/entityConsistency.ts` + the ops registry entry
`entity-cleanup` (PR #47 Ops Hub). This doc + that lib are the same data
from two angles; keep them aligned.
