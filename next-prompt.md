A high-converting, cinematic dark industrial home page for Nick's Tire & Auto, utilizing bold typography, gold accents, and live conversion-architecture widgets.

**DESIGN SYSTEM (REQUIRED):**
- **Platform:** Web, Mobile-first responsive
- **Theme:** Dark Industrial, sophisticated, high-contrast, clean & minimal with generous whitespace
- **Typography:**
  - Headings/Display: Bold Industrial 'Barlow Condensed' (#font-heading) / 'Oswald'
  - Body Text: Clean & highly readable 'DM Sans' (#font-sans)
  - Numbers/Stats: Monospace 'JetBrains Mono' (#font-mono) for clean alignment
- **Color Palette:**
  - Background: Deep Black (#0A0A0A) for the page base
  - Surfaces/Cards: Dark Charcoal (#141414) for panels, containers, and modules
  - Borders/Secondary Surfaces: Steel Gray (#222222) for clean layout boundaries
  - Primary Accent: Brand Yellow/Gold (#FDB913) for primary CTA buttons, active states, stars, and highlights
  - Text Primary: Off-White/Light Gray (#F5F5F5) for clear contrast
  - Text Secondary: Muted Gray (#9ca3af) for descriptions and metadata
- **Layout Tokens:**
  - Buttons: Subtly rounded (8px), solid gold background with dark text, hover transition with slight scaling
  - Cards: Gently rounded corners (12px), 1px solid steel borders (#222222), soft shadows for visual elevation

**Page Structure:**

1. **Header Navigation:**
   - Left: Minimalist text logo "Nick's Tire & Auto"
   - Center/Right: Quick links (Tires, Brakes, Diagnostics, Contact) + Primary Phone CTA "Call (216) 862-0005" in Brand Gold (#FDB913)
   - Sticky blur behavior: semi-translucent deep black (#0A0A0A/95) with backdrop filter blur

2. **Cinematic Hero Section:**
   - Full-bleed ambient backdrop: High-quality Cleveland shopfront image with dark gradient overlay (left-aligned dark gradient to preserve text contrast on the left side)
   - Left Column Content:
     - Eyebrow: "CLEVELAND'S HONEST FCFS SHOP" in uppercase gold monospace
     - H1 Heading: "PULL UP FOR TIRES. DROP OFF FOR REPAIRS." in Barlow Condensed (uppercase, bold, with gold accent words)
     - Subline: "No appointments required. Same-day tire installation and brake service."
     - Symptom Search Form: A clean input field placeholder ("Squeaking brakes, check engine light...") with a search button that redirects to the diagnostic wizard
   - Right Column Content:
     - Real-Time Shop Status Widget: Live indicator showing "OPEN • Walk-Ins Welcome" with current bay capacity or FCFS wait status

3. **Trust & Proof Strip:**
   - Row of raw-number stats and credentials centered:
     - Google rating: "4.9 ★ (1,200+ Reviews)" linked to Google Business Profile
     - Dynamic Visitor Count: "Live: 5 drivers browsing service slots right now"

4. **Service Triage Grid:**
   - 4-card grid layout with hover zoom effects on background images:
     - **Tires:** Bold tread closeup background, text "New & Used Tires — Installed Today", CTA link
     - **Brakes:** Under-car brake repair background, text "Brake Check & Service", CTA link
     - **Diagnostics:** Service bay lift background, text "Check Engine Diagnostics", CTA link
     - **Maintenance:** Oil changes, suspension, and regular checkups

5. **Anchor Price Adjustment Table:**
   - Compare-and-contrast component with clean borders:
     - Compare Nick's honest $25 tire patch/repair vs. expensive $120+ wheel-and-tire replacement packages
     - Highlights the value proposition of "fixing only what is broken" with a prominent green "Save $95+" highlight badge

6. **Fear Calibration & Diagnostic Block:**
   - Interactive diagnostic section reassuring the user about their check engine light or vehicle symptoms, matching the Ollama-powered NickGPT capability:
     - "Describe your symptom to Nick AI. Get a quick estimation of severity (Safe to drive vs. Pull over immediately)."

7. **Reviews & Social Feed Carousel:**
   - Testimonial block showing real, verified Google reviews. Features the author's name, rating (5 yellow stars), service type, and clean quote layout.

8. **Footer & SEO Schema:**
   - Structured links, map embed placeholder, address details, and LocalBusiness JSON-LD markup integration hook.
