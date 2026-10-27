# Shop OS 07: Ohio rules built into the screens (acceptance criteria)

Job 2026-10-26-shop-os. Sources: R5 research (thread f01e94ea) and codes.ohio.gov rule 109:4-3-13 read by the manager
on 2026-10-26 (FACT for the quoted lines). Everything else is CLAIM until an accountant or the code text is checked.
This is a build checklist, not legal advice. Have the shop's accountant confirm the tax rows before P1 ships.

## 1. Estimates and authorization (OAC 109:4-3-13, effective March 21, 2026)

| Rule | Screen behaviour |
|---|---|
| Over $50 anticipated, face to face: customer picks written / oral / no estimate on a form with date, shop, name, phone, expected completion (FACT) | Intake asks the estimate choice once per RO and stores it; printable form; "no estimate" is NOT permission to do any work |
| Shop sign or form with the "Notice" text about the 10% limit (CLAIM, exact text in R5) | Print the notice on the intake form |
| Added work that "amounts to ten per cent or more (excluding tax) of the original estimate" needs oral or written approval first (FACT) | The original estimate is frozen; added lines add up against it before tax; at 10.0% or more the RO blocks "start work" on those lines until an approval (who, how, when, amount) is logged |
| No charge for unauthorized work at any amount (CLAIM, (C)(5)) | Every line carries approved / declined / pending; only approved lines reach the invoice |
| Under $50 with no estimate, going over $50 needs approval (CLAIM, (C)(3)) | Same block at the $50 crossing |
| After-hours drop-off form in duplicate (CLAIM, (B)(1)) | Printable night-drop form; a web form alone does not count |
| Teardown/reassembly charges disclosed before taking the car; sublet work disclosed (CLAIM) | Intake checkboxes with printed text |

## 2. Invoices

| Rule | Screen behaviour |
|---|---|
| Itemized list with parts and their cost, labor amount and "the identity of the individual performing the repair or service" (FACT) | Each labor line names the tech who did it; invoice cannot close without one |
| Used / rebuilt / remanufactured parts disclosed before work and on the invoice (CLAIM, (C)(17), (C)(12)) | Every part line has condition: new / used / rebuilt / reman; non-new needs a pre-work disclosure tick |
| Replaced parts must be offered back unless the shop said beforehand they go to rebuild, resale or warranty return (FACT, "tender to the consumer any replaced parts") | Per part: returned / customer declined / core kept (disclosed) / warranty return (disclosed) |
| Customer gets a copy of anything they sign (CLAIM) | Print or text a copy on every signature |
| Binding written quote option: valid 5 days (CLAIM, (F)) | Optional "binding quote" type with expiry |

## 3. Sales tax and fees (CLAIM until the accountant confirms)

| Item | Rule from R5 | Screen behaviour |
|---|---|---|
| Rate | Cuyahoga 8.00% (5.75 state, 1.25 county, 1.00 transit) | Rate table with effective dates, not a hard-coded number |
| Labor, parts, tires, mount/install, shop supplies, disposal/environmental fees | taxable on a consumer repair | Taxable by default; exempt only with a reason (resale, exempt customer) |
| Core charge | taxable; returning the core does NOT refund the tax | Core credit is its own workflow, never a "return" that reverses tax |
| Ohio $1 replacement-tire fee | new tires with a rim diameter of 13 inches or more only; paid upstream by the distributor; if passed through it is taxable; not on used tires | Track fee-paid per purchase; the fee line checks rim size (13 inches or more) and new vs used; never charge the state fee twice |
| Records | keep 4 years (ORC 5739.11) | No auto-delete under 4 years; legal hold flag |

## 4. Tires

| Rule | Screen behaviour |
|---|---|
| Used tire is unsafe at 2/32" or less anywhere on the tread, or with exposed plies, sidewall/bead repair, bad puncture repair, no DOT number and more (CLAIM, ORC 1345.022) | Used-tire units record tread depths, DOT TIN, photos and the checklist; install is blocked if any unsafe box is ticked; no customer waiver overrides it |
| New-tire DOT registration: full TIN, purchaser, dealer, within 30 days, paper card or electronic (CLAIM, 49 CFR 574.8) | Tire lines capture full TIN; registration task with a 30-day due date; if done electronically the invoice carries the required statement |
| Scrap tires stay "scrap" until installed; shipping papers kept 3 years (CLAIM, Ohio EPA) | Disposal lines link to the hauler pickup record |

## 5. Other records kept apart from invoices (CLAIM)
- A/C work: Section 609 tech certification on file; refrigerant records 3 years (EPA).
- Hazardous waste manifests 3 years where they apply; used oil has its own rules.
- OSHA logs 5 years; exposure records much longer. Never on customer documents.
