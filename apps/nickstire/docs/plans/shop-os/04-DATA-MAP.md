# Shop OS 04: data map (what we have, what ALG has, what moves)

Job 2026-10-26-shop-os. Labels: FACT (read this session, source named), INFERRED, UNKNOWN.

## 1. Production reality, read 2026-10-26 ~17:00Z (FACT, SELECT-only probe, scratchpad `shop-os-volume-probe.cjs`)

This repo is public, so monthly ticket counts and sales dollars are NOT written here. They live in the private job
memory (`shop-os-job-2026-10-26`) and can be re-read any time with the SELECT-only probe shape in
`prod-readonly-probe-facts`. What the plan needs from them:

- The shop runs a few closed tickets a day, mostly mid-to-large tickets (most between $150 and $1,000). It is not a
  high-volume quick-lube counter, so speed per ticket matters less than not losing approved or declined work.
- Busiest closing days are Saturday, Thursday and Wednesday; Sunday shows almost no closed tickets (cause UNKNOWN:
  open 9-4, tickets may be closed on Monday).
- The mirror keeps NO parts/labor split: `partsCost`, `laborCost`, `taxAmount` are all zero over the last 90 days, and
  very few descriptions say "tire". So line items, parts vs labor, tax and the tire share are NOT in our database today.
- Estimates (`alg_estimates`): roughly two out of three recent estimates never matched an invoice, so they are most
  likely walked/declined work (INFERENCE per shop data rules; the matcher also misses some).
- Customer records number in the low thousands.

The repair-order tables exist in the schema but are EMPTY in production:

| Table | Rows | Meaning for the plan |
|---|---|---|
| work_orders | 1 (cancelled test from 2026-04-08) | built, never used |
| work_order_items | 0 | built, never used |
| inventory | 0 | built, never used |
| technicians | 0 | built, never used |
| bays | 0 | built, never used |
| time_clock_entries | 0 | built, never used |
| vehicle_inspections / inspection_items | 0 / 0 | built, never used |
| customer_vehicles | 0 | built, never used |
| declined_work_captures | 0 | counter never records a decline |
| tire_registrations | 0 | never used |
| payments | 0 | never used |
| tire_orders | 4 | online tire orders |
| vehicles | table does NOT exist (dropped by migration 0117) | schema.ts still declares it |

Consequence: we can reshape these tables freely (no data to protect), but the plan must not count them as
working features. The real assets are customers, invoices, estimates, the mirror and the AI/outreach lanes.

## 2. ALG entities and how they move

| ALG entity | Mirrored today? | Move plan |
|---|---|---|
| Customers | yes (names, phones) | keep; add vehicles and notes from ALG |
| Vehicles | no (customer_vehicles empty; `vehicleInfo` is free text on invoices) | pull from ALG `api/Vehicle/listVehicles` (seen in code, shape UNKNOWN) |
| Tickets (closed) | header only: number, total, date, description, ALG ticket id | add line items (parts, labor, fees, tax, tech) via the ticket-detail call found in the API map |
| Open tickets | no | depends on the day 13-14 decision. Buy: move every open obligation (open ROs, deposits, ordered parts, promised callbacks) into the new system at one cutoff time, with a reconciliation sheet the counter lead signs off. Build: finish them in ALG during the parallel run; new work starts in /system |
| Estimates | yes (header, amount) | add line items so declined lines are known per job |
| Canned jobs | no | pull and rebuild as our canned jobs |
| Inventory | no | pull counts; used tires become single units |
| Technicians | no | create by hand (3-5 people) |
| Labor guide | ALG content, licensed by Dowell | NOT ours to copy; replace with MOTOR (via PartsTech or direct) |

What the mirror keeps and drops (FACT, lane inventory verified by the manager at `shopDriverMirror.ts:560-584`):
`listRecentTickets` is a summary feed; parts, labor and tax have been written as 0 since 2026-05; the code says the
lines live on `/api/ticket/listTicketSessions`, and fetching per ticket "collides with SHOP-PROTECT" because it kicks
the counter's login, so it is an operator decision. VIN, mileage, techs, notes, canned jobs and inventory are not read.
Customers come from `/api/Customer/listCustomers` (50 per page, 45 pages max). The only write back into ALG is a
refund call (`refundWriteback.ts`).

## 3. What the API map night must answer (P0)
1. Which call returns a closed ticket WITH its lines (parts, labor, fees, tax, tech, vendor)?
2. Which call lists vehicles with VIN, plate and mileage, and links them to customers?
3. Is there a canned-job list and an inventory list?
4. Do parts lines carry the supplier (so we learn which vendors the shop buys from most)?
5. Paging limits and how far back history goes (the mirror's oldest ticket is dated 2024-01-09; ALG may hold more).
