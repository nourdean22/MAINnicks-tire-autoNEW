/** Camera producer authority: shop PC -> NicksMax -> NattyNour. */
export const CAMERA_AUTHORITY_STALE_SECONDS = 90;

export function producerPriority(id: string | null | undefined): number {
  const m = /^p([123])-/.exec(String(id ?? ""));
  return m ? Number(m[1]) : 99;
}

export function heartbeatAuthorityAccepted(input: {
  incomingId: string;
  incomingSeq: number;
  storedId: string;
  storedSeq: number;
  storedAgeSeconds: number;
}): boolean {
  if (input.incomingId === input.storedId) return input.incomingSeq >= input.storedSeq;
  return (
    producerPriority(input.incomingId) <= producerPriority(input.storedId)
    || input.storedAgeSeconds > CAMERA_AUTHORITY_STALE_SECONDS
  );
}

export function visitProducerAuthorized(
  provided: string | null | undefined,
  current: { producerInstanceId: string; ageSeconds: number } | null,
): boolean {
  if (!current) return !provided;
  if (!provided) return producerPriority(current.producerInstanceId) === 99;
  return (
    provided === current.producerInstanceId
    && current.ageSeconds <= CAMERA_AUTHORITY_STALE_SECONDS
  );
}
