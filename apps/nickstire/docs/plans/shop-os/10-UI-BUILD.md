# Shop OS 10: the /system UI build plan

Job 2026-10-26-shop-os. Clickable mockup (sample data, 4 screens): https://claude.ai/artifact/TWqsphTCiJFqigPcxxd1f5
(private to Nour until he shares it). No product code exists yet.

## 1. Design read (antislop, house direction)

Reading this as: the walk-in counter console and bay phone app for Nick's crew, in the house OPERATOR'S COCKPIT
language (`apps/nickstire/docs/ADMIN_PHILOSOPHY.md`), dial ENERGY 2 / RHYTHM 1 / MOTION 1.

| Decision | Reason (one line each) |
|---|---|
| Near-black ground (#0A0A0A, cards #141414) | the house admin surface; the counter PC is indoors |
| Brand yellow #FDB913 only on the next action | one accent; the crew's eye goes to the button that moves the car forward |
| Red only for real urgency (10% estimate limit hit, failed safety check) | keeps red meaningful |
| Barlow Condensed headings, DM Sans body, JetBrains Mono numbers | the nickstire brand fonts; mono keeps prices and times aligned |
| Dense tables at the counter, 48-56 px buttons on the tech phone | keyboard and mouse at the desk; gloves and grease in the bay |
| Motion: none beyond 150-200 ms state changes | it is a tool; motion would slow decisions |
| Open question: a light theme for the tech phone in bright bays | test outdoors on Zach's phone before building; if built, both themes must work |
| Rejected from the ui-ux-pro-max design-system search | its "immersive" pattern and serif body font: wrong for a counter tool |

## 2. Screens (in build order, matching 05-ROADMAP)

| Screen | Route | Who | Built from |
|---|---|---|---|
| Quick tire quote | /system/quote | counter | gatewayTire search (D&K live), later other tire sources |
| Counter: repair order | /system/ro/:id | counter | work order service + new RO tables |
| Find (search + Ctrl K) | /system | counter | customers + invoices + estimates search (Ask assistant tools exist) |
| Board | /system/board | everyone | work orders + transitions + blockers |
| Tech view | /system/tech | tech | assigned ROs, findings, photos, clock (dispatch.ts clock code exists) |
| Customer approval link | /approve/:token (public) | customer | extends `/inspection/:token` (live) |
| Lobby TV | /system/tv | waiting room | board data, ticket numbers only |

## 3. How it is wired (no new framework, reuse the house)

- Same Vite/React app as nickstire.org; `/system` is a lazy-loaded route with its own shell (no admin sidebar).
  Every static path (`/system`, `/system/quote`, `/system/board`, `/system/tech`, `/system/tv`) is registered in
  `shared/routes.ts` with `sitemap: false, prerender: false`; the dynamic prefixes `/system/ro/` and `/approve/` go
  into `DYNAMIC_ROUTE_PREFIXES` in the same file (`validate:routes` checks App.tsx against both). All noindex.
- Its own installable home-screen app: a second web manifest scoped to `/system` so the crew installs "Nick's System"
  separately from the public site and /admin (iOS PWA rules from `nickstire-ios-pwa-primitives`: no window.confirm/alert,
  two-tap in-page confirms, 48 px targets).
- Data through the existing tRPC routers and the role checks in `shared/adminPermissions.ts`; new procedures land under
  a `system.*` namespace with explicit permissions (workorders.manage, money.view).
- Reuse: AdminAssistant (copilot panel), CommandSearch, Customer360 panel pieces, gatewayTire quote code, the
  inspection page, PayInvoice.
- Every data screen ships with empty, loading and error states that say what to do next (antislop R-27,
  `empty-vs-error` skill): a failed read never shows as zero.

## 4. Proof per screen before it counts as done
1. Timed against ALG on the same real ticket types (tire sale, flat, brake job): ours must be faster.
2. Keyboard-only run at the counter; one-thumb run on a phone at 390 px width.
3. Every button does something real or is not there.
4. The mockup's sample numbers never reach production code.

## 5. 2026-11-06 screen and flow extension

### Repair-order sourcing drawer

On each estimate line, open a right-side drawer containing the verified vehicle/job context, supplier query, status for every configured source, and three evidence-backed offers at most: Lowest total, Fastest ready, Best fit for this job. Cards show exact match/grade, supplier and branch, quantity/stock or UNKNOWN, checked time/expiry, item/core/fees/delivery/tax, pickup/delivery promise, route minutes only when available, and why it ranked. Keep supplier cost separate from customer retail price and margin.

Actions are Compare, Refresh, Add to estimate, Open supplier, Prepare order preview, and Mark received. The order preview repeats supplier/account/branch/SKU/fitment/quantity/cost/ETA and RO; the operator must submit. If price/stock changes, freeze the previous quote snapshot and require the user to accept the new values. If submit status is unknown, prevent a second submit until the supplier reference is checked.

### Tire quote flow

Vehicle/plate/VIN or manual size -> confirmed size and load/speed -> new supplier offers plus separate inspected used-tire units -> installed set price with every fee -> customer choice -> one RO. Do not auto-select a vehicle or claim inventory from stale catalog data. See full acceptance and edge cases in 18.

### Portal handoff and computer controls

Use the official API/punchout when the vendor allows it. If only a portal works, open it visibly with a prefilled supported search or copied SKU/quantity and pause for the operator. No hidden scraping, arbitrary shell/browser access, auto-submit, or credential capture. Keep the PWA as the default client; a local bridge is a separate allowlisted component only if evidence shows the PWA handoff is insufficient.

The supplier drawer, tire quote, estimates, offline boundary, loading/empty/error/partial states, and exact user actions are specified in [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md).

### Counter reference shelf from the shop bookmarks

Do not make a wall of external-site buttons. In the RO workspace, provide a task-based shelf (parts, tires/wheels, labor, used parts, customer financing, payments, calls/schedule and shop operations) that clearly labels each action as built-in, connected, or portal handoff. Put the source and verified timestamp on any information brought back to the RO. Portal handoffs open visibly and return to the same RO/line. Financing, payment, banking and insurance remain explicit customer/operator flows; they are not background CRM actions. Use [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md) for the screenshot inventory, unknown labels, privacy limits and discovery checklist.
