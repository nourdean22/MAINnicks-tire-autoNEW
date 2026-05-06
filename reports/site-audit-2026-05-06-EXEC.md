# Nickstire.org — CEO Audit Summary

**Date:** 2026-05-06
**Auditor:** Claude Code | Top-decile direct-response standard
**KPI:** Cars in line down Euclid Ave

---

## Overall Grade: **D+** (66/100 weighted: copy 71, visual 58)

The site has strong infrastructure (4.9★ proof, real photos, fast load) and an evolved voice in places. But the **homepage hero is off-model**: it's a Cybertruck shot, not a storefront-with-cones shot — the visual proof of the entire FCFS business model never appears above the fold. **The master tagline ("Pull up for tires. Drop off for repairs.") is on zero pages.** The booking page violates banned language ("Book," "Reserve") in its meta title alone.

## Top 3 Leaks (Costing Most Visits)

1. **Hero shows the wrong photo + headline.** `hero-cybertruck.webp` is set against "CLEVELAND TOUGH." A Cleveland mom searching for "tire shop near me" needs to see the sign + cones + open bays in 0.5 seconds. She gets a Tesla truck and a slogan.
2. **Banned-language violations in `/booking`.** Meta title: "Hold Your Spot · **Book** Auto Repair Online." Description: "**Reserve** your drop-off." This is appointment-language, the exact opposite of FCFS positioning.
3. **`/financing` title and entire page concept uses "Financing"** — banned wording. Should be "Payment Programs Available."

## Top 1 Copy Fix (Ship Today)

Replace home hero H1 + subhead site-wide with master tagline:
- **H1:** `PULL UP FOR TIRES. / DROP OFF FOR REPAIRS.`
- **Subhead:** `Cleveland's first-come-first-served shop. Walk in 7 days. Used tires from $60 installed. Written estimate before any wrench moves. Don't let the problem get bigger.`

## Top 1 Visual Fix (Ship Today)

Replace `/hero-cybertruck.webp` with the photo dictionary's `STOREFRONT_HERO`. The closest candidate already in the repo is `/photos/exterior-facade-wide.webp`. Apply object-position to keep sign + bays + cones in frame. **The cybertruck photo was correct for "Cleveland Tough" positioning. It's wrong for "Pull Up / Drop Off" positioning.**

## Single Highest-ROI Move

Ship #1 + #2 above as a single commit. **Together they reposition the entire site in 90 minutes of work.**

## Critical Blocker

**Railway deploy is hung.** All 23 commits from today's session — including framework rewrites that already address most of these gaps — are on `origin/main` but not deployed. Live customers see pre-2026-05-06 content. Open Railway dashboard, unblock deploy, and 60% of these findings auto-resolve.
