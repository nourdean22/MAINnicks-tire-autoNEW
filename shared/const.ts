export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// Google Business Profile — Single source of truth
// Place ID verified from live Google Places API text search (March 2026)
export const GOOGLE_PLACE_ID = "ChIJSWRRLdr_MIgRxdlMIMPcqww";
export const GBP_PLACE_URL = "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/";
export const GBP_DIRECTIONS_URL = "https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112/";
export const GBP_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${GOOGLE_PLACE_ID}`;
export const GBP_CID = "913066080091298245";
export const GBP_EMBED_URL = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2987.5!2d-81.5597624!3d41.5525118!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8830ffda2d516449%3A0xcabdcc3204cd9c5!2sNick's%20Tire%20And%20Auto%20Euclid!5e0!3m2!1sen!2sus!4v1710000000000";

/**
 * Build a Google Places API details URL for the shop.
 * Centralizes URL construction so Place ID and fields are never duplicated.
 */
export function buildPlaceDetailsUrl(apiKey: string, fields: string = "reviews"): string {
  return `https://maps.googleapis.com/maps/api/place/details/json?place_id=${GOOGLE_PLACE_ID}&key=${apiKey}&fields=${fields}`;
}

// Store info
export const STORE_NAME = "Nick's Tire & Auto";
export const STORE_PHONE = "(216) 862-0005";
export const STORE_ADDRESS = "17625 Euclid Ave, Cleveland, OH 44112";
