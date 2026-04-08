/**
 * LEGAL DISCLAIMERS — Single Source of Truth
 *
 * Used on invoices, estimates, public pages, and admin.
 * When any disclaimer changes, update ONLY this file.
 */

// ═══════════════════════════════════════════════════════════
// INVOICE DISCLAIMERS
// ═══════════════════════════════════════════════════════════

export const INVOICE_DISCLAIMERS = {
  /** Center/main disclaimer — authorization and payment terms */
  center: `BY AUTHORIZING REPAIRS AND/OR ACCEPTING THIS INVOICE, CUSTOMER ACKNOWLEDGES THAT ALL WORK, PARTS, SERVICES, DIAGNOSTIC TIME, TEARDOWN TIME, TESTING TIME, INSPECTION TIME, ELECTRICAL TROUBLESHOOTING TIME, AND CHARGES LISTED ON THIS INVOICE WERE REQUESTED, APPROVED, OR OTHERWISE AUTHORIZED BY THE CUSTOMER OR CUSTOMER'S AUTHORIZED AGENT BY SIGNATURE, PHONE, TEXT, EMAIL, ELECTRONIC COMMUNICATION, DROP-OFF AUTHORIZATION, OR OTHER DOCUMENTED APPROVAL ACCEPTED BY THE SHOP. PAYMENT IN FULL IS DUE UPON COMPLETION OF REPAIRS UNLESS OTHERWISE AGREED TO IN WRITING. NO VEHICLE, KEYS, OR PARTS WILL BE RELEASED UNTIL ALL CHARGES ARE PAID IN FULL. THE SHOP RESERVES AND ASSERTS ANY LIEN, POSSESSORY RIGHT, STORAGE RIGHT, AND ALL OTHER RIGHTS AND REMEDIES AVAILABLE UNDER APPLICABLE LAW FOR UNPAID REPAIRS, PARTS, LABOR, DIAGNOSTICS, STORAGE, SUBLET SERVICES, TAXES, FEES, AND RELATED CHARGES.

DIAGNOSTIC TIME, TEARDOWN TIME, TESTING TIME, ELECTRICAL TROUBLESHOOTING TIME, INSPECTION TIME, AND DISASSEMBLY TIME ARE CHARGEABLE WHETHER OR NOT CUSTOMER ELECTS TO PROCEED WITH ALL RECOMMENDED REPAIRS. IF HIDDEN, RUSTED, SEIZED, DAMAGED, WORN, DEFECTIVE, PREVIOUSLY REPAIRED, AFTERMARKET, MODIFIED, OR NONCONFORMING PARTS OR CONDITIONS ARE DISCOVERED AFTER WORK BEGINS, ADDITIONAL PARTS, LABOR, DIAGNOSTIC TIME, SHOP SUPPLIES, AND OUTSIDE SERVICES MAY BE REQUIRED. NO WARRANTY OF ANY KIND APPLIES TO CUSTOMER-SUPPLIED PARTS, AND CUSTOMER IS RESPONSIBLE FOR ALL ADDITIONAL LABOR OR DAMAGE CAUSED BY CUSTOMER-SUPPLIED PARTS THAT FAIL, DO NOT FIT, OR CREATE RELATED ISSUES.

THE SHOP MAY USE NEW, REBUILT, REMANUFACTURED, RECONDITIONED, RECYCLED, AFTERMARKET, NON-OEM, OR USED PARTS CONSISTENT WITH THE WORK ORDER, CUSTOMER AUTHORIZATION, PARTS AVAILABILITY, AND APPLICABLE LAW. THE SHOP MAY SUBLET CERTAIN SERVICES TO THIRD PARTIES WHEN REASONABLY NECESSARY. ANY WARRANTY ON SUBLET WORK OR THIRD-PARTY PARTS IS LIMITED TO THE WARRANTY ACTUALLY PROVIDED BY THE THIRD PARTY OR MANUFACTURER.`,

  /** Left disclaimer — refund policy */
  left: `NO CASH REFUNDS. ALL SALES ARE FINAL EXCEPT FOR APPROVED WARRANTY CLAIMS OR AS REQUIRED BY LAW. APPROVED WARRANTY CLAIMS ARE LIMITED SOLELY TO REPAIR OR REPLACEMENT, AT SHOP OPTION, OF DEFECTIVE COVERED PARTS OR DEFECTIVE COVERED LABOR VERIFIED BY THE SHOP. NO CASH REFUNDS WILL BE ISSUED FOR COMPLETED LABOR, INSTALLED PARTS, MOUNTED TIRES, BALANCING, DIAGNOSTIC TIME, ELECTRICAL PARTS, SHOP SUPPLIES, SPECIAL-ORDER ITEMS, OR SERVICES ALREADY RENDERED, EXCEPT AS REQUIRED BY LAW.`,

  /** Right disclaimer — liability limitations */
  right: `THE SHOP IS NOT RESPONSIBLE FOR LOSS OF OR DAMAGE TO VEHICLES OR PERSONAL PROPERTY CAUSED BY FIRE, THEFT, WEATHER, ACTS OF NATURE, VANDALISM, RIOT, CIVIL DISTURBANCE, OR OTHER CAUSES BEYOND THE SHOP'S REASONABLE CONTROL, EXCEPT TO THE EXTENT CAUSED BY THE SHOP'S GROSS NEGLIGENCE OR WILLFUL MISCONDUCT. THE SHOP SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR COMMERCIAL DAMAGES, INCLUDING BUT NOT LIMITED TO TOWING, RENTAL COSTS, LOSS OF USE, LOST WAGES, LOST PROFITS, MISSED WORK, MISSED APPOINTMENTS, OR DOWNTIME, EXCEPT WHERE PROHIBITED BY LAW.`,
} as const;

// ═══════════════════════════════════════════════════════════
// ESTIMATE DISCLAIMERS
// ═══════════════════════════════════════════════════════════

export const ESTIMATE_DISCLAIMERS = {
  /** Center disclaimer — urgency message */
  center: `YOU LEFT WITH A KNOWN PROBLEM.

Car problems rarely stay the same. They usually get worse.

What feels minor today can turn into more damage, a bigger repair, more downtime, or a breakdown if you keep driving it.

Early diagnosis usually costs less than waiting.`,

  /** Left disclaimer — why we gave this estimate */
  left: `MOST BREAKDOWNS DO NOT COME OUT OF NOWHERE.

They start as noises, leaks, vibrations, warning lights, uneven tire wear, or a pull in the steering that gets ignored too long.

If we gave you this estimate, it is because we found a real issue that needs attention.

WE DO NOT GUESS. WE VERIFY.`,

  /** Right disclaimer — call to action */
  right: `READY TO TAKE CARE OF IT?

Bring this estimate back, call ahead, or stop by and we will pick up where we left off.

Honest diagnostics.
Fair prices.
Real repairs.

NICK'S TIRE & AUTO
(216) 862-0005
17625 EUCLID AVE, CLEVELAND, OH`,
} as const;

// ═══════════════════════════════════════════════════════════
// SHORT VERSIONS (for SMS, emails, and compact UI)
// ═══════════════════════════════════════════════════════════

export const SHORT_DISCLAIMERS = {
  /** Short refund policy for receipts/SMS */
  noRefunds: "All sales final. No cash refunds. Warranty claims limited to repair or replacement.",

  /** Short liability for SMS/email */
  liability: "Shop not liable for indirect damages. See full terms at nickstire.org/terms.",

  /** Short estimate urgency for SMS follow-ups */
  estimateUrgency: "Car problems get worse over time. Early diagnosis costs less than waiting. Bring this estimate back anytime.",

  /** Payment terms for invoices */
  paymentTerms: "Payment due upon completion. Vehicle held until paid in full.",

  /** Drop-off authorization */
  dropOffAuth: "By dropping off your vehicle, you authorize inspection and approved repairs.",

  /** Customer-supplied parts */
  customerParts: "No warranty on customer-supplied parts. Customer responsible for fit issues.",
} as const;

export type InvoiceDisclaimer = typeof INVOICE_DISCLAIMERS;
export type EstimateDisclaimer = typeof ESTIMATE_DISCLAIMERS;
export type ShortDisclaimer = typeof SHORT_DISCLAIMERS;
