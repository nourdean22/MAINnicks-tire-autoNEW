/**
 * SkylineDivider — Cleveland skyline silhouette as a section divider.
 *
 * Replaces generic top/bottom borders between key sections with an SVG
 * silhouette of downtown Cleveland — Terminal Tower's pyramid top, Key
 * Tower's slim modern profile, Sherwin-Williams HQ, the Rocket Mortgage
 * tower, and a few smaller buildings. Reads as authentic local instead
 * of generic SaaS wave-divider.
 *
 * Pure inline SVG, no external file. ~2KB. Asymmetric (no AI-slop
 * symmetry). Honors color via currentColor — caller controls tint.
 *
 * Usage:
 *   <SkylineDivider />                           // default thin gold
 *   <SkylineDivider tone="dim" flip />           // upside-down + dim
 *   <SkylineDivider className="text-foreground/30" />
 */

export interface SkylineDividerProps {
  /** Visual tone — affects opacity + default color */
  tone?: "gold" | "dim" | "ghost";
  /** Flip vertically (skyline hangs from the top instead of standing on the bottom) */
  flip?: boolean;
  /** Override className for fine control */
  className?: string;
  /** Override height in pixels — default 56 */
  height?: number;
}

const TONE_COLORS: Record<NonNullable<SkylineDividerProps["tone"]>, string> = {
  gold: "#FDB913",
  dim: "rgba(255,255,255,0.16)",
  ghost: "rgba(255,255,255,0.08)",
};

const TONE_OPACITY: Record<NonNullable<SkylineDividerProps["tone"]>, number> = {
  gold: 0.55,
  dim: 1,
  ghost: 1,
};

export function SkylineDivider({
  tone = "dim",
  flip = false,
  className,
  height = 56,
}: SkylineDividerProps) {
  return (
    <div
      aria-hidden="true"
      className={`w-full overflow-hidden pointer-events-none ${className ?? ""}`}
      style={{
        height,
        transform: flip ? "scaleY(-1)" : undefined,
        opacity: TONE_OPACITY[tone],
        color: TONE_COLORS[tone],
      }}
    >
      <svg
        viewBox="0 0 1440 56"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Path drawn at 1440x56. Order roughly mirrors the actual
            downtown lakefront west→east: Powerhouse → West Bank
            warehouses → Detroit-Superior bridge piers → Sherwin-
            Williams HQ → Tower City / Terminal Tower (pyramid) →
            Key Tower (tallest spire) → 200 Public Square → Rocket
            Mortgage FieldHouse → Progressive Field → ArtCraft +
            stadium silhouette → east-bank lakefront warehouses. */}
        <path
          fill="currentColor"
          d="
            M0,56
            L0,46
            L60,46 L60,38 L90,38 L90,46
            L140,46 L140,32 L180,32 L180,46
            L230,46 L230,28 L260,28 L260,46
            L300,46 L300,22 L335,22 L335,46
            L380,46 L380,18 L398,18 L398,8 L420,8 L420,18 L440,18 L440,46
            L500,46 L500,30 L535,30 L535,46
            L580,46 L580,14 L600,14 L600,2 L620,2 L620,14 L640,14 L640,46
            L700,46 L700,26 L740,26 L740,18 L760,18 L760,26 L800,26 L800,46
            L860,46 L860,34 L890,34 L890,46
            L935,46 L935,24 L975,24 L975,46
            L1020,46 L1020,16 L1045,16 L1045,8 L1062,8 L1062,16 L1085,16 L1085,46
            L1135,46 L1135,30 L1170,30 L1170,46
            L1215,46 L1215,38 L1245,38 L1245,46
            L1290,46 L1290,28 L1325,28 L1325,46
            L1372,46 L1372,34 L1404,34 L1404,46
            L1440,46
            L1440,56
            Z
          "
        />
      </svg>
    </div>
  );
}

export default SkylineDivider;
