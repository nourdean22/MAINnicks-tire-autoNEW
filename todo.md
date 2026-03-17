# Nick's Tire & Auto — Website Feature Build

## Requested
- [x] Booking form (online appointment request)
- [x] 6 dedicated service pages (/tires, /brakes, /diagnostics, /emissions, /oil-change, /general-repair)
- [x] Weather-reactive alert system (live Cleveland weather → notification bar override)

## Additional High-Impact Features
- [x] LocalBusiness JSON-LD schema markup (Google rich results)
- [x] Service-specific JSON-LD for each service page
- [ ] FAQ schema markup on common problems section
- [ ] Open Graph + Twitter meta tags for social sharing
- [ ] Sitemap page listing all service pages
- [ ] Blog/Tips page shell for SEO content
- [ ] Shop gallery section with real work photos
- [ ] "Why Choose Us" stats counter section (animated numbers)
- [ ] Speed optimization (lazy loading, image optimization)
- [ ] 404 page with brand styling
- [ ] Accessibility improvements (ARIA labels, skip nav)

## Phase 2 — New Features
- [x] Fix business hours site-wide: Mon-Sat 8AM-6PM, Sunday 9AM-4PM
- [x] Admin dashboard for booking management (view, confirm, complete, cancel)
- [x] Blog/tips section with SEO-optimized maintenance articles
- [x] Google Business Profile integration for live review data

## Phase 3 — Automated Content System
- [x] Database tables for dynamic content (blog posts, tips, seasonal promos)
- [x] AI content generation endpoint using built-in LLM (generates blog posts, tips, notification bar messages)
- [x] Seasonal content rotation system (auto-detects season → rotates relevant tips/promos)
- [x] Weather-aware promotional messaging (ties weather alerts to relevant service promos)
- [x] Dynamic notification bar that pulls from database instead of hardcoded rotation
- [x] Admin content management page (view, edit, approve/reject AI-generated content)
- [x] Scheduled task to auto-generate fresh content weekly

## Phase 4 — Enterprise Integration & Lead System
- [x] Lead capture popup with smart exit-intent and scroll triggers
- [x] Leads database table with contact info, source, and status tracking
- [x] Google Sheets CRM integration (auto-sync leads with contacted/not-contacted status)
- [x] Gemini AI integration for intelligent lead scoring and vehicle diagnosis chat
- [x] AI-powered customer chat assistant on the website
- [x] Instagram feed section on homepage (live from @nicks_tire_euclid)
- [x] Instagram feed endpoint pulling real posts via MCP
- [x] Smart appointment suggestions based on vehicle/season
- [x] Enhanced admin dashboard with lead management and call tracking
- [x] Automated Google Sheets sync for bookings + leads

## Phase 5 — Color & Vibe Redesign
- [x] Brighten color palette with more vibrant shop colors
- [x] Add warm, fun, chill energy to the overall design
- [x] Update CSS theme variables for brighter, more energetic look
- [x] Update component styles across all pages for consistency

## Phase 6 — SEO Fixes
- [x] Add meta keywords to homepage
- [x] Optimize page title to 30-60 characters
- [x] Add alt text to all images missing it (3 of 11)

## Phase 7 — Daily Instagram Story Automation
- [x] Set up daily recurring task to generate and publish fresh Instagram story series every 24 hours

## Phase 8 — AI-Powered Search Bar
- [x] Build AI search backend endpoint using LLM for natural language understanding
- [x] Build search bar UI component with instant results dropdown
- [x] Integrate search bar into navbar across all pages
- [x] Test search functionality with various queries

## Phase 9 — Backend Access Guide & AI Memory Document
- [x] Create backend access guide (database, admin dashboard, Google Sheets, manual editing)
- [x] Create comprehensive AI memory document for ChatGPT and Gemini

## Phase 10 — Audit Fixes & SEO Upgrades
- [x] Fix Google Reviews Place ID (NOT_FOUND error)
- [x] Add Open Graph and Twitter Card meta tags
- [x] Generate and add favicon
- [x] Add LocalBusiness JSON-LD structured data to homepage
- [x] Fix sitemap: add blog posts, exclude admin pages

## Phase 11 — Bi-Weekly Automated Maintenance System
- [x] Design automation playbook (content generation, health checks, error fixing)
- [x] Schedule bi-weekly automated task

## Phase 12 — Autonomous Instagram Content Automation
- [x] Set up combined scheduled task: 2 daily posts (9AM, 4PM ET) + 3 daily stories (10AM, 1PM, 5PM ET)
- [x] Auto-generate images, captions, and publish without approval
- [x] Rotate content types: problem-solution, repair explanations, diagnostics, seasonal advice, trust signals

## Phase 13 — Critical Bug Fixes
- [x] Fix Google Sheets CRM sync shell escaping bug (bookings and leads not syncing)
- [x] Backfill existing bookings and leads from database to Google Sheets
- [x] Remove "Topic Not Suitable" bad article from database

## Phase 14 — SEO Audit Fixes (from external audit report)
- [x] CRITICAL: Fix wrong phone number on /brakes (verified correct: 216-862-0005 throughout)
- [x] CRITICAL: Fix broken CTAs on /emissions (verified working: CALL NOW + BOOK ONLINE)
- [x] Homepage: Reduce keywords from 12 to 7 focused
- [x] Homepage: Rewrite title tag to include location + service + phone
- [x] Homepage: Meta description already exists in index.html
- [x] Homepage: Fix H1 to "CLEVELAND'S TRUSTED AUTO REPAIR SHOP"
- [x] Service page title tags already unique and non-cannibalized
- [x] Meta descriptions already on all service pages
- [x] Create /contact page (address, phone, hours, map, form)
- [x] Create /about page (business story, team, philosophy, warranty)
- [x] Navigation menu links to /about and /contact standalone pages
- [x] Internal links from homepage service cards to /tires, /brakes, etc.
- [x] FAQPage schema markup already on all service pages
- [x] Fix Emissions H1 to "OHIO E-CHECK & EMISSIONS EXPERTS"
- [x] Tires H1 already tire-specific: "CLEVELAND'S TIRE EXPERTS"
- [x] Make trust paragraphs unique per service page (6 unique versions)
- [x] Replace overused phrase "If something does not feel right" with unique per-service text
- [x] Link 1683+ Reviews to Google Business Profile
- [x] Fix homepage primary CTA to "CALL FOR A FREE QUOTE"
- [x] Add warranty/guarantee language to all service pages
- [x] Fix schema URL from manus.space to nickstire.org

## Phase 15 — Sitemap & Google Search Console
- [x] Create sitemap.xml with all pages (homepage, services, about, contact, blog)
- [x] Update robots.txt to reference sitemap
- [x] Write tests for sitemap generation (13 tests passing)
- [x] Provide Google Search Console submission instructions
