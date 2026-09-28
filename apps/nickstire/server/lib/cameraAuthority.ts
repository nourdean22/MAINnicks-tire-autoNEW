/**
 * Optional production-authority fence for the fixed `sign` camera.
 *
 * During a host migration, camera_runtime intentionally accepts a NEW producerInstanceId
 * even when its heartbeat sequence restarts. Without an authority fence, two live hosts
 * can therefore alternate the single sign row and both can submit visits.
 *
 * Unset/blank means today's behavior. When armed, only the sign producer carrying the
 * exact required calibration may write; unrelated cameras are unaffected.
 */
export function cameraAuthorityCalibrationAllowed(
  camera: string,
  calibrationVersion: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (camera !== "sign") return true;
  const required = requiredCalibrationVersion(camera, env);
  if (!required) return true;
  return calibrationVersion === required;
}

export function requiredCalibrationVersion(
  camera: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (camera !== "sign") return null;
  const required = String(env.CAMERA_SIGN_REQUIRED_CALIBRATION_VERSION ?? "").trim();
  return required || null;
}
