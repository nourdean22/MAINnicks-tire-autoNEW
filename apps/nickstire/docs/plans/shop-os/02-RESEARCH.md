# Shop OS 02: research findings (2026-10-26)

Job 2026-10-26-shop-os. Nine Perplexity Pro research runs (driven in Chrome, threads listed by id) plus primary pages
the manager read the same day. Labels: FACT = the manager read the primary page or code this session; CLAIM = the
research report cites a primary source the manager did not open; INFERENCE = reasoning, not a source.

| # | Topic | Thread |
|---|---|---|
| R1 | Parts ordering integrations (PartsTech, Nexpart, O'Reilly, Worldpac, OEC) | 261c4ad6-5e1a-456b-aa1b-1afbb77127ff |
| R2 | Best shop systems compared by mechanism | 4077514e-fcdd-4485-a93e-29820724aa0d |
| R3 | Getting data out of ShopDriver Elite; open-source shop systems | a3cb4ca3-cade-4548-aedc-d0103b7ae2f7 |
| R4 | Choosing a supplier: price vs delivery vs pickup; AI copilots that make money | 24a9ef34-5f1f-4ba6-bc5b-249584b14d56 |
| R5 | Ohio estimate, invoice, tax, tire-fee and used-tire law | f01e94ea-9380-4552-830a-adc966d25b87 |
| R6 | Our tire and wheel distributors | 0332d731-c955-4b7a-b18b-2471167859ca |
| R7 | Our parts distributors | 2b8d7bfc-a698-421e-9bdb-5d6edc2fc16c |
| R8 | AI copilot panel design, failure modes, alert fatigue | 7940f461-6c97-4bf5-a67f-c8ce6b80485c |
| R9 | Counter speed, hardware, outages; ShopDriver user reviews | 527071b0-e072-4c1b-a791-1315219f3f52 |
| R10 | Card terminal, phone screen-pop, QuickBooks, payment programs | 4cbf9fed-8d84-4084-bde7-1dea3ab88d05 |
| R11 | Creative ideas from other industries (dealers, dental, salons, restaurants, Discount Tire) | e749ce76-0d7d-4c87-b527-3c7fb0b2bf93 |
| R12 | Security and legal duties (FTC Safeguards, Ohio breach law, PCI, texting) | eb41af3e-2c57-4fcb-8c79-95af281e0dd2 |
| R13 | Walk-in queue, lanes and wait estimates | 6ea43a76-fb0b-493b-b923-ccf88641e8b4 |
| R14 | Tech phone tools: inspections, tread gauges, VIN/plate/DOT scanning, voice | 698aff51-742d-4085-b3e6-ed50e0e3f1f6 |
| R15 | Vehicle data sources: NHTSA, plate-to-VIN, CARFAX, ACES/PIES | 2c64d919-20f8-476b-9d4f-1b0af6350839 |
| R16 | ShopDriver Elite features and competitor pricing | 69890fcb-bdb7-421f-90af-35639d644911 |

Batch 2 headlines (details live in 08-IDEAS, 09-ACCESS-AND-SECURITY, 05-ROADMAP):
- R11: the money is in closing loops we already open (arrival -> approval -> parts -> paid -> deferred work), not more
  advertising. Vendor numbers worth knowing, not forecasts: Xtime inspections "$115 more per repair order"; Discount
  Tire's handheld scanners take "under five seconds per tire".
- R12: referring customers to finance programs may bring the shop under the FTC Safeguards Rule; build MFA, individual
  accounts, audit logs and no stored card or SSN data from day one.
- R13: "first come, first served within the right lane" with the oldest ready job dispatched first beats one global
  line; quote wait ranges from real techs, bays and job history; measure walkaways.
- R14: start with manual tread and brake numbers plus photos; Anyline's web SDK is the one camera tool that documents
  VIN, plate and tire DOT reading in a browser (quote only); Bluetooth gauges rarely talk to a phone web app.
- R15: NHTSA VIN decoding is free (batches of 50); NHTSA's recall API is by model, not by VIN; plate-to-VIN costs
  money (platetovin.com from $40/month + $0.09 per lookup; Auto.dev $599/month + $0.055); CARFAX gives shops free
  QuickVIN in exchange for publishing their service records.
- R16: ShopDriver Elite is $100/month with 2 users and, by its own FAQ, has no online parts ordering.

## 1. Parts: one aggregator covers every parts store we use

- FACT (api-docs.partstech.com/openapi.yaml, v2.021.1, downloaded): PartsTech publishes its full API: punchout quote
  and cart, catalog search, VIN and plate lookup, local inventory, stores, suppliers, tires, orders, MOTOR labor
  (`/taxonomy/labor`), MOTOR maintenance schedules, fluids, specs, Mitchell 1 labor. Beta server exists.
- CLAIM (R7, PartsTech help articles): PartsTech supports all five of our main parts suppliers: Federated, Car Parts
  Warehouse, Parts Authority/IMC, AutoZone Pro and O'Reilly. Car Parts Warehouse itself advertises ordering through
  "Connection, Partstech or Grouplink".
- CLAIM (R7): each supplier needs its own account proof to connect (AutoZone: Pro account PIN + servicing store;
  O'Reilly: account number + an electronic-order invoice from the last 30 days; Parts Authority: account + location,
  manual review; Federated/Fisher: rep-initiated approval form).
- FACT (integrations.oreillypro.com): O'Reilly offers "a direct API or punchout ordering and invoicing integration" to a
  "single location". Contact integrations@oreillyauto.com.
- FACT (partstech.com/api-agreement-terms): no caching of PartsTech data beyond per-order accounting; fees on an Order
  Form. CLAIM (R1): an exclusivity clause makes PartsTech the app's only aftermarket catalog unless waived.
- CLAIM (R1, R7): WHI Nexpart is the second path (Car Parts Warehouse already uses a Nexpart WebShop); ask WHI for
  NEXLINK (punchout) first, ORDERLINK only if we need our own search screens.
- CLAIM (R7): Car Parts Warehouse has a Euclid branch (23520 St. Clair Ave) and a Warrensville Heights distribution
  center with same-day delivery if ordered by 2:30 PM; 175+ delivery vehicles.
- CLAIM (R1): Worldpac speedDIAL 2.0 returns orderByTime, dispatchTime, quantityAvail, price, corePrice per quote.
- INFERENCE: start with punchout (their screen inside ours, cart comes back as RO lines); build our own search only
  where it pays.

## 2. Tires and wheels: three aggregators plus Wheel Pros direct

- CLAIM (R6): PartsTech tire search covers Capital Tire, Dunlap & Kyle (Gateway/Hesselbein) and TireHub on its free
  tier; ATD, U.S. AutoForce and NTW on a paid tier. Tireweb's Connections Center API (REST/SOAP, sandbox, partner
  keys) lists ATD, Capital, D&K/Gateway, TireHub, USAF, NTW and Wheel Pros. TireConnect sells custom integrations.
  TireBase (Cleveland Wholesale Tire's Tire Access site) has a public API but the tenant must authorize us.
- CLAIM (R6): Wheel Pros publishes a developer portal; order APIs are off by default; request at data@wheelpros.com.
- UNKNOWN: Xpress Tire and Elite Tire and Wheel integration paths; delivery cutoff fields for any tire supplier.
- FACT (repo): our live D&K code is `server/services/gatewayClient.ts` + `gatewaySupplierOrder.ts`;
  `dkClient.ts` is a mock with no callers.

## 3. Labor times and repair data

- FACT: MOTOR labor and maintenance schedules come with PartsTech (spec above); MOTOR also sells direct (DaaS, sandbox,
  quote only).
- CLAIM (R2): Mitchell 1 refuses data integrations for software meant for a single repair facility.
- CLAIM (R2): ALLDATA Repair is $209/month for shop use; that is not an API license.
- CLAIM (R3): ShopDriver Elite is made by Dowell Systems (Real-Time Labor Guide); no public API, export or migration
  service found; its terms on data ownership could not be read. Tekmetric's converter charges $750 and skips open ROs.
- INFERENCE: never let the AI invent labor hours, torque or intervals; show guide time, our past billed time and
  actual tech time as three separate numbers (Mastertech pattern, R8).

## 4. Ohio rules the estimate and invoice screens must follow (detail in 07-COMPLIANCE.md)

- FACT (codes.ohio.gov rule 109:4-3-13, read 2026-10-26): effective March 21, 2026; estimate-choice form "where the
  anticipated cost exceeds fifty dollars"; new authorization when added work "amounts to ten per cent or more
  (excluding tax) of the original estimate"; itemized invoice with "the identity of the individual performing the
  repair or service"; must "tender to the consumer any replaced parts" unless disclosed beforehand.
- CLAIM (R5): Cuyahoga combined sales tax 8.00% (5.75 state, 1.25 county, 1.00 transit) and Ohio taxes repair labor;
  core charges stay taxed when the core comes back; the $1 Ohio tire fee is paid upstream by the distributor (taxable
  if passed through); a used tire at exactly 2/32" is illegal to install on a passenger car (ORC 1345.022); new-tire
  DOT registration within 30 days with a full TIN (49 CFR 574.8); keep tax records 4 years (ORC 5739.11).

## 5. What the best shop systems get right (mechanisms to copy)

- CLAIM (R2, R9): connected record from inspection to paid invoice (Tekmetric, AutoLeap); tire Quick Quote with no
  customer record first (Tekmetric Tire Suite, $39/month add-on); Smart Jobs that fill vehicle-specific parts and labor;
  versioned customer approval link with photos (Shop-Ware DVX); separate shift, job and billed clocks (Shop-Ware,
  Shopmonkey); deferred work resurfacing at the next visit (Protractor, Manager SE); keyboard-first counter
  (Mitchell Manager SE: F3 find customer, F4 history, F7 quick estimate, F9 new RO, F10 invoice, F11 counter sale).
- CLAIM (R9, Capterra reviews of Real-Time/ShopDriver): users like its simplicity and plate-to-VIN; complain about slow
  history lookup, balances buried in work orders, no prefill of frequent parts, VIN scanning outside the app, and
  invoicing down during internet outages.
- CLAIM (R9): common modern complaints: duplicate labor lines from double clicks (Shopmonkey), quick quotes that demand a
  customer record (Tekmetric), closeout errors that do not say which field is wrong.

## 6. AI copilot: what works and what backfires (R4, R8)

- CLAIM: no vendor publishes independent proof of AI revenue lift; the money comes from inspection photos, clear
  approval links and deferred-work follow-up. Detect Auto's "27% growth" and Tekmetric's "28% higher ARO with DVI" are
  vendor numbers, not controlled tests.
- CLAIM (R8, clinical alert research): alert override rates of 49-96%; one system switch raised alert volume 6x and
  dropped acceptance of the most severe alerts from 100% to 8.4%. Lesson: fewer, better-targeted pointers.
- Design rules adopted from R8: at most 3 visible pointers; rank by correctness first (wrong vehicle, missing input),
  then tech-confirmed findings, then customer complaint, then maintenance due, then deferred work, then optional;
  never rank by dollars; "missing history" shows as "verify history", never "overdue"; dismiss reasons (already done,
  on estimate, not applicable, customer declined, later) each do something different; dismissals never silently change
  intervals; measure with a 50/50 holdout by customer, not acceptance rates.

## 7. Money, phone and books (R10)

- CLAIM: Maverick Payments has a REST API and hosted payment forms; whether our card machine can take an amount pushed
  from an invoice is UNKNOWN until Maverick answers for our exact terminal model.
- CLAIM: Spectrum Business Voice has no public call-event API; caller-ID screen pop needs call forwarding through, or
  porting to, a webhook phone platform (Twilio, RingCentral, Dialpad). We already run Vapi/Twilio for the receptionist.
- CLAIM: QuickBooks Online: our system owns ROs; QBO gets finalized Invoice + linked Payment; parts purchases as Bill or
  Purchase; one tax calculation, never two.
- CLAIM: payment programs with real public APIs: Snap (status webhooks), Koalafi (in-store flow, signed webhooks),
  American First Finance (status callback), Sezzle (amount-driven session); Acima, Progressive, Synchrony, Kafene are
  partner-gated.

## 8. Counter hardware and outages (R9)

- One keyboard-and-monitor counter PC, a full-page laser printer, the card terminal, phones/tablets for photos and VIN
  scans; add label printers or scanners only after the workflow proves it.
- A cached web app is not offline mode. Plan: phone hotspot failover, numbered paper intake forms, entered once when back.
