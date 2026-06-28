import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface ReviewVideoReelProps {
  reviewerName: string;
  reviewText: string;
  stars: number;
  companyName?: string;
}

export const ReviewVideoReel: React.FC<ReviewVideoReelProps> = ({
  reviewerName,
  reviewText,
  stars,
  companyName = "Nick's Tire & Auto",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 1. Background animations
  const bgHue = interpolate(frame, [0, 450], [0, 360]);

  // 2. Title Entrance (0 to 30 frames)
  const titleSpring = spring({
    frame,
    fps,
    config: { damping: 12 },
  });
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);
  const titleTranslateY = interpolate(titleSpring, [0, 1], [50, 0]);

  // 3. Card Entrance (15 to 45 frames)
  const cardSpring = spring({
    frame: frame - 15,
    fps,
    config: { damping: 15, mass: 1.2 },
  });
  const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);
  const cardScale = interpolate(cardSpring, [0, 1], [0.8, 1]);
  const cardTranslateY = interpolate(cardSpring, [0, 1], [100, 0]);

  // 4. Stars Entrance (one by one, starting at frame 35)
  const starScales = Array.from({ length: 5 }).map((_, i) => {
    const starSpring = spring({
      frame: frame - 35 - i * 6,
      fps,
      config: { damping: 8, stiffness: 100 },
    });
    return interpolate(starSpring, [0, 1], [0, 1]);
  });

  // 5. Quote Text Typing / Entrance
  const textProgress = spring({
    frame: frame - 60,
    fps,
    config: { damping: 20 },
  });
  const textOpacity = interpolate(textProgress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b0c10",
        color: "#ffffff",
        fontFamily: "'Outfit', sans-serif",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px 60px",
        overflow: "hidden",
      }}
    >
      {/* Dynamic Font Loading */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');
        
        .bg-blob {
          position: absolute;
          width: 800px;
          height: 800px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(245,200,66,0.15) 0%, rgba(0,0,0,0) 70%);
          filter: blur(80px);
          z-index: 1;
        }
        
        .glass-card {
          background: rgba(25, 27, 31, 0.75);
          border: 1px solid rgba(245, 200, 66, 0.2);
          border-radius: 32px;
          padding: 50px 40px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
          backdrop-filter: blur(20px);
          z-index: 2;
        }

        .star-active {
          color: #f5c842;
        }

        .star-inactive {
          color: #3f444f;
        }
      `}</style>

      {/* Ambient Moving Blobs */}
      <div
        className="bg-blob"
        style={{
          top: "-200px",
          left: "-200px",
          transform: `translate(${Math.sin(frame / 60) * 80}px, ${Math.cos(frame / 60) * 80}px)`,
        }}
      />
      <div
        className="bg-blob"
        style={{
          bottom: "-200px",
          right: "-200px",
          transform: `translate(${Math.cos(frame / 80) * 100}px, ${Math.sin(frame / 80) * 100}px)`,
        }}
      />

      {/* Top Header */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleTranslateY}px)`,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            backgroundColor: "#f5c842",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: "#0b0c10",
            fontSize: "24px",
          }}
        >
          ★
        </div>
        <div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: "3px",
              color: "#8a94a6",
            }}
          >
            Customer Testimonial
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#f5c842",
            }}
          >
            {companyName}
          </div>
        </div>
      </div>

      {/* Main Review Card */}
      <div
        className="glass-card"
        style={{
          opacity: cardOpacity,
          transform: `scale(${cardScale}) translateY(${cardTranslateY}px)`,
        }}
      >
        {/* Large Quote Mark */}
        <div
          style={{
            fontSize: "120px",
            fontFamily: "Georgia, serif",
            lineHeight: 0,
            marginTop: "40px",
            color: "rgba(245, 200, 66, 0.15)",
            pointerEvents: "none",
          }}
        >
          “
        </div>

        {/* Review Text */}
        <div
          style={{
            fontSize: "44px",
            fontWeight: 600,
            lineHeight: "1.4",
            color: "#ffffff",
            marginBottom: "40px",
            minHeight: "260px",
            opacity: textOpacity,
          }}
        >
          {reviewText}
        </div>

        {/* Stars */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "30px",
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className={i < stars ? "star-active" : "star-inactive"}
              style={{
                fontSize: "48px",
                display: "inline-block",
                transform: `scale(${starScales[i]})`,
              }}
            >
              ★
            </span>
          ))}
        </div>

        {/* Border line */}
        <div
          style={{
            height: "1px",
            backgroundColor: "rgba(255,255,255,0.08)",
            margin: "30px 0",
          }}
        />

        {/* Reviewer Name */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              backgroundColor: "rgba(245, 200, 66, 0.1)",
              border: "1px solid rgba(245, 200, 66, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              color: "#f5c842",
              fontSize: "24px",
            }}
          >
            {reviewerName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: "28px", fontWeight: 800, color: "#ffffff" }}>
              {reviewerName}
            </div>
            <div style={{ fontSize: "20px", color: "#f5c842", fontWeight: 600 }}>
              Verified Customer
            </div>
          </div>
        </div>
      </div>

      {/* Footer Branding */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${-titleTranslateY}px)`,
          textAlign: "center",
          fontSize: "18px",
          color: "#8a94a6",
          letterSpacing: "4px",
          textTransform: "uppercase",
          zIndex: 2,
        }}
      >
        Real Reviews · Real Quality
      </div>
    </AbsoluteFill>
  );
};
