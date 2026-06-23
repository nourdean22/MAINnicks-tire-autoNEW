import React from "react";
import { BRAND } from "../brand";

export interface ReviewCardProps {
  author: string;
  text: string;
  rating?: number;
  date?: string;
  source?: string;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  author,
  text,
  rating = 5,
  date = "Verified Review",
  source = "Google Business Profile",
}) => {
  // Generate star characters (e.g., "★★★★★")
  const starsStr = "★".repeat(Math.min(5, Math.max(1, rating))) + "☆".repeat(Math.max(0, 5 - rating));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: BRAND.colors.bgVoid,
        color: BRAND.colors.textPrimary,
        fontFamily: BRAND.fonts.body,
        padding: "60px",
        justifyContent: "space-between",
        boxSizing: "border-box",
      }}
    >
      {/* Decorative Border / Corner Gold Accents */}
      <div
        style={{
          position: "absolute",
          top: "30px",
          left: "30px",
          width: "40px",
          height: "40px",
          borderTop: `3px solid ${BRAND.colors.gold}`,
          borderLeft: `3px solid ${BRAND.colors.gold}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "30px",
          right: "30px",
          width: "40px",
          height: "40px",
          borderTop: `3px solid ${BRAND.colors.gold}`,
          borderRight: `3px solid ${BRAND.colors.gold}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          left: "30px",
          width: "40px",
          height: "40px",
          borderBottom: `3px solid ${BRAND.colors.gold}`,
          borderLeft: `3px solid ${BRAND.colors.gold}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          right: "30px",
          width: "40px",
          height: "40px",
          borderBottom: `3px solid ${BRAND.colors.gold}`,
          borderRight: `3px solid ${BRAND.colors.gold}`,
        }}
      />

      {/* Card Body */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          border: `1px solid ${BRAND.colors.borderDefault}`,
          backgroundColor: BRAND.colors.bgRaised,
          padding: "50px",
          borderRadius: "12px",
          position: "relative",
        }}
      >
        {/* Rating Stars & Source */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            marginBottom: "30px",
          }}
        >
          <div
            style={{
              fontFamily: BRAND.fonts.display,
              fontSize: "32px",
              color: BRAND.colors.gold,
              letterSpacing: "2px",
            }}
          >
            {starsStr}
          </div>
          <div
            style={{
              fontSize: "14px",
              color: BRAND.colors.textTertiary,
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            {source}
          </div>
        </div>

        {/* Testimonial Quote Text */}
        <div
          style={{
            display: "flex",
            fontSize: text.length > 150 ? "28px" : "36px",
            lineHeight: "1.45",
            color: BRAND.colors.textPrimary,
            textAlign: "center",
            marginBottom: "40px",
            fontWeight: 400,
            fontStyle: "italic",
            justifyContent: "center",
          }}
        >
          &ldquo;{text}&rdquo;
        </div>

        {/* Divider */}
        <div
          style={{
            width: "80px",
            height: "2px",
            backgroundColor: BRAND.colors.gold,
            opacity: 0.8,
            marginBottom: "30px",
          }}
        />

        {/* Customer Info (Author) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: BRAND.fonts.display,
              fontSize: "24px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: BRAND.colors.gold,
              marginBottom: "6px",
            }}
          >
            {author}
          </div>
          <div
            style={{
              fontSize: "14px",
              color: BRAND.colors.textSecondary,
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            {date}
          </div>
        </div>
      </div>
    </div>
  );
};
