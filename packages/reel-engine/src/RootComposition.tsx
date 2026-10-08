import React from "react";
import { Composition } from "remotion";
import { ReviewVideoReel, ReviewVideoReelProps } from "./compositions/ReviewVideoReel.js";
import { ServiceAlertReel, ServiceAlertReelProps } from "./compositions/ServiceAlertReel.js";

export const RootComposition: React.FC = () => {
  return (
    <>
      <Composition
        id="ReviewVideoReel"
        component={ReviewVideoReel as any}
        durationInFrames={450} // 15 seconds at 30 fps
        fps={30}
        width={1080}
        height={1920}
        // Studio preview only: the worker always passes every prop (apps/worker/src/renderPlan.ts),
        // so these never reach a render. Placeholders, never a sample review or an offer.
        defaultProps={{
          reviewerName: "PREVIEW",
          reviewText: "Preview placeholder. A real render shows the review exactly as the reviewer wrote it.",
          stars: 5,
          companyName: "Nick's Tire & Auto",
        } as ReviewVideoReelProps}
      />
      <Composition
        id="ServiceAlertReel"
        component={ServiceAlertReel as any}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          alertTitle: "PREVIEW",
          alertDetails: "Preview placeholder. A real render shows the approved alert text.",
          location: "Cleveland, OH",
          companyName: "Nick's Tire & Auto",
        } as ServiceAlertReelProps}
      />
    </>
  );
};
