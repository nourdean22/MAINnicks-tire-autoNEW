# Nick's Tire `/tires` Conversion & Copy Safety Upgrade

This document provides system-level technical documentation for the customer tire search and decision engine (`TireFinder.tsx`) as of June 2026.

---

## 1. System Overview & Flow

The `/tires` page assists Cleveland drivers in locating, comparing, and requesting auto tires. The search process does not query live external supplier databases (e.g. Dunlap & Kyle / D&K) in real time because the B2B portal connection is offline due to supplier-side endpoint deprecations. Instead, searches query the local database and fall back to a curated catalog with static, estimated retail prices.

### 1.1. Customer Interaction Paths

The following flow illustrates how the page processes valid searches, invalid formats, and empty inventory states:

```mermaid
graph TD
    A[Customer lands on /tires] --> B[Enter Search Input]
    
    %% Path A: Formatting Help
    B --> C{Format Check}
    C -- Incomplete or Invalid Size --> D[Show Inline Format Warning Alert]
    D --> E[Link to 'Where is my tire size?' Drawer]
    
    %% Path B: Valid Search Flow
    C -- Valid Size Format --> F[Search Local DB & Catalog Fallback]
    F -- Tires Found --> G[Display Tire Grid & Estimated Set Pricing]
    G --> H[Select Tire & Open Request Modal]
    H --> I[Submit Order Request]
    I --> J[Optional Stripe Hosted Prepayment]
    
    %% Path C: Rescue Fallback Flow
    F -- No Tires in Catalog --> K[Display Rescue Callback Form]
    K --> L[Submit Manual Lookup Callback Request]
```

---

## 2. Component Behavior vs. Safety Posture

To balance conversion rate optimization (CRO) with operational constraints, the system distinguishes between current codebase behavior and the long-term claim-safety goals.

### 2.1. Trust & Local Badging
*   **Actual Behavior**: Displays the shop rating and review count pulled dynamically from `BUSINESS.reviews.rating` and `BUSINESS.reviews.countDisplay` in `shared/business.ts`.
*   **Safety Posture**: Employs verifiable, first-party customer review figures rather than static, unproven claims.

### 2.2. Interactive Size Assistant
*   **Actual Behavior**: Renders a modal/drawer displaying visual guides for finding tire sizes (sidewall markings, driver-side door jamb, and owner's manual).
*   **Safety Posture**: Resolves input confusion before submission, reducing incorrect size orders.

### 2.3. Search Input Formatting Help
*   **Actual Behavior**: Non-blocking alert tip appears inline below the search box if regex parsing detects a missing slash or R.
*   **Safety Posture**: Guides user input syntax natively without blocking searches.

### 2.4. Set Price Calculation
*   **Actual Behavior**: Multiplies the catalog tire estimate by the customer's selected quantity and appends calculated Ohio sales tax (8%) and card surcharges (2%).
*   **Safety Posture**: Explains that these numbers are *estimates* and that staff will verify exact availability before any installation or ordering occurs.

### 2.5. Empty Result "Rescue" Lead Capture
*   **Actual Behavior**: Renders an inline callback request form when search results are empty. Submits customer contact details to the callback pipeline.
*   **Safety Posture**: Intercepts unserviceable searches and routes them to manual lookup without implying inventory availability.

---

## 3. Copy-Safety Audit & Active Watch Items

While many marketing claims have been softened, several aggressive value propositions and pricing labels remain in the codebase. These are tracked as known copy-safety watch items that require future refactoring.

### 3.1. Replaced and Softened Claims (Solved)
*   **Unqualified Free Claims**:
    *   Changed `Included Free` badge to `Included in Estimate` in the `PackageBanner` header.
    *   Changed `Free Flat Repair` to `Flat Repair Included` in the banner highlights.
    *   Changed `20-Point Inspection: Included free` to `Included in estimate`.
    *   Changed `We install it free` step label to `Installation package included`.
    *   Changed individual service values (e.g., `$20 value — FREE`) to `$20 value — Included` inside the expanded services drawer.
*   **Guaranteed Installation Promises**:
    *   Softened `Same-day on in-stock` in the trust strip and page haiku to `Same-day help when stock allows`.
    *   Softened `Same-day Install` badge to `Same-day Help`.
*   **Supplier Stock Reservation**:
    *   Softened order modal prepayment text from claiming payment "locks in" or "reserves" stock to explicitly stating:
        > *"Payment does not guarantee supplier reservation. No supplier reservation is guaranteed until staff confirms availability. Prepayment is optional; you can also pay at the counter during your visit."*
*   **Banned Brand-Voice Adjectives**:
    *   Changed `"The shop your grandfather would've trusted"` to `"1,700+ Google reviews, with the gear your kid's Tesla needs"` (removed `trusted`).
    *   Changed `"quality used tires"` to `"inspected used tires"` (removed `quality`).

### 3.2. Known Copy-Safety Watch Items (Still Present)
The following marketing hooks are still active in the current frontend code and are not fully resolved:
1.  **Aggressive Value References**:
    *   The `PackageBanner` still displays a prominent `"$289+ Value"` badge.
    *   The banner description states: *"Other shops charge $250+ for these services."*
    *   The services list summary block displays: *"Total package value: $289+ — included in estimate with every tire purchase"*.
    *   The pricing breakdown block contains a strike-through on `$289+` with the text: *"At Conrad's, Mavis, or Firestone, the same install package adds $289+ at the register."*
2.  **Used Tires Install Claim**:
    *   The used tires section states: *"Same professional installation, same included mount/balance/valve stems/disposal... just a friendlier number on the receipt."* (Note: used tire pricing structures must be monitored to ensure margins support this bundle).
3.  **Same-Day Service Implications**:
    *   Trust anchors such as `"✓ Walk-in OK 7 days"` and `"✓ Same-day help when stock allows"` must be monitored for shop capacity compliance.

---

## 4. Technical Integration & Endpoints

All client interactions are wired to the trpc router. Below are the verified endpoints exposed by the backend:

*   `trpc.gatewayTire.publicSearch` (`Query`): Queries local tire cache and catalog fallbacks. Returns size and source ("catalog" / "live").
*   `trpc.gatewayTire.getPackage` (`Query`): Returns service list details and nominal retail value estimations.
*   `trpc.gatewayTire.placeOrder` (`Mutation`): Records customer request details in the database and triggers internal notifications.
*   `trpc.gatewayTire.createCheckout` (`Mutation`): Contacts the Stripe service to create a hosted checkout session URL.
*   `trpc.gatewayTire.checkOrder` (`Query`): Allows customers to track their order status step (e.g. received, confirmed, ordered, installed).
*   `trpc.gatewayTire.confirmCheckout` (`Mutation`): Idempotently confirms Stripe payment status upon return to the callback page.
*   `trpc.callback.submit` (`Mutation`): Captures custom lookup requests for unstocked sizes.

---

## 5. Verification & Testing

### 5.1. Automated Verification
To run the automated React component tests for close behavior, modal rendering, and price estimations:
```bash
pnpm --filter nicks-tire-auto test client/src/__tests__/tire-finder.test.tsx --test-timeout=15000
```

### 5.2. Compilation and Code Quality Gates
Before pushing edits to `main`, the following commands must execute cleanly:
```bash
# Verify brand-voice rules
pnpm --filter nicks-tire-auto lint:brand-voice

# Verify server-safe source patterns
pnpm --filter nicks-tire-auto lint:source

# Verify type safety
pnpm --filter nicks-tire-auto check

# Build production assets
pnpm --filter nicks-tire-auto build
```
