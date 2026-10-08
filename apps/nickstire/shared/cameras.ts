/**
 * The cameras the shop EXPECTS to exist — the registry `lot.health` joins runtime
 * heartbeats against.
 *
 * WHY A CODE CONSTANT AND NOT A TABLE. These are operator-owned camera ROLES, changed by
 * a commit that CI reviews. A table would let the expected topology drift from the
 * producers' config with nothing checking; a constant is versioned with the producer code.
 *
 * Role and health profile are deliberately separate:
 * - role = what evidence this camera is allowed to author;
 * - healthProfile = what must be proven before the camera may call itself healthy.
 *
 * A movable interaction/PTZ camera must never inherit the fixed-geometry camera's authority
 * simply because both produce pixels. That separation is the safety boundary that lets the
 * office camera pan for people/audio without destabilising vehicle arrival/bay truth.
 */

export type CameraHealthProfile = "fixed_geometry" | "interaction_ptz";

/**
 * How the camera is powered (audit 2026-10-07, N3). A solar camera goes dark around civil dusk
 * and wakes about two hours after sunrise (measured 2026-10-04 and 10-07); `server/lib/solar.ts`
 * turns that into EXPECTED_SOLAR_OFFLINE instead of a page. Mains cameras never get that excuse.
 */
export type CameraPower = "solar" | "mains";

export const EXPECTED_CAMERAS = [
  {
    camera: "sign",
    label: "Shop sign — lot and driveway",
    role: "vehicle_truth",
    healthProfile: "fixed_geometry" as CameraHealthProfile,
    /** The V380 shop-sign camera runs on a solar panel and its own battery. */
    power: "solar" as CameraPower,
    /**
     * SHOPSIGN is the fixed, calibrated authority for property arrival/departure and the
     * current bay geometry. PTZ/interaction cameras may corroborate but never mint these.
     */
    commissioned: true,
  },
  {
    camera: "inside",
    label: "Shop inside — bays",
    role: "bay_truth",
    healthProfile: "fixed_geometry" as CameraHealthProfile,
    power: "mains" as CameraPower,
    /** No producer runs against SHOPINSIDE yet; it renders muted, not as a fault. */
    commissioned: false,
  },
  {
    camera: "office",
    label: "Office PTZ — interactions",
    role: "interaction_ptz",
    healthProfile: "interaction_ptz" as CameraHealthProfile,
    power: "mains" as CameraPower,
    /**
     * Office is an operational production camera. Commissioning controls whether the
     * camera participates in operator health/alerting; the interaction health lattice
     * still reports missing auth/event/control/media/home proofs as degraded or unverified.
     */
    commissioned: true,
  },
] as const;

export function cameraPowerFor(camera: string): CameraPower {
  const found = EXPECTED_CAMERAS.find((candidate) => candidate.camera === camera);
  // An unregistered producer gets no solar excuse: its loss is a loss until someone says otherwise.
  return found?.power ?? "mains";
}

export function cameraHealthProfileFor(camera: string): CameraHealthProfile {
  const found = EXPECTED_CAMERAS.find((candidate) => candidate.camera === camera);
  // Unknown producers get the stricter fixed-geometry profile. They should not become
  // "healthy interaction cameras" merely by posting under an unregistered id.
  return found?.healthProfile ?? "fixed_geometry";
}
