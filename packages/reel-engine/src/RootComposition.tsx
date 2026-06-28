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
        defaultProps={{
          reviewerName: "John Doe",
          reviewText: "Great customer service! The team was super fast and very transparent about pricing. Will definitely bring my car back.",
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
          alertTitle: "Pothole Season Warning",
          alertDetails: "Early spring temperatures cause road surfaces to crack. Hit a deep pothole? Bring your car in for a free wheel alignment inspection.",
          location: "Chicago Metro Area",
          companyName: "Nick's Tire & Auto",
        } as ServiceAlertReelProps}
      />
    </>
  );
};
