/**
 * Ride-share deep links for the drop-off flywheel.
 *
 * Pillar 4: "Drop off your car, call an Uber out of there." The shop's secret
 * weapon. One tap from nickstire.org to Uber with pickup pre-filled.
 *
 * Uber universal link: https://m.uber.com/ul/
 *   - On a device with Uber installed, launches the app with pickup pre-set.
 *   - On desktop / no-app devices, m.uber.com web fallback.
 *   - Lyft works the same via lyft.com/ride.
 *
 * Source: Uber Deep Link spec (m.uber.com/ul/). Lyft deep link spec.
 */

import { BUSINESS } from "@shared/business";

export interface RideDeepLinkOptions {
  /**
   * "pickup" = customer is AT the shop, needs a ride home. (Default — matches
   *   the drop-off flywheel.)
   * "dropoff" = customer is somewhere else, needs a ride TO the shop.
   */
  mode?: "pickup" | "dropoff";
}

/**
 * Build a Uber universal link for the shop's pickup location.
 * On mobile iOS/Android with the app installed, opens the app.
 * On desktop or web, opens m.uber.com with pickup pre-set.
 */
export function uberFromShop(opts: RideDeepLinkOptions = {}): string {
  const mode = opts.mode ?? "pickup";
  const { lat, lng } = BUSINESS.geo;
  const addr = encodeURIComponent(BUSINESS.address.full);
  const nick = encodeURIComponent(BUSINESS.name);

  if (mode === "pickup") {
    // Customer is at shop, dropping off the car, needs Uber OUT.
    return (
      `https://m.uber.com/ul/?action=setPickup` +
      `&pickup[latitude]=${lat}` +
      `&pickup[longitude]=${lng}` +
      `&pickup[formatted_address]=${addr}` +
      `&pickup[nickname]=${nick}`
    );
  }
  // Customer is elsewhere, heading TO shop.
  return (
    `https://m.uber.com/ul/?action=setPickup` +
    `&pickup=my_location` +
    `&dropoff[latitude]=${lat}` +
    `&dropoff[longitude]=${lng}` +
    `&dropoff[formatted_address]=${addr}` +
    `&dropoff[nickname]=${nick}`
  );
}

/**
 * Build a Lyft deep link for the shop's pickup location.
 * Same semantics as uberFromShop.
 */
export function lyftFromShop(opts: RideDeepLinkOptions = {}): string {
  const mode = opts.mode ?? "pickup";
  const { lat, lng } = BUSINESS.geo;

  if (mode === "pickup") {
    return (
      `https://lyft.com/ride?id=lyft` +
      `&pickup[latitude]=${lat}` +
      `&pickup[longitude]=${lng}`
    );
  }
  return (
    `https://lyft.com/ride?id=lyft` +
    `&destination[latitude]=${lat}` +
    `&destination[longitude]=${lng}`
  );
}

/**
 * Google Maps rideshare fallback (shows Uber + Lyft price comparison).
 * Good on Android as a neutral "choose your app" option.
 */
export function gmapsRideFromShop(): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${BUSINESS.geo.lat},${BUSINESS.geo.lng}` +
    `&travelmode=transit`
  );
}
