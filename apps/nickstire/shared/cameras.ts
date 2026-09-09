/**
 * The cameras the shop EXPECTS to exist — the registry `lot.health` joins runtime
 * heartbeats against.
 *
 * WHY A CODE CONSTANT AND NOT A TABLE. Two cameras, operator-owned, changed by a
 * commit that CI reviews. A table would let the list drift from the producers'
 * config with nothing checking; a constant is versioned with the producer code.
 * The `camera` id must match what the producer sends: `vision/run_live.py` posts
 * `camera="sign"`; visitd sends its `cameras.<name>` key.
 *
 * A camera listed here with no heartbeat row renders NEVER_INGESTED — the honest
 * state before the first commissioning session, and the state the admin used to
 * be unable to express (it rendered `cameras: []`).
 */
export const EXPECTED_CAMERAS = [
  {
    camera: "sign",
    label: "Shop sign — lot and driveway",
    role: "lot",
    /** SHOPSIGN is the camera the pipeline is calibrated on (bays 1 and 3, portal). */
    commissioned: true,
  },
  {
    camera: "inside",
    label: "Shop inside — bays",
    role: "bays",
    /** No producer runs against SHOPINSIDE yet; it renders muted, not as a fault. */
    commissioned: false,
  },
] as const;

