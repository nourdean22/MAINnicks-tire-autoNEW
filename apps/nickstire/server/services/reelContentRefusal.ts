/**
 * Assembly refused the job on a deterministic verdict about its PAYLOAD.
 *
 * Typed so processNextAssemblyJob can tell it from a provider, network or
 * ffmpeg failure: retrying this unchanged can never pass, so it must not spend
 * the retry budget that exists for failures of the work. Job 2070005
 * (2026-10-10) was refused by the ask gate three times inside one pulse and
 * parked `failed` with all five paid clips intact.
 *
 * Lives in its own module because reelPipeline imports reelAssembly lazily
 * (ffmpeg, voice, storage) and a class check must not pull that graph in.
 */
export class ReelAssemblyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelAssemblyRefusedError";
  }
}
