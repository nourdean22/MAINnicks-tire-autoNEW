# Booking Route Truth

## Canonical URL: /appointment
Alternate: /booking (renders same BookingPage component)

Both routes exist in App.tsx and render BookingPage with BookingWizard.
Most pages also embed BookingForm inline via `#booking` anchor at the bottom.

## Links
- Footer top bar: `/booking` -> BookingPage
- Footer nav: `/appointment` -> BookingPage
- Homepage hero CTA: `#booking` -> inline BookingForm on homepage
- Homepage trust section: `/booking` -> BookingPage
- Service pages: `#booking` -> inline BookingForm on page
- City/Neighborhood pages: `#booking` -> inline BookingForm on page

## What was fixed (March 29, 2026)
- Created BookingPage.tsx with SiteNavbar + BookingWizard + SiteFooter
- Added /appointment and /booking routes to App.tsx
- Added /booking to route registry (sitemap=false, prerender=true)
- /appointment was already in route registry
