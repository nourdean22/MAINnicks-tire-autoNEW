import React from "react";
import { BRAND } from "../brand";

export interface GooglePostProps {
  badge: string;
  title: string;
  details: string;
  promoCode?: string;
  expiry?: string;
}

export const GooglePost: React.FC<GooglePostProps> = ({
  badge,
  title,
  details,
  promoCode,
  expiry,
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        backgroundColor: BRAND.colors.bgVoid,
        color: BRAND.colors.textPrimary,
        fontFamily: BRAND.fonts.body,
        padding: "50px",
        boxSizing: "border-box",
        alignItems: "stretch",
        justifyContent: "space-between",
      }}
    >
      {/* Left Details Panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "60%",
          justifyContent: "space-between",
        }}
      >
        {/* Eyebrow Badge */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              alignSelf: "flex-start",
              padding: "6px 14px",
              backgroundColor: `${BRAND.colors.gold}20`,
              border: `1px solid ${BRAND.colors.gold}`,
              borderRadius: "4px",
              fontFamily: BRAND.fonts.display,
              fontSize: "13px",
              fontWeight: 700,
              color: BRAND.colors.gold,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginBottom: "24px",
            }}
          >
            {badge}
          </div>

          {/* Main Title */}
          <div
            style={{
              fontFamily: BRAND.fonts.display,
              fontSize: "44px",
              fontWeight: 700,
              color: BRAND.colors.textPrimary,
              textTransform: "uppercase",
              lineHeight: "1.1",
              letterSpacing: "-0.5px",
              marginBottom: "16px",
            }}
          >
            {title}
          </div>

          {/* Detailed Paragraph */}
          <div
            style={{
              fontSize: "18px",
              color: BRAND.colors.textSecondary,
              lineHeight: "1.5",
              fontWeight: 400,
            }}
          >
            {details}
          </div>
        </div>

        {/* Footer Details (Promo Code & Expiry) */}
        <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
          {promoCode && (
            <div
              style={{
                padding: "8px 16px",
                border: `1.5px dashed ${BRAND.colors.gold}`,
                borderRadius: "4px",
                fontFamily: BRAND.fonts.display,
                fontSize: "16px",
                fontWeight: 700,
                color: BRAND.colors.gold,
                backgroundColor: BRAND.colors.bgRaised,
              }}
            >
              {promoCode.toUpperCase()}
            </div>
          )}
          {expiry && (
            <div
              style={{
                fontSize: "14px",
                color: BRAND.colors.textTertiary,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {expiry}
            </div>
          )}
        </div>
      </div>

      {/* Right Brand Badge Panel */}
      <div
        style={{
          display: "flex",
          width: "35%",
          backgroundColor: BRAND.colors.bgRaised,
          border: `1px solid ${BRAND.colors.borderDefault}`,
          borderRadius: "8px",
          padding: "30px",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background diagonal stripe element */}
        <div
          style={{
            position: "absolute",
            top: "-50px",
            right: "-50px",
            width: "150px",
            height: "150px",
            backgroundColor: `${BRAND.colors.gold}04`,
            transform: "rotate(45deg)",
            border: `1px solid ${BRAND.colors.gold}08`,
          }}
        />

        {/* Top Logo text */}
        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontSize: "20px",
            fontWeight: 700,
            color: BRAND.colors.textSecondary,
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}
        >
          Nick's Tire
        </div>

        {/* Center Accent Icon (Tire Tread Graphic Placeholder) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontFamily: BRAND.fonts.display,
              fontSize: "64px",
              color: BRAND.colors.gold,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            N
          </div>
          <div
            style={{
              width: "40px",
              height: "3px",
              backgroundColor: BRAND.colors.gold,
              marginTop: "8px",
            }}
          />
        </div>

        {/* Bottom Location details */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: BRAND.colors.textTertiary,
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontWeight: 600,
            }}
          >
            Euclid &bull; Cleveland
          </div>
          <div
            style={{
              fontSize: "11px",
              color: BRAND.colors.textTertiary,
            }}
          >
            Since 1982
          </div>
        </div>
      </div>
    </div>
  );
};
