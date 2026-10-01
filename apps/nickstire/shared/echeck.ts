/**
 * Ohio E-Check rules the public site may state. Every E-Check fact in customer
 * copy should come from here, with its source, rather than be written by hand.
 *
 * WHY THIS EXISTS (2026-10-01). Hand-written copy on six surfaces told
 * customers that Ohio gives "30 days to fix and re-test", that the registration
 * "goes invalid" on day 31, and that Nick's does "state-certified emissions
 * repair". One version cited "Ohio Bureau of Motor Vehicles E-Check program
 * rules" as its source. None of it holds:
 *
 *   - No 30-day repair deadline exists in OAC 3745-26 or ORC 4503.10. The real
 *     consequence is below: the registration is not renewed.
 *   - Ohio EPA does certify repair facilities (OAC 3745-26-15, with an official
 *     sign), but Nick's is not on its published list, so "state-certified" is
 *     not a claim this shop can make. If the shop is certified later, add the
 *     certification here with its number and source and change no copy by hand.
 *   - Only official E-Check stations run the state test. Nick's runs a free
 *     readiness check and repairs the failure; it does not pass cars.
 *
 * Verified against the primary sources listed in SOURCES on VERIFIED_AT. Ohio
 * legislators were moving to end the program in 2026 (see
 * localDiscoveryLibrary.ts), so re-verify before quoting a number past a year.
 */

export const OHIO_ECHECK = {
  verifiedAt: "2026-10-01",

  /** Ohio's seven E-Check counties. Nick's is in Cuyahoga. */
  counties: ["Cuyahoga", "Geauga", "Lake", "Lorain", "Medina", "Portage", "Summit"] as const,

  /**
   * What actually happens after a failed test. ORC 4503.10(B)(3)(e) refuses
   * registration without an inspection certificate; OAC 3745-26-12(A)(5) lists
   * the certificates that satisfy it (inspection, exemption, extension, repair
   * waiver). For a failed vehicle the ways out are a pass, a waiver or an
   * extension.
   */
  registrationRule:
    "Ohio won't renew your registration until the vehicle passes E-Check or qualifies for a repair waiver or extension.",

  /** OAC 3745-26-12(D)(1): inspections happen only at designated stations. */
  whoTests: "Only official E-Check stations run the state test.",

  /** ohioecheck.info, failed vehicles: three tests in 365 days, then $18. */
  freeTests: {
    count: 3,
    windowDays: 365,
    afterThatCost: 18,
    display: "Up to three E-Check tests in a 365-day period are free; after that, each test costs $18.",
  },

  /**
   * OAC 3745-26-01 and Ohio EPA's repair cap waiver page: from 2026-01-01 a
   * waiver needs MORE THAN $450 of qualifying emissions repairs (it was $300),
   * after the Cleveland area was reclassified as a serious ozone nonattainment
   * area. Diagnostic cost counts toward it up to $100. Waivers are issued at the
   * full-service E-Check stations.
   */
  repairWaiver: {
    minimumSpend: 450,
    previousMinimumSpend: 300,
    effective: "2026-01-01",
    display:
      "Since January 1, 2026, a repair waiver requires more than $450 in emissions repairs (it was $300).",
  },

  /** OAC 3745-26-12(B)(5): repair and hardship extensions of up to six months. */
  extensionMonths: 6,

  sources: [
    "https://codes.ohio.gov/ohio-administrative-code/rule-3745-26-12",
    "https://codes.ohio.gov/ohio-administrative-code/rule-3745-26-01",
    "https://codes.ohio.gov/ohio-administrative-code/rule-3745-26-15",
    "https://codes.ohio.gov/ohio-revised-code/section-4503.10",
    "https://epa.ohio.gov/divisions-and-offices/air-pollution-control/e-check",
    "https://www.ohioecheck.info/pages/failed-vehicles",
    "https://www.ohioecheck.info/pages/waivers",
  ] as const,
} as const;
