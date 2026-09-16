/**
 * Pack topic -> landing destination. Hand-curated, deliberately incomplete.
 *
 * Every entry here is a TOPICAL match a human would defend: the page answers
 * the question the reel raises. Where no deployed page answers it, the topic is
 * ABSENT from this map and the pack stays unassigned - which keeps it blocked
 * from promotion and honest, rather than shipping a link that lands somewhere
 * almost-right. An unassigned pack costs a boost. A wrong destination costs the
 * viewer's trust and is indistinguishable from working.
 *
 * THE HOMEPAGE IS NEVER A VALUE HERE. That is the defect being repaired: the
 * posts this account has published linked to bare nickstire.org while 175 topic
 * pages sat deployed, and the funnel measured 13,871 views -> 74 profile visits
 * -> ONE website tap. (This header used to say "all eight posts"; the count was
 * wrong - 30 reel_jobs rows carry an igPostId, 29 distinct. See the corrected
 * measurement in reelDestinations.ts.)
 *
 * READ THE PLATFORM-CAPABILITY NOTE in reelDestinations.ts before building
 * anything that writes a destination into caption text: Instagram Reel captions
 * render URLs as unclickable plain text, and Meta's media endpoint accepts no
 * link parameter. These destinations are for the bio link, DM auto-replies and
 * paid placements - not for organic caption copy.
 *
 * Keys are pack FRANCHISES (the pack id with its date prefix stripped), so a
 * re-dated pack on the same topic keeps its destination.
 *
 * EVERY VALUE IS VALIDATED. reel-destination-map.test.ts asserts each path is in
 * DEPLOYED_DESTINATIONS (derived from PRERENDER_ROUTES), so a typo or an
 * invented page - the "/tire-sidewall" mistake - fails a test instead of
 * reaching a pack.
 */
export const PACK_DESTINATIONS: Readonly<Record<string, string>> = {
  // ── Brakes ────────────────────────────────────────────────────────────
  "squealing-vs-grinding-brakes": "/brakes-grinding",
  "brake-dust-normal-vs-check-pads": "/brakes",
  "brake-fluid-moisture-test": "/brakes",
  "brake-pedal-sinks-overnight": "/brakes",
  "brake-squeal-reverse-only-wear-indicator": "/brakes",
  "caliper-sticking-hot-wheel": "/brakes",
  "hard-brake-pedal-vacuum-booster": "/brakes",
  "morning-rotor-rust-squeal": "/brakes",
  "new-brake-squeak-bed-in": "/brakes",
  "spongy-brake-pedal": "/brakes",
  "warped-rotor-brake-shake": "/brakes",
  "parking-brake-cable-seized-dragging": "/brakes",
  "road-salt-brake-lines": "/brakes",
  "abs-light-wheel-speed-sensor": "/brakes",

  // ── Tires ─────────────────────────────────────────────────────────────
  "tire-expiration": "/tires",
  "tire-sidewall-numbers": "/tires", // NOT /tire-sidewall — that page does not exist
  "sidewall-bulge": "/tires",
  "valve-stem-dry-rot": "/tires",
  "spare-tire-mileage": "/tires",
  "allseason-vs-winter-tires": "/tires",
  "awd-one-new-tire": "/tires",
  "tread-depth-rain-vs-snow": "/tires",
  "tread-fingerprint": "/tires",
  "penny-test": "/tires",
  "uneven-tire-wear-patterns": "/tires",
  "roadtrip-tire-check": "/tires",
  "tire-rotation": "/tires",
  "lug-nut-retorque": "/tires",
  "plug-vs-patch": "/tires#tire-repair",
  "slow-leak-soap-test": "/tires#tire-repair",

  // ── Alignment / steering ──────────────────────────────────────────────
  "why-car-pulls": "/car-pulling-to-one-side",
  "steering-wheel-crooked-after-tires": "/alignment",
  "balance-vs-alignment": "/alignment",
  "steering-vibration-highway-speed": "/steering-wheel-shaking",
  "tie-rod-steering-wobble-test": "/steering-wheel-shaking",

  // ── AC / climate ──────────────────────────────────────────────────────
  "ac-not-blowing-cold": "/ac-not-blowing-cold",
  "ac-blend-door-actuator-hot-cold-split": "/ac-repair",
  "ac-compressor-clutch-not-engaging": "/ac-repair",
  "ac-recharge-myth-sealed-system": "/ac-repair",
  "musty-ac-smell-evaporator-vs-filter": "/ac-repair",
  "blower-motor-resistor": "/ac-repair",

  // ── Battery / starting / electrical ───────────────────────────────────
  "battery-parasitic-drain": "/battery-keeps-dying",
  "battery-terminal-corrosion": "/battery",
  "battery-summer-heat": "/battery",
  "battery-cold-weather-cranking-amps": "/battery",
  "alternator-overcharging-battery-swell": "/battery",
  "wont-start-battery-starter-alternator": "/car-wont-start",
  "key-fob-dead-battery-no-start": "/car-wont-start",
  "starter-grinding-noise-on-start": "/starter-alternator",
  "alternator-bearing-whine-vs-belt-squeal": "/starter-alternator",
  "blown-fuse-repeat-short-circuit": "/electrical",
  "door-lock-actuator-stripped-gear": "/electrical",
  "horn-wont-work": "/electrical",
  "power-mirror-wont-move": "/electrical",
  "power-window-stuck-halfway": "/electrical",
  "turn-signal-hyperflash-bulb-out": "/electrical",
  "rear-defroster-grid-line-test": "/electrical",
  "spark-plug-wire-arcing": "/electrical",

  // ── Cooling ───────────────────────────────────────────────────────────
  "engine-overheating-first-60-seconds": "/car-overheating",
  "radiator-fan-idle-overheat": "/car-overheating",
  "collapsing-radiator-hose": "/cooling",
  "radiator-cap-pressure-test": "/cooling",
  "thermostat-stuck-open-vs-closed": "/cooling",
  "water-pump-weep-hole-leak": "/cooling",
  "coolant-color": "/cooling",
  "sweet-smell-heater-core-coolant-leak": "/cooling",
  "heater-not-blowing-hot": "/cooling",

  // ── Exhaust ───────────────────────────────────────────────────────────
  "exhaust-hanger-rattle-over-bumps": "/exhaust",
  "exhaust-manifold-cold-start-tick": "/exhaust",
  "exhaust-pop-backfire-deceleration": "/exhaust",
  "exhaust-smoke-color": "/exhaust",
  "exhaust-suddenly-loud-rusted-muffler": "/exhaust",
  "heat-shield-rattle": "/exhaust",
  "rotten-egg-exhaust-smell": "/exhaust",
  "catalytic-converter-theft-prevention": "/exhaust",

  // ── Transmission ──────────────────────────────────────────────────────
  "transmission-delayed-engagement": "/transmission-slipping",
  "clutch-slipping-rpm-flare": "/transmission-slipping",
  "transmission-fluid-color-test": "/transmission",
  "rough-shifting-check-fluid-first": "/transmission",
  "torque-converter-shudder-40-45mph": "/transmission",
  "4wd-transfer-case-bind-tight-turns": "/transmission",

  // ── Check-engine / diagnostics / emissions ────────────────────────────
  "check-engine-light": "/check-engine-light-on",
  "gas-cap-check-engine-light": "/check-engine-light-on",
  "check-engine-flashing-vs-steady": "/check-engine-light-flashing",
  "o2-sensor-rough-idle-poor-mpg": "/check-engine-light-diagnostic",
  "evap-purge-valve-stuck": "/check-engine-light-diagnostic",
  "egr-valve-clogged-rough-idle": "/check-engine-light-diagnostic",
  "hesitation-acceleration-maf-sensor": "/check-engine-light-diagnostic",
  "misfire-shudder-coil-vs-plug": "/check-engine-light-diagnostic",
  "idle-air-control-valve-rough-idle-stall": "/check-engine-light-diagnostic",
  "engine-knock-ping-carbon-vs-knock-sensor": "/check-engine-light-diagnostic",
  "echeck-readiness-monitors": "/emissions",

  // ── Oil ───────────────────────────────────────────────────────────────
  "oil-change-intervals": "/oil-change",
  "synthetic-vs-conventional-oil": "/oil-change",
  "oil-dipstick-color-check": "/oil-change",
  "pcv-valve-oil-consumption": "/oil-change",

  // ── Belts ─────────────────────────────────────────────────────────────
  "serpentine-belt-squeal": "/belts-hoses",
  "timing-belt-no-warning-light": "/belts-hoses",
  "timing-chain-rattle-cold-start": "/belts-hoses",

  // ── Seasonal ──────────────────────────────────────────────────────────
  "washer-fluid-freezing-wrong-fluid": "/winter-car-care-cleveland",
  "foggy-windshield-recirculate-trick": "/winter-car-care-cleveland",
  "cold-weather-tire-light": "/winter-car-care-cleveland",
  "summer-heat-tire-pressure": "/summer-car-care-cleveland",

  // ── Shaking ───────────────────────────────────────────────────────────
  "idle-shake-spark-plug-motor-mount": "/car-shaking-while-driving",
};

/**
 * Topics DELIBERATELY left unassigned, with the reason. Recorded so a later
 * session does not "helpfully" fill them in with an approximate page - the
 * absence is a decision, not an oversight.
 */
export const DELIBERATELY_UNASSIGNED: Readonly<Record<string, string>> = {
  "cabin-air-filter": "no filter page is deployed; /general-repair is too generic to answer the reel",
  "engine-air-filter-clogged": "same - no filter page exists",
  "cloudy-headlights": "no headlight-restoration page is deployed",
  "windshield-chip-spreads": "no glass page is deployed",
  "wiper-blade-check": "no wiper page is deployed",
  "sunroof-drain-clog-water-leak": "no body/water-leak page is deployed",
  "trunk-hatch-gas-strut-sag": "no page covers struts/hardware",
  "fuel-gauge-sending-unit": "no fuel-system page is deployed",
  "fuel-injector-tick-at-idle": "no fuel-system page is deployed",
  "fuel-pump-whine": "no fuel-system page is deployed",
  "fuel-smell-in-cabin": "no fuel-system page is deployed",
  "head-gasket-white-smoke-milky-oil": "spans cooling and engine; neither page answers it squarely",
  "burning-smell-diagnosis": "symptom spans brakes, electrical and oil - any single page would be a guess",
  "turbo-whistle-vs-boost-leak": "no forced-induction page is deployed",
  "power-steering-fluid-leak-color": "no power-steering page is deployed",
  "power-steering-whine": "no power-steering page is deployed",
  "tailpipe-condensation-vs-coolant-leak": "ambiguous between /exhaust and /cooling - the whole point of the reel is that they look alike",
  "brake-light-switch-cruise-shifter": "ambiguous between /brakes and /electrical",
  "clunk-over-bumps-sway-bar-ball-joint": "no suspension page is deployed",
  "motor-mount-clunk-acceleration": "no suspension/mount page is deployed",
  "strut-bounce-test": "no suspension page is deployed",
  "wheel-bearing-hum": "no bearing page; /wheels is about wheels for sale, not bearing noise",
  "cv-joint-click": "no driveline page is deployed",
  "u-joint-clunk-drive-reverse-shift": "no driveline page is deployed",
  "differential-whine-on-turns": "no driveline page is deployed",
  "oil-pressure-light-flicker-idle": "a pressure warning is not an oil-change topic; sending it to /oil-change would understate it",
  "dashboard-light-colors": "covers many systems; no single page answers it",
  "repair-questions": "meta/advice pack with no single service topic",
  "stop-driving-noises": "meta pack spanning several systems",
  "pothole-damage": "spans tires, wheels and alignment - the reel's point is that it can be any of them",
  "tpms-sensor-battery": "no TPMS page is deployed; /tires is about buying tires, not sensor batteries",
};
