import React from "react";
import { BRAND } from "../brand";

export interface ServiceWarningProps {
  title: string;
  subtitle: string;
  items: string[];
  criticalLevel?: "low" | "medium" | "high";
  cta?: string;
}

export const ServiceWarning: React.FC<ServiceWarningProps> = ({
  title,
  subtitle,
  items,
  criticalLevel = "medium",
  cta = "Schedule Inspections • Nick's Tire & Auto",
}) => {
  // Select color token based on critical level
  const statusColor =
    criticalLevel === "high"
      ? BRAND.colors.statusRed
      : criticalLevel === "medium"
      ? BRAND.colors.statusYellow
      : BRAND.colors.gold;

  const statusLabel =
    criticalLevel === "high"
      ? "CRITICAL WARNING"
      : criticalLevel === "medium"
      ? "MAINTENANCE ADVISORY"
      : "VEHICLE HEALTH TIP";

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
      {/* Top Header Eyebrow Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 16px",
            backgroundColor: `${statusColor}15`, // 8% opacity tint
            border: `1.5px solid ${statusColor}`,
            borderRadius: "20px",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: statusColor,
              marginRight: "10px",
            }}
          />
          <div
            style={{
              fontFamily: BRAND.fonts.display,
              fontSize: "14px",
              fontWeight: 700,
              color: statusColor,
              letterSpacing: "1.5px",
            }}
          >
            {statusLabel}
          </div>
        </div>
        <div
          style={{
            fontSize: "14px",
            color: BRAND.colors.textTertiary,
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          Diagnostic Alert
        </div>
      </div>

      {/* Main Heading and Subtitle */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginBottom: "40px",
        }}
      >
        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontSize: "48px",
            fontWeight: 700,
            color: BRAND.colors.textPrimary,
            textTransform: "uppercase",
            lineHeight: "1.1",
            letterSpacing: "-0.5px",
            marginBottom: "12px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: "18px",
            color: BRAND.colors.textSecondary,
            lineHeight: "1.4",
          }}
        >
          {subtitle}
        </div>
      </div>

      {/* Warning Checklist Grid (Flex vertical column) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
          gap: "24px",
          backgroundColor: BRAND.colors.bgRaised,
          border: `1px solid ${BRAND.colors.borderDefault}`,
          borderRadius: "12px",
          padding: "40px",
          marginBottom: "45px",
        }}
      >
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "flex-start",
              width: "100%",
            }}
          >
            {/* Warning Check Bullet Icon */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                backgroundColor: `${statusColor}18`,
                border: `1.5px solid ${statusColor}`,
                marginRight: "18px",
                flexShrink: 0,
                marginTop: "2px",
                fontFamily: BRAND.fonts.display,
                fontSize: "16px",
                fontWeight: 700,
                color: statusColor,
              }}
            >
              !
            </div>
            {/* Warning Text */}
            <div
              style={{
                fontSize: "20px",
                lineHeight: "1.4",
                color: BRAND.colors.textPrimary,
                fontWeight: 500,
              }}
            >
              {item}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Call to Action Block */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `1px solid ${BRAND.colors.borderDefault}`,
          paddingTop: "24px",
          width: "100%",
        }}
      >
        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontSize: "18px",
            fontWeight: 700,
            color: BRAND.colors.gold,
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          {cta}
        </div>
        <div
          style={{
            fontSize: "13px",
            color: BRAND.colors.textTertiary,
          }}
        >
          Cleveland &bull; Euclid
        </div>
      </div>
    </div>
  );
};
