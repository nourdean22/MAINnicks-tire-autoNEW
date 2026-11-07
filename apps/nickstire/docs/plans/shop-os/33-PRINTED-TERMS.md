# Shop OS 33: the printed terms, verbatim (2026-11-07)

Answer first: this is the exact text ALG prints on every estimate and invoice today, copied from two PDFs Nour
pulled on 2026-11-07 (an estimate from 2026-11-06 and an invoice from 2025-01-28; customer, vehicle and amounts
are not reproduced). This file is a dated capture and the provenance for the
warranty and policy seeds in `server/services/businessFacts.ts`, which are the runtime copy source (SHOP-SOUL
rule 1: numbers are linked, never copied). The build reads the fact keys and their `channels`; it never retypes
this file. Check the seeds against s.2 below; a difference is fixed in ALG first, then the seed, then this file.

Source of each block: ALG `settings/getInvoiceSettings` fields `estimateDisclaimers` and `invoiceDisclaimers`
(doc 30 s.2). The invoice text prints in two columns at the foot of the page; the order below is reading order.

## 1. Estimate footer (`estimateDisclaimers`)

Body box, printed under the line items:

> YOU LEFT WITH A KNOWN PROBLEM.
>
> Car problems rarely stay the same.
> They usually get worse.
>
> What feels minor today can turn into more damage, a bigger repair, more downtime, or a breakdown if you
> keep driving it.
>
> Early diagnosis usually costs less than waiting.

Small print, left column:

> MOST BREAKDOWNS DO NOT COME OUT OF NOWHERE.
> They start as noises, leaks, vibrations, warning lights, uneven tire wear, or a pull in the steering that gets
> ignored too long.
> If we gave you this estimate, it is because we found a real issue that needs attention.
> WE DO NOT GUESS. WE VERIFY.

Small print, right column:

> READY TO TAKE CARE OF IT?
> Bring this estimate back, call ahead, or stop by and we will pick up where we left off.
> Honest diagnostics.
> Fair prices.
> Real repairs.
> NICK'S TIRE & AUTO
> (216) 862-0005
> 17625 EUCLID AVE, CLEVELAND, OH

Also on the estimate: `Rate Type: Flat & Hourly`, `Estimate Charge: $0.00`, a `Parts: Do Not Return Old Parts`
default, an `Other Authorized Person / Phone` line, and `SIGNED / DATE` under the total. The counter's free-text
`Notes:` line is where a deposit and a parts-arrival date get written today (one estimate carried a deposit and
an expected arrival date in that line), which is the strongest argument for doc 26's `Quote` object carrying
`deposit` and `partsEta` as fields instead of prose.

## 2. Invoice terms (`invoiceDisclaimers`), seven paragraphs

> NO CASH REFUNDS. ALL SALES ARE FINAL EXCEPT FOR APPROVED WARRANTY CLAIMS OR AS REQUIRED BY LAW. APPROVED
> WARRANTY CLAIMS ARE LIMITED SOLELY TO REPAIR OR REPLACEMENT, AT SHOP OPTION, OF DEFECTIVE COVERED PARTS OR
> DEFECTIVE COVERED LABOR VERIFIED BY THE SHOP. NO CASH REFUNDS WILL BE ISSUED FOR COMPLETED LABOR, INSTALLED
> PARTS, MOUNTED TIRES, BALANCING, DIAGNOSTIC TIME, ELECTRICAL PARTS, SHOP SUPPLIES, SPECIAL-ORDER ITEMS, OR
> SERVICES ALREADY RENDERED, EXCEPT AS REQUIRED BY LAW.

> UNLESS OTHERWISE STATED IN WRITING ON THIS INVOICE, SHOP-INSTALLED PARTS INCLUDE A 1 YEAR LIMITED PARTS
> WARRANTY AND SHOP LABOR INCLUDES A 90 DAY LIMITED LABOR WARRANTY. THIS IS A LIMITED WARRANTY ONLY. ANY IMPLIED
> WARRANTIES, TO THE EXTENT THEY APPLY AND CANNOT BE DISCLAIMED, ARE LIMITED IN DURATION TO THE DURATION OF THIS
> LIMITED WARRANTY TO THE EXTENT PERMITTED BY LAW. THIS LIMITED WARRANTY DOES NOT APPLY TO FAILURES OR DAMAGE
> CAUSED IN WHOLE OR IN PART BY MISUSE, NEGLECT, ABUSE, RACING, OFF-ROAD USE, OVERLOADING, IMPACT, COLLISION,
> ROAD HAZARD, POTHOLES, CURB DAMAGE, FIRE, THEFT, VANDALISM, WEATHER, SALT, CORROSION, ACTS OF NATURE, IMPROPER
> MAINTENANCE, PRE-EXISTING CONDITIONS, CUSTOMER-SUPPLIED PARTS, CONTINUED OPERATION AFTER WARNING LIGHTS OR
> OBVIOUS SYMPTOMS, LOW OR CONTAMINATED FLUIDS, OVERHEATING, OR FAILURE OF RELATED OR UNRELATED WORN COMPONENTS
> NOT REPLACED BY THE SHOP.

> USED TIRES, IF SOLD, INCLUDE A 7 DAY LIMITED REPLACEMENT WARRANTY AGAINST VERIFIED LOSS OF AIR OR INTERNAL TIRE
> FAILURE DUE SOLELY TO A DEFECT EXISTING AT THE TIME OF SALE. USED TIRE WARRANTY DOES NOT COVER PUNCTURES, NAILS,
> SCREWS, SIDEWALL DAMAGE, IMPACT DAMAGE, BEAD DAMAGE, RUN-FLAT DAMAGE, COSMETIC ISSUES, VIBRATION, UNEVEN WEAR,
> ALIGNMENT ISSUES, SUSPENSION OR FRONT-END PROBLEMS, IMPROPER INFLATION, OVERLOADING, OR MISUSE. NEW TIRES ARE
> COVERED ONLY BY THE APPLICABLE MANUFACTURER'S WRITTEN LIMITED WARRANTY UNLESS AN ADDITIONAL SHOP WARRANTY IS
> EXPRESSLY STATED IN WRITING ON THIS INVOICE. NO ROAD HAZARD WARRANTY OR MILEAGE WARRANTY IS PROVIDED BY THE
> SHOP UNLESS EXPRESSLY STATED IN WRITING.

> ALIGNMENTS ARE A SETTING SERVICE ONLY AND ARE NOT A GUARANTEE AGAINST FUTURE TIRE WEAR, PULLING, VIBRATION, OR
> NOISE CAUSED BY PRE-EXISTING VEHICLE CONDITIONS. NO WARRANTY APPLIES TO TIRE WEAR, PULLING, VIBRATION, NOISE,
> CUPPING, FEATHERING, EDGE WEAR, OR RELATED COMPLAINTS CAUSED BY MISALIGNMENT, WORN PARTS, BENT WHEELS, TIRE
> CONDITION, OR OTHER PRE-EXISTING VEHICLE CONDITIONS NOT CAUSED BY DEFECTIVE SHOP WORKMANSHIP. CUSTOMER AGREES TO
> RETURN FOR A LUG TORQUE CHECK WITHIN 24 HOURS OR 25 TO 50 MILES AFTER WHEEL OR TIRE SERVICE, IF REQUIRED BY SHOP
> POLICY. THE SHOP IS NOT RESPONSIBLE FOR FAILURE OF PRE-EXISTING RUSTED, SEIZED, SWOLLEN, STRIPPED,
> CROSS-THREADED, OVERTIGHTENED, DAMAGED, AFTERMARKET, OR MISMATCHED LUG NUTS, STUDS, WHEEL LOCKS, TPMS SENSORS,
> VALVE STEMS, FASTENERS, CLIPS, BOLTS, OR RELATED HARDWARE THAT BREAKS, STRIPS, CRACKS, OR FAILS DURING NORMAL
> REMOVAL, INSTALLATION, OR SERVICE DUE TO PRIOR CONDITION.

> CUSTOMER IS RESPONSIBLE FOR CHECKING AND MAINTAINING PROPER OIL, COOLANT, TRANSMISSION FLUID, BRAKE FLUID, POWER
> STEERING FLUID, WASHER FLUID, AND TIRE PRESSURE AFTER PICKUP. THE SHOP IS NOT RESPONSIBLE FOR ENGINE,
> TRANSMISSION, COOLING SYSTEM, OR OTHER DAMAGE CAUSED BY LEAKS, LOW FLUIDS, OVERHEATING, OR PRE-EXISTING
> CONDITIONS UNLESS DIRECTLY CAUSED BY DEFECTIVE COVERED WORK PERFORMED BY THE SHOP.

> THE SHOP IS NOT RESPONSIBLE FOR LOSS OF OR DAMAGE TO VEHICLES OR PERSONAL PROPERTY CAUSED BY FIRE, THEFT,
> WEATHER, ACTS OF NATURE, VANDALISM, RIOT, CIVIL DISTURBANCE, OR OTHER CAUSES BEYOND THE SHOP'S REASONABLE
> CONTROL, EXCEPT TO THE EXTENT CAUSED BY THE SHOP'S GROSS NEGLIGENCE OR WILLFUL MISCONDUCT. THE SHOP SHALL NOT
> BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR COMMERCIAL DAMAGES, INCLUDING BUT NOT LIMITED
> TO TOWING, RENTAL COSTS, LOSS OF USE, LOST WAGES, LOST PROFITS, MISSED WORK, MISSED APPOINTMENTS, OR DOWNTIME,
> EXCEPT WHERE PROHIBITED BY LAW.

> VEHICLES LEFT ON THE PROPERTY AFTER COMPLETION OF REPAIRS, AFTER NOTICE OF COMPLETION, AFTER DECLINED REPAIRS,
> AFTER REFUSED PICKUP, OR AFTER FAILURE TO PAY MAY INCUR A STORAGE CHARGE OF $25.00 PER DAY. UNCLAIMED VEHICLES
> MAY BE REMOVED, STORED, NOTICED, TITLED, SOLD, OR OTHERWISE PROCESSED AS PERMITTED BY APPLICABLE LAW. IF ANY
> PROVISION OF THESE TERMS IS HELD INVALID OR UNENFORCEABLE, THE REMAINING PROVISIONS SHALL REMAIN IN FULL FORCE
> TO THE MAXIMUM EXTENT PERMITTED BY LAW.

> PAYMENT AND/OR ACCEPTANCE OF THIS INVOICE ACKNOWLEDGES CUSTOMER APPROVAL OF THE WORK PERFORMED, THE CHARGES
> SHOWN, AND THE TERMS, LIMITATIONS, AND LIMITED WARRANTY STATED ABOVE.

Signer block: `MOE'S EUCLID TIRE N AUTO LLC DBA NICK'S TIRE & AUTO`, `17625 EUCLID AVE, CLEVELAND, OH 44112`,
`(216) 862-0005 | MOESEUCLID@GMAIL.COM`, then `SIGNED / DATE / Amount Due`.

## 3. What the CRM copies, and where

| Surface (doc 32 screen) | Copies | Not copied |
|---|---|---|
| Customer approval page `/approve/:token` (screen 6) | the first six invoice paragraphs in full under the frozen lines, from one `web`-channel constant added to `businessFacts.ts` (seeded from s.2, one place in code); the estimate "known problem" box when a line is declined | the seventh paragraph (payment or acceptance of the invoice acknowledges the work performed): it is a post-service acknowledgment and stays off a pre-work approval, which records consent to the quoted work only; nothing shortened; no summary bullets in place of the text |
| Pickup text (phase 4 template, needs Nour's go) | the lug torque recheck line (`alignment.warranty`, all channels) when a wheel or tire line is on the ticket | the storage line: `storage.policy` is voice and web only, so it is said on the phone or shown on the page, never texted; the warranty paragraphs (on the printed invoice already) |
| Quick tire quote (screen 3) | one line each for new tires (`new_tire.warranty`) and used tires (`used_tire.warranty`) on the card, read from the fact store | road hazard or mileage wording of any kind |
| Receptionist (`businessFacts.ts` warranty and policy facts) | its seed facts are checked against s.2 above; quote-only-if-asked stands (doc 32 rule 8); `refund.policy` and `storage.policy` answer on voice and web only | volunteering terms on a routine call; refund or storage terms by SMS |
| Printed estimate and invoice | stay ALG's; the CRM never prints its own ledger document | a second invoice format |

Open: both forms still print the MOE'S logo and the `MOESEUCLID@GMAIL.COM` address; whether that stays is Nour's
call (brand, not code). Labor lines print a price and no hours on both forms; the board's hours stay UNKNOWN until
the labor lookup has a read-only path (doc 30 s.10 item 1), and never come from the printed document.
