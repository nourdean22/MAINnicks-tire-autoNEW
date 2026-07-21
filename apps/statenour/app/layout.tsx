import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Barlow_Condensed, Instrument_Serif } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/command-palette";
import { PWAInstallPrompt } from "@/components/hud/pwa-install-prompt";
import { ServiceWorkerRegister } from "@/components/hud/sw-register";
import { ClientErrorTelemetry } from "@/components/ui/client-error-telemetry";
import { Toaster } from "sonner";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-barlow",
  display: "swap",
});

// v10.0.352 · editorial serif for the minimalist-ui §3 typographic
// rule (display sans paired with editorial serif for hero passages).
// Opt-in only via .text-editorial / .text-display-serif utility · no
// global override · the operator-grade dark identity stays intact.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-editorial",
  display: "swap",
});

// ── Render mode (2026-06-21 CSP fix) ──────────────────────────────────────
// Force every page dynamic. middleware.ts enforces script-src 'strict-dynamic'
// with a per-request nonce; a statically prerendered page ships with NO nonce,
// so the CSP then blocks ALL of its scripts -> blank/skeleton page in every
// browser. This hit `/`, all /(mastery) pages, and /voice. Dynamic rendering =
// a live nonce that matches the header. Applied at the ROOT so no future page
// can regress the same way. (No force-static pages remain to conflict.)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NOUR OS",
  description: "Personal operating system for disciplined execution.",
  applicationName: "NOUR OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NOUR OS",
  },
  // 2026-05-23 · Wave A · iOS Safari ignores the manifest's icons
  // array for the homescreen tile · it strictly requires
  // <link rel="apple-touch-icon">. Without this the install icon
  // is blank or a screenshot thumbnail. PNG is generated from
  // public/icon-nour.svg via scripts/generate-pwa-icons.ts.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-nour.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#050505",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable} ${barlowCondensed.variable} ${instrumentSerif.variable}`}>
      {/* v10.0.529.54 · removed `font-sans` (Tailwind's default stack)
          so the `body { font-family: var(--font-body) }` rule in
          globals.css resolves to Geist + sans-serif (no Inter fallback).
          Pre-fix the Tailwind utility overrode the contract font. */}
      <body className="antialiased bg-[var(--bg-void)] text-[var(--text-primary)]">
        <TooltipProvider delay={300}>
          {/* v11.1 · Client-side error telemetry. Passive — renders
              nothing. Captures window.onerror + unhandledrejection,
              posts to /api/errors → ErrorLog → visible on
              /system/errors. First line of defense against silent
              client crashes like today's X-Persona render loop. */}
          <ClientErrorTelemetry />
          {children}
          <CommandPalette />
          <PWAInstallPrompt />
          <ServiceWorkerRegister />
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "var(--bg-elevated)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-body)",
              },
            }}
            duration={4000}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
