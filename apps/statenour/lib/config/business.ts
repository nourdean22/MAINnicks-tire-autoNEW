/**
 * Business constants — single source of truth for Nick's Tire & Auto.
 * Change these here, they propagate everywhere.
 */

/** Monthly take-home revenue target */
export const MONTHLY_REVENUE_TARGET = 20_000;

/** Shop hours */
export const SHOP_HOURS = { open: 8, close: 18 }; // 8am-6pm

/** Business days (Mon=1 through Sat=6, Sunday closed) */
export const BUSINESS_DAYS = [1, 2, 3, 4, 5, 6];

/** Shop phone */
export const SHOP_PHONE = "(216) 862-0005";

/** Shop address */
export const SHOP_ADDRESS = "17625 Euclid Ave, Cleveland OH";
