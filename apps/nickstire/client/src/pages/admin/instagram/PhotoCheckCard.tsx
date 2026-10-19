/**
 * Photo check: a plain scorecard for one shop photo, and one branded picture on request.
 *
 * Consumer of instagramStudio.checkPhoto and instagramStudio.brandedPhoto, with
 * instagramStudio.uploadEvidencePhoto for the upload (the same mutation and limits the Studio
 * uses: 7.5 MB, JPEG / PNG / WebP / HEIC). Nothing here posts, schedules or publishes.
 *
 * Honesty rules the copy depends on:
 *   - the scorecard is ONE vision model's opinion, so it is labelled that way;
 *   - a check that failed, was unreadable, was refused or never finished shows no numbers at all
 *     (a zero would read as a bad photo);
 *   - the branded picture is text-to-image: a new scene, not the uploaded photo edited. It spends
 *     an image credit per call and the server does not dedupe, so the call sits behind a second
 *     tap that shows the prompt, and a ref lock keeps a double tap to one call;
 *   - brandedPhoto.model names the configured model, not proof of which one answered.
 *
 * The confirm is in-card, not confirmDialog: it has to show an expandable prompt, and a native
 * confirm is suppressed in the iOS standalone PWA.
 */
import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Scorecard = Extract<RouterOutputs["instagramStudio"]["checkPhoto"], { ok: true }>;
type Branded = Extract<RouterOutputs["instagramStudio"]["brandedPhoto"], { ok: true }>;

const MAX_BYTES = 7_500_000;
const MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const PROMPT_PREVIEW = 300;

type CheckFailure = "vision_unavailable" | "unreadable" | "invalid_url" | "error";
const CHECK_LINE: Record<CheckFailure | "offline", string> = {
  vision_unavailable: "Photo checking isn't available right now.",
  unreadable: "Couldn't read the result, try again.",
  invalid_url: "The photo link couldn't be opened. Choose the photo again.",
  error: "The request didn't finish. Check your connection and retry.",
  offline: "You appear to be offline. Check your connection and retry.",
};

const BEST_FOR = { instagram: "Instagram", facebook: "Facebook", gbp: "Google Business Profile", billboard: "Billboard" } as const;
const PRIORITY = { high: "High", medium: "Medium", low: "Low" } as const;

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (base64) resolve(base64);
      else reject(new Error("empty file"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });

const btn = "h-auto min-h-12 w-full px-4 py-2 text-base sm:w-auto";

export function PhotoCheckCard() {
  const upload = trpc.instagramStudio.uploadEvidencePhoto.useMutation();
  const check = trpc.instagramStudio.checkPhoto.useMutation();
  const brand = trpc.instagramStudio.brandedPhoto.useMutation();

  const inputRef = useRef<HTMLInputElement>(null);
  const checkSeq = useRef(0);
  const renderLock = useRef(false);

  const [step, setStep] = useState<"idle" | "uploading" | "checking">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [card, setCard] = useState<Scorecard | null>(null);
  const [checkFailure, setCheckFailure] = useState<CheckFailure | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [fullPrompt, setFullPrompt] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [branded, setBranded] = useState<Branded | null>(null);
  const [brandFailure, setBrandFailure] = useState<"unavailable" | "error" | null>(null);

  // An offline mutation waits for the network instead of failing: say so, and let Retry start fresh.
  const offline = step === "checking" && check.isPaused;
  const busy = (step !== "idle" && !offline) || rendering;

  const runCheck = async (url: string) => {
    const seq = ++checkSeq.current;
    setStep("checking");
    setCheckFailure(null);
    try {
      const result = await check.mutateAsync({ photoUrl: url });
      if (seq !== checkSeq.current) return;
      if (result.ok) setCard(result);
      else setCheckFailure(result.reason);
    } catch {
      if (seq === checkSeq.current) setCheckFailure("error");
    } finally {
      if (seq === checkSeq.current) setStep("idle");
    }
  };

  const onPick = async (file: File) => {
    checkSeq.current++;
    setProblem(null);
    setUploadFailed(false);
    setPhotoUrl(null);
    setCard(null);
    setCheckFailure(null);
    setConfirming(false);
    setFullPrompt(false);
    setBranded(null);
    setBrandFailure(null);
    if (file.size > MAX_BYTES) {
      setProblem("Photo too large. The limit is 7.5 MB: take it at normal quality, not RAW.");
      return;
    }
    const mimeType = MIMES.find((m) => m === file.type);
    if (!mimeType) {
      setProblem("Unsupported format. Use a JPEG, PNG, WebP or HEIC photo.");
      return;
    }
    setStep("uploading");
    let url: string;
    try {
      const base64 = await readBase64(file);
      ({ url } = await upload.mutateAsync({ base64, filename: file.name || "shop-photo.jpg", mimeType }));
    } catch {
      setUploadFailed(true);
      setStep("idle");
      return;
    }
    setPhotoUrl(url);
    await runCheck(url);
  };

  const onMakePicture = async () => {
    if (renderLock.current || !card) return;
    renderLock.current = true;
    setConfirming(false);
    setRendering(true);
    setBranded(null);
    setBrandFailure(null);
    try {
      const result = await brand.mutateAsync({ prompt: card.analysis.rebrandPrompt });
      if (result.ok) setBranded(result);
      else setBrandFailure("unavailable");
    } catch {
      setBrandFailure("error");
    } finally {
      renderLock.current = false;
      setRendering(false);
    }
  };

  const failureLine = offline ? CHECK_LINE.offline : checkFailure ? CHECK_LINE[checkFailure] : null;
  const a = card?.analysis;
  const prompt = a?.rebrandPrompt ?? "";
  const longPrompt = prompt.length > PROMPT_PREVIEW;
  const shownPrompt = longPrompt && !fullPrompt ? `${prompt.slice(0, PROMPT_PREVIEW)}...` : prompt;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-4 w-4" /> Photo check
        </CardTitle>
        <CardDescription className="text-base">
          Choose or take a shop photo and get a plain read on how it would work for marketing. Nothing is posted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-base">
        <div>
          <input
            ref={inputRef}
            type="file"
            aria-label="Photo file"
            accept={MIMES.join(",")}
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onPick(file);
            }}
          />
          <Button variant={card ? "outline" : "default"} className={btn} disabled={busy} onClick={() => inputRef.current?.click()}>
            Choose or take a photo
          </Button>
        </div>

        {problem && <p role="alert" className="break-words rounded-md border border-amber-500/40 p-3">{problem}</p>}

        {uploadFailed && (
          <div role="alert" className="space-y-1 rounded-md border border-amber-500/40 p-3">
            <p className="font-medium">Couldn't upload this photo</p>
            <p className="text-muted-foreground">Nothing was checked. Choose the photo again.</p>
          </div>
        )}

        {photoUrl && (
          <img src={photoUrl} alt="Photo being checked" className="max-h-48 w-auto max-w-full rounded-md border object-contain" />
        )}

        {step !== "idle" && !offline && (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>{step === "uploading" ? "Uploading the photo..." : "Checking the photo..."}</span>
          </p>
        )}

        {failureLine && photoUrl && (
          <div role="alert" className="space-y-3 rounded-md border border-amber-500/40 p-3">
            <div className="space-y-1">
              <p className="font-medium">Couldn't check this photo</p>
              <p className="break-words text-muted-foreground">{failureLine}</p>
            </div>
            <Button variant="outline" className={btn} onClick={() => void runCheck(photoUrl)}>
              Retry
            </Button>
          </div>
        )}

        {card && a && (
          <section aria-label="Photo scorecard" className="space-y-4">
            <div>
              <p className="text-muted-foreground">Model's read of this photo</p>
              <p className="text-3xl font-semibold tabular-nums">{a.scores.overall} of 100</p>
              <p className="break-words text-muted-foreground">Model: {card.model}</p>
            </div>

            <ul className="divide-y divide-border">
              {(
                [
                  ["Lighting", a.scores.lighting],
                  ["Framing", a.scores.framing],
                  ["Brand presence", a.scores.brandPresence],
                  ["Cleanliness", a.scores.cleanliness],
                  ["Professional polish", a.scores.professionalPolish],
                ] as const
              ).map(([label, value]) => (
                <li key={label} className="flex items-baseline justify-between gap-3 py-2">
                  <span>{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <div>
                <p className="text-muted-foreground">Subject</p>
                <p className="break-words">{a.subject}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mood</p>
                <p className="break-words">{a.currentMood}</p>
              </div>
            </div>

            <div>
              <p className="font-medium">Issues</p>
              {a.issues.length === 0 ? (
                <p className="text-muted-foreground">The model listed no issues.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  {a.issues.map((issue) => (
                    <li key={issue} className="break-words">{issue}</li>
                  ))}
                </ul>
              )}
            </div>

            {a.improvements.length > 0 && (
              <div>
                <p className="font-medium">What to change</p>
                <ul className="space-y-2">
                  {a.improvements.map((item) => (
                    <li key={`${item.type}-${item.instruction}`} className="break-words">
                      <span className="mr-2 font-medium">{PRIORITY[item.priority]}</span>
                      <span>{item.instruction}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="font-medium">Best for: {BEST_FOR[a.marketingFit.best]}</p>
          </section>
        )}

        {card && a && (
          <div className="space-y-3 border-t pt-4">
            {rendering && (
              <p role="status" className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span>Making the picture. This can take a minute.</span>
              </p>
            )}

            {brandFailure && (
              <div role="alert" className="space-y-1 rounded-md border border-amber-500/40 p-3">
                <p className="font-medium">Couldn't make the picture</p>
                <p className="break-words text-muted-foreground">
                  {brandFailure === "unavailable"
                    ? "The picture couldn't be made right now. Try again in a minute."
                    : "The request didn't finish, so it may have used an image credit. Check before trying again."}
                </p>
              </div>
            )}

            {branded && (
              <figure className="space-y-2">
                <img src={branded.imageUrl} alt="Branded picture" className="h-auto max-w-full rounded-md border" />
                <figcaption className="space-y-1 text-muted-foreground">
                  <p>Preview only. Nothing was posted.</p>
                  <p className="break-words">Model: {branded.model}</p>
                </figcaption>
                <a
                  href={branded.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-12 items-center underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Open full size
                </a>
              </figure>
            )}

            {confirming ? (
              <div role="group" aria-label="Confirm branded picture" className="space-y-3 rounded-md border p-3">
                <p>Creates one new branded picture of a similar scene. It is not your photo edited. Uses one image credit.</p>
                <div className="space-y-1">
                  <p className="text-muted-foreground">What will be drawn</p>
                  <p className="break-words">{shownPrompt}</p>
                  {longPrompt && (
                    <Button variant="outline" className={btn} onClick={() => setFullPrompt((v) => !v)}>
                      {fullPrompt ? "Show less" : "Show full prompt"}
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className={btn} onClick={() => void onMakePicture()}>Make the picture</Button>
                  <Button variant="outline" className={btn} onClick={() => { setConfirming(false); setFullPrompt(false); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              !rendering && (
                <Button variant="outline" className={btn} disabled={busy} onClick={() => setConfirming(true)}>
                  {branded ? "Make another version" : "Make a branded version"}
                </Button>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
