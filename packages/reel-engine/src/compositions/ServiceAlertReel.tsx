import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface ServiceAlertReelProps {
  alertTitle: string;
  alertDetails: string;
  location?: string;
  companyName?: string;
}

export const ServiceAlertReel: React.FC<ServiceAlertReelProps> = ({
  alertTitle,
  alertDetails,
  location = "Local Road Safety",
  companyName = "Nick's Tire & Auto",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 1. Alert Pulse (continuous scale animation for warning triangle)
  const pulseScale = 1 + Math.sin(frame / 12) * 0.08;

  // 2. Entrance Animation for Alert Banner (0 to 30 frames)
  const bannerSpring = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 100 },
  });
  const bannerOpacity = interpolate(bannerSpring, [0, 1], [0, 1]);
  const bannerTranslateY = interpolate(bannerSpring, [0, 1], [-100, 0]);

  // 3. Danger Warning Triangle entrance (15 to 45 frames)
  const hazardSpring = spring({
    frame: frame - 15,
    fps,
    config: { damping: 12 },
  });
  const hazardOpacity = interpolate(hazardSpring, [0, 1], [0, 1]);
  const hazardScale = interpolate(hazardSpring, [0, 1], [0, pulseScale]);

  // 4. Details Card entrance (30 to 60 frames)
  const detailsSpring = spring({
    frame: frame - 30,
    fps,
    config: { damping: 15 },
  });
  const detailsOpacity = interpolate(detailsSpring, [0, 1], [0, 1]);
  const detailsTranslateY = interpolate(detailsSpring, [0, 1], [80, 0]);

  // 5. Road Warning Ticker (scrolling text bottom bar)
  const scrollOffset = interpolate(frame, [0, 450], [0, -1200]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0d0a0b",
        color: "#ffffff",
        fontFamily: "'Outfit', sans-serif",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px 60px",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');
        
        .alert-bg-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, rgba(255, 74, 74, 0.08) 0%, rgba(0,0,0,0) 50%, rgba(255, 74, 74, 0.08) 100%);
          z-index: 1;
        }

        .hazard-outer {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin-top: 60px;
          z-index: 2;
        }

        .alert-card {
          background: rgba(30, 20, 20, 0.8);
          border: 1px solid rgba(255, 74, 74, 0.3);
          border-radius: 28px;
          padding: 40px;
          box-shadow: 0 25px 50px rgba(0,0,0,0.6), 0 0 30px rgba(255, 74, 74, 0.1);
          backdrop-filter: blur(15px);
          z-index: 2;
        }

        .ticker-container {
          background: #ff4a4a;
          color: #0d0a0b;
          font-weight: 800;
          font-size: 24px;
          padding: 18px 0;
          width: 150%;
          margin-left: -25%;
          display: flex;
          white-space: nowrap;
          overflow: hidden;
          box-shadow: 0 -10px 35px rgba(255, 74, 74, 0.2);
          z-index: 2;
        }
      `}</style>

      {/* Warning Glow Ambient Overlay */}
      <div className="alert-bg-overlay" />

      {/* Top Banner Alert Info */}
      <div
        style={{
          opacity: bannerOpacity,
          transform: `translateY(${bannerTranslateY}px)`,
          zIndex: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "2px solid rgba(255, 74, 74, 0.2)",
          paddingBottom: "24px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "20px",
              color: "#ff4a4a",
              fontWeight: 800,
              letterSpacing: "4px",
              textTransform: "uppercase",
            }}
          >
            Safety Warning
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#ffffff" }}>
            {location}
          </div>
        </div>
        <div
          style={{
            fontSize: "22px",
            color: "#ffffff",
            backgroundColor: "rgba(255, 74, 74, 0.2)",
            border: "1px solid #ff4a4a",
            padding: "8px 16px",
            borderRadius: "10px",
            fontWeight: 600,
          }}
        >
          LIVE UPDATES
        </div>
      </div>

      {/* Hazard Warning Symbol Section */}
      <div
        className="hazard-outer"
        style={{
          opacity: hazardOpacity,
          transform: `scale(${hazardScale})`,
        }}
      >
        <svg
          width="200"
          height="180"
          viewBox="0 0 100 90"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ filter: "drop-shadow(0px 0px 15px rgba(255, 74, 74, 0.6))" }}
        >
          <path
            d="M50 5L93.3 80H6.7L50 5Z"
            stroke="#ff4a4a"
            strokeWidth="6"
            strokeLinejoin="round"
            fill="rgba(255, 74, 74, 0.15)"
          />
          <path
            d="M50 28V52"
            stroke="#ff4a4a"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="50" cy="65" r="4.5" fill="#ff4a4a" />
        </svg>
      </div>

      {/* Details Box */}
      <div
        className="alert-card"
        style={{
          opacity: detailsOpacity,
          transform: `translateY(${detailsTranslateY}px)`,
        }}
      >
        <div
          style={{
            fontSize: "36px",
            fontWeight: 800,
            color: "#ff4a4a",
            marginBottom: "16px",
            textTransform: "uppercase",
          }}
        >
          {alertTitle}
        </div>
        <div
          style={{
            fontSize: "26px",
            lineHeight: "1.5",
            color: "#e2e8f0",
            fontWeight: 400,
          }}
        >
          {alertDetails}
        </div>
      </div>

      {/* Ticker Tape Scrolling Footer */}
      <div
        className="ticker-container"
        style={{
          transform: `rotate(-1.5deg)`,
        }}
      >
        <div
          style={{
            display: "flex",
            transform: `translateX(${scrollOffset}px)`,
            gap: "50px",
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <span>⚠️ DRIVE CAREFULLY</span>
              <span style={{ opacity: 0.5 }}>•</span>
              <span>CHECK TIRE TREAD</span>
              <span style={{ opacity: 0.5 }}>•</span>
              <span>{companyName.toUpperCase()}</span>
              <span style={{ opacity: 0.5 }}>•</span>
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
