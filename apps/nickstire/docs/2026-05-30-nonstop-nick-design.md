# Nonstop Nick — Design + Build (2026-05-30)

> Produced under `/brainstorming` rigor then built in 5 mergeable chunks. **All commits held local** (sibling pushing). Backend is **dormant until 3 operator switches land** (§Operator Actions).

## 1. Understanding Summary
- **What:** "Nonstop Nick" — a **$7.99/month** tire membership at Nick's. One registered vehicle, no appointment, pull up anytime.
- **Why (the real goal):** A **gym/AAA-style breakage play.** The operator's exact words: *"I want as many people to sign up for autopay and never use it just like the gym, but when they need it, no problem."* Most members pay for **peace of mind** and rarely trigger it; the profit is breakage (paid-for, unused). The engaged minority who use it are the upsell/LTV winners.
- **Who:** Cleveland/Euclid Everyman drivers.
- **Voice (locked):** *"Pull up. We got it."* Surface = **absurd convenience + delight**; the breakage mechanism is **never telegraphed**. "Cancel anytime" is a quiet reassurance, never a headline (naming "gym/trap" would break the delight spell AND prime heavy users).

## 2. The Offer
**Covered (one vehicle, rims ≤19", no appointment):** tread-area flat repairs (plug+patch) · rubber valve stems · tire rotation · rim cleans · air top-off + tread check · wiper/bulb swaps (member brings the part).
**Excluded (stated plainly — no false claims):** towing · sidewall (= a new tire) · TPMS sensors/valve stems (member fair price) · rims >19" · the wiper/bulb part itself.
**Rotation stays** as the anti-cancel anchor (the recurring "I should get my free rotation" pull-up + the upsell window) — its cost is customer-acquisition spend, not leakage.

## 3. Unit Economics (illustrative — confirm against real labor cost)
No member type loses money on the membership alone: even a heavy user (~$80/yr cost) nets positive vs $95.88/yr revenue. Blended ≈ **+$70-80/member/yr before any tire/brake/oil upsell.** The math works on the *shape* (most are ghosts/light), not the average. Breakage is the engine; one-vehicle binding caps the downside without a usage counter.

## 4. Architecture (built on EXISTING Stripe rails — reuse, not rebuild)
```
/nonstop-nick page (Join btn)
   → memberships.startCheckout (public tRPC)
   → createMembershipCheckout() [payments.ts, mode:subscription, reads STRIPE_NONSTOP_NICK_PRICE_ID]
   → Stripe hosted Checkout (card never touches our server)
   → customer.subscription.* webhook [EXISTING /api/webhooks/stripe handler, extended]
   → memberships table (status mirrors Stripe; idempotent upsert by stripeSubscriptionId)
   → counter: memberships.lookupByPhone (admin tRPC) — "is this an active member?"
```

### Build chunks (all committed, held local)
| # | What | Commit |
|---|---|---|
| 1 | `/nonstop-nick` page (FocusedServicePage config) + route + mount | 5d5373dd |
| 2 | `memberships` table + migration 0063 (hand-applied) | 836df020 |
| 3-5 | checkout fn + webhook subscription handling + membershipsRouter | c362095f |

## 5. ⚙️ Operator Actions (the honest seam — backend dormant until these land)
1. **Apply migration** `drizzle/0063_nonstop_nick_memberships.sql` to the DB (hand-applied; there is no auto-migrate). Then `pnpm run check` passes at runtime.
2. **Create the Stripe Price:** [COMPLETED 2026-06-13] Stripe Price IDs have been created and configured:
   - Nonstop Nick ($7.99/mo): `price_1Th8Gp36ZrIwRhqkVzY82ALt` (Product: `prod_UgVH0iSq3o3Trx`)
   - Nonstop Nick+ ($9.99/mo): `price_1Th8Gq36ZrIwRhqk4FA8B2RW` (Product: `prod_UgVHUd5U3SpTRk`)
   Set env `STRIPE_NONSTOP_NICK_PRICE_ID` and `STRIPE_NONSTOP_NICK_PLUS_PRICE_ID` in `.env` and `.env.example`.
3. **Subscribe the webhook** to `customer.subscription.created/updated/deleted` events (the `/api/webhooks/stripe` endpoint + `STRIPE_WEBHOOK_SECRET` already exist). Confirm the endpoint is registered in Stripe.

Until 1-3 land: the page renders + sells, the Join button degrades honestly to "call/walk in to sign up" (true — they CAN sign up in person), and nothing errors.

## 6. Still TODO (next session / on operator go)
- **Page Join CTA → wire to `startCheckout`** (the page currently shows the call/walk-in CTA; add a phone-capture + "Join $7.99/mo" button that calls the mutation and redirects to the returned Stripe URL). Small client chunk — deferred so the page could ship + sell immediately.
- **Counter UI** — a small admin surface (or reuse customer lookup) calling `memberships.lookupByPhone` + `bindVehicle`. The router is ready; the UI is the last mile.
- **Prerender regen** so `/nonstop-nick` reaches crawlers (it's `prerender:true`; next refresh picks it up).
- **Verify unit-economics** numbers against real shop labor cost.

## 7. Decision Log
- **Gym-breakage over foot-traffic loss-leader** — operator corrected mid-design; breakage *wants* non-usage, so rotation reframed from "drives visits" to "anti-cancel anchor."
- **Delight-forward, mechanism-hidden copy** — naming "gym/trap/insurance" breaks the spell + primes heavy users (AppleCare/AAA model, not Planet-Fitness-honesty).
- **Reuse existing Stripe webhook** — found `/api/webhooks/stripe` already built; extended it vs new infra.
- **New `memberships` table, not bolt onto `loyalty_*`** — different lifecycle (paid subscription vs points), different source of truth (Stripe).
- **One vehicle bound at first use, not signup** — keeps signup one-tap (friction is the enemy in a volume/breakage game); caps fleet abuse.
- **Honest exclusions stated plainly** — protects the delight (clarity, not limits) AND the false-claim risk guarded all session.
