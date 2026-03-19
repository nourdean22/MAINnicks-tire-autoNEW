# Nick's Tire & Auto — Website Feature Build

## Requested
- [x] Booking form (online appointment request)
- [x] 6 dedicated service pages (/tires, /brakes, /diagnostics, /emissions, /oil-change, /general-repair)
- [x] Weather-reactive alert system (live Cleveland weather → notification bar override)

## Additional High-Impact Features
- [x] LocalBusiness JSON-LD schema markup (Google rich results)
- [x] Service-specific JSON-LD for each service page
- [x] FAQ schema markup on common problems section (+ standalone /faq page)
- [x] Open Graph + Twitter meta tags for social sharing
- [x] Sitemap page listing all service pages (dynamic sitemap.xml)
- [ ] Blog/Tips page shell for SEO content
- [ ] Shop gallery section with real work photos
- [ ] "Why Choose Us" stats counter section (animated numbers)
- [x] Speed optimization (lazy loading, font preloading, manifest)
- [x] 404 page with brand styling
- [x] Accessibility improvements (ARIA labels, skip nav, alt text)

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

## Phase 16 — Google Search Console Verification
- [x] Add GSC verification meta tag to index.html
- [x] Provide DNS TXT record instructions for easy.nickstire.org
- [x] Add second GSC verification meta tag (tAYYpz7i...) to index.html

## Phase 17 — Google Search Console Sitemap Submission & Indexing
- [x] Check available APIs/tools for GSC automation (browser-based, no API available)
- [x] Submit sitemap to Google Search Console (SUCCESS - 12 URLs discovered)
- [x] Request indexing for homepage (SUCCESS - already indexed, re-crawl requested)
- [ ] Request indexing for remaining pages (GSC rate-limited; will auto-crawl via sitemap within days)

## Phase 18 — Advanced Improvements (18 items)
### Tier 1 — SEO
- [x] 1. Canonical tags on every page (SEOHead component on all pages)
- [x] 2. City-specific landing pages (Euclid, Lakewood, Parma, East Cleveland)
- [x] 3. Breadcrumb navigation + BreadcrumbList schema (on all pages)
- [x] 4. Blog article schema improvements (author, publisher logo, dateModified)
### Tier 2 — Performance
- [x] 5. Lazy loading for below-the-fold images (loading="lazy" on all non-hero images)
- [x] 6. Font preloading for Oswald (preload link in index.html)
- [x] 7. Web app manifest (manifest.json with icons and theme color)
- [x] 8. Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS)
### Tier 3 — Conversion
- [x] 9. Click-to-call tracking (trackPhoneClick on all phone links)
- [x] 10. Sticky mobile CTA bar (on all pages including city and seasonal)
- [x] 11. Service page cross-links (OtherServices component already existed)
- [x] 12. Enhanced branded 404 page (dark theme, popular page links, phone CTA)
### Tier 4 — Accessibility
- [x] 13. Skip navigation link (SkipToContent on all pages)
- [x] 14. ARIA labels on interactive elements (nav, phone links, menu buttons)
- [x] 15. Improved image alt text (descriptive alt text on all images)
### Tier 5 — Advanced SEO
- [x] 16. Individual review schema markup (3 reviews in LocalBusiness schema)
- [x] 17. Standalone FAQ page (/faq with FAQPage schema, 15 questions, category filter)
- [x] 18. Seasonal landing pages (winter + summer car care with checklists)

## Phase 19 — SEO Expansion (Corrected Audit Gaps)
### Gap 1: Dedicated SEO Service Pages
- [x] /brake-repair-cleveland (unique content, FAQPage schema, symptom list)
- [x] /check-engine-light-cleveland (unique content, FAQPage schema, symptom list)
- [x] /tire-repair-cleveland (unique content, FAQPage schema, symptom list)
- [x] /suspension-repair-cleveland (unique content, FAQPage schema, symptom list)
- [x] /ac-repair-cleveland (unique content, FAQPage schema, symptom list)
- [x] /diagnostics-cleveland (unique content, FAQPage schema, symptom list)
### Gap 2: Vehicle Make Pages
- [x] /toyota-repair-cleveland (model-specific content, common issues, FAQPage schema)
- [x] /honda-repair-cleveland (model-specific content, common issues, FAQPage schema)
- [x] /ford-repair-cleveland (model-specific content, common issues, FAQPage schema)
- [x] /chevy-repair-cleveland (model-specific content, common issues, FAQPage schema)
### Gap 3: Problem-Specific Pages
- [x] /car-shaking-while-driving (diagnostic flowchart, causes, solutions)
- [x] /brakes-grinding (urgency messaging, safety warnings, repair process)
- [x] /check-engine-light-flashing (flashing vs steady, OBD-II codes, solutions)
- [x] /car-overheating (emergency steps, causes, cooling system repair)
### Gap 4: Enhanced Internal Linking
- [x] Footer links to city pages, vehicle makes, and common problems (Home + ServicePage)
- [x] Service → diagnostic page links via OtherServices component
- [x] Cross-link new pages from existing footers
- [x] Blog content generator updated to reference new SEO pages
### Gap 5: Blog Authority Expansion
- [x] Updated LLM prompt to include all 14 new SEO page routes in relatedServices
### Gap 6: More Repair Imagery
- [x] All new pages use existing CDN imagery (hero images, diagnostic images)
### Gap 7: Expanded FAQ Schema
- [x] Added 8 new FAQ questions: 4 problem-specific + 4 vehicle make-specific
- [x] FAQ page now has 23 total questions across 9 categories with FAQPage schema
- [x] All new SEO service, vehicle, and problem pages have their own FAQPage schema

## Phase 20 — Comprehensive Site Overhaul (CRO + SEO + UX + Trust)
### Domain
- [x] Bind easy.nickstire.org to current project (confirmed active)
### Homepage
- [x] Bind domain easy.nickstire.org (confirmed bound alongside nickstire.org, www.nickstire.org)
- [x] Strengthen hero copy: "CLEVELAND'S TRUSTED AUTO REPAIR SHOP" with trust stack
- [x] Improve CTA: "(216) 862-0005 — FREE ESTIMATE" + "BOOK APPOINTMENT"
- [x] Add trust proof: OPEN NOW badge, SAME-DAY SERVICE, WALK-INS WELCOME, 4.9 stars
- [x] Improve scannability: Common Problems accordion links to dedicated pages
- [x] Footer: city links, vehicle makes, common problems, FAQ, SEO service links
### Core Service Pages (Tires, Brakes, Diagnostics, Emissions)
- [x] Added turnaround badges ("Same-Day Service", "Most Repairs Same Day")
- [x] Added pricing transparency notes ("Starting at $XX" per service)
- [x] Added Warning Signs sections with service-specific symptoms
- [x] Added urgency alerts for safety-critical services
- [x] Added service-specific hero CTA text ("GET A BRAKE INSPECTION", etc.)
- [x] Added warranty/guarantee language to all service pages
- [x] Unique trust paragraphs per service page
### Secondary Pages
- [x] About page: footer updated with city links, resources, blog
- [x] Contact page: footer updated with city links, resources
- [x] FAQ: expanded to 23 questions across 9 categories with problem-specific and vehicle-specific items
### Technical SEO & Performance
- [x] Sitemap expanded to 47+ URLs (added 14 SEO pages: 6 service, 4 vehicle, 4 problem)
- [x] All canonical URLs point to nickstire.org
- [x] All schema URLs point to nickstire.org
- [x] SkipToContent on all 12 page types
- [x] ARIA labels on all interactive elements (54+ labels)
- [x] Internal linking: every footer links to city pages, services, resources
### Local SEO
- [x] 4 city landing pages with unique local content and testimonials
- [x] 4 vehicle make pages targeting "[make] repair cleveland"
- [x] 4 problem pages targeting "[symptom]" searches
- [x] 6 dedicated SEO service pages targeting long-tail keywords
- [x] Neighborhood tags on city pages
### Trust & CRO
- [x] Review callouts: hero badge, About section, city pages
- [x] Diagnostic framing: OBD-II expertise, "show you the problem before we fix it"
- [x] Click-to-call tracking on all phone links
- [x] Sticky mobile CTA bar on all pages
## Phase 21 — Full Functionality Check + Admin Dashboard Overhaul + GSC Update
### Functionality Verification
- [x] Verify homepage loads correctly with all sections
- [x] Verify all 6 service pages load and display correctly
- [x] Verify city, vehicle, problem, seasonal, SEO service pages load
- [x] Verify about, contact, FAQ, blog pages load
- [x] Verify admin page loads and functions
- [x] Check for console errors and broken links
### Admin Dashboard Overhaul
- [x] Audit current admin features and identify gaps
- [x] Add site analytics overview (page views, visitors, top pages)
- [x] Add lead management dashboard (view, filter, status, notes)
- [x] Add content management (blog articles, service content)
- [x] Add SEO overview (indexed pages, sitemap status, keyword tracking)
- [x] Add booking/appointment management
- [x] Add review monitoring section
- [x] Add quick actions (generate blog post, send notification, etc.)
- [x] Improve admin UI/UX with proper navigation and data visualization
### Google Search Console
- [x] Resubmit updated sitemap (33 URLs discovered on both properties)
- [x] Sitemap resubmitted on both easy.nickstire.org and nickstire.org (33 pages each, Success)

## Phase 22 — Comprehensive Google Search Console Optimization
### Audit
- [x] Audit easy.nickstire.org: sitemaps, indexing, coverage, page experience
- [x] Audit nickstire.org: sitemaps, indexing, coverage, page experience
- [x] Check Pages report for crawl errors and excluded pages (processing data — new properties)
### Indexing
- [x] Request indexing for easy.nickstire.org homepage (quota exceeded — continue tomorrow)
- [x] Request indexing for 8 key pages on nickstire.org (/, /tires, /brakes, /diagnostics, /emissions, /oil-change, /general-repair, /about)
### Page Experience & Enhancements
- [x] Check Core Web Vitals status (not enough data yet — new property)
- [x] Check mobile usability (no data yet — new property)
- [x] Check HTTPS status (valid on nickstire.org; easy.nickstire.org shows info warning)
- [x] Review structured data enhancements (Review snippets: 1 valid item detected on homepage)
### Technical
- [x] Verify robots.txt is optimized (blocks /admin, /admin/, /api/, /api; includes sitemap ref)
- [x] Verify sitemap includes all pages (dev: 40 URLs, production: 33 — needs republish)
- [x] Check for any security or manual action issues (no issues detected)

## Phase 23 — Google Business Profile Link Integration
- [x] Find Nick's Tire & Auto Google Business Profile URL (Nick's Tire And Auto Euclid, 4.9★, 1683 reviews)
- [x] Add GBP link to LocalBusiness structured data (JSON-LD) on all pages (Home, ServicePage, CityPage, VehicleMakePage, SEOServicePage, BlogPost)
- [x] Add GBP "Leave a Review" link in footer (homepage footer with review link)
- [x] Add GBP link on Contact page (review card + directions link + schema)
- [x] Add GBP map embed or link on About page (via shared const GBP_EMBED_URL)
- [x] Update sameAs property in schema.org markup with GBP URL (+ Instagram + Facebook on all page schemas)
- [x] Verify all changes compile and render correctly (8 GBP tests passing, TypeScript clean)

## Sprint 1 — Core Revenue Upgrades

### 1A: Booking System UI Overhaul
- [x] Redesign booking form as multi-step wizard (vehicle info → service → contact → confirmation)
- [x] Add vehicle year/make/model dropdowns
- [x] Add photo upload option for customers to show the problem
- [x] Keep first-come-first-serve model — no time slots
- [x] Confirmation message: "Request received. We'll reach out when your vehicle is next in line."
- [x] Admin side: sortable queue, drag-to-reorder jobs, priority indicators
- [x] Admin side: profit/priority tags on bookings
- [x] Mobile-responsive booking form

### 1B: What's Wrong With My Car Diagnostic Tool
- [x] Interactive symptom checker page at /diagnose
- [x] Customer picks symptoms (shaking, noise, light on, smell, etc.)
- [x] AI generates plain-language explanation of likely causes
- [x] Ends with "Come in for a free diagnostic inspection" + phone CTA + book online
- [x] Add to navigation and sitemap

### 1C: Live Reviews Showcase Page
- [x] Dedicated /reviews page pulling Google reviews
- [x] Filter by star rating
- [x] Featured/highlighted top reviews
- [x] Prominent "Leave a Review" CTA linking to GBP
- [x] Add to navigation and sitemap

## Sprint 2 — Customer Engagement & Retention Engine

### 2A: Coupon & Special Offers System
- [x] Create /specials page with active deals and seasonal promotions
- [x] Database table for coupons/offers (title, description, discount, expiry, terms)
- [x] Admin panel section to create/edit/expire coupons
- [x] Coupon display cards with expiry countdown timers
- [x] "Show this coupon" mobile-friendly display for in-shop use
- [x] Auto-expire past-due coupons
- [x] Add /specials to navigation and sitemap

### 2B: Customer Loyalty / Visit Tracker
- [x] "My Garage" section where returning visitors can save their vehicle info
- [x] Service history timeline (past bookings displayed)
- [x] Recommended maintenance schedule based on vehicle mileage
- [x] "Due for service" reminders based on last visit + mileage intervals
- [x] Personalized greeting for returning visitors

### 2C: Engagement Features
- [x] "Tip of the Day" rotating automotive tips on homepage (via Car Care Guide)
- [x] Social proof ticker: "John from Euclid just booked a brake inspection" (anonymized) — in NotificationBar
- [ ] Email capture with lead magnet: "Free Winter Car Care Checklist" PDF download
- [x] Referral program page: "Refer a friend, both get $25 off" at /refer

## Sprint 3 — Business Mastery & Operations Dashboard

### 3A: Advanced Admin Analytics
- [x] Revenue tracking dashboard (bookings by service type, weekly/monthly trends)
- [x] Customer acquisition funnel visualization (visits → leads → bookings → completed)
- [x] Top services breakdown chart (which services get booked most)
- [ ] Geographic heatmap of where customers come from (by city/zip)
- [x] Conversion rate tracking (page views → booking submissions)

### 3B: Automated Customer Communication
- [x] Booking status change notifications (confirmed, in-progress, completed) — via admin queue
- [ ] Post-service follow-up message ("How was your visit?")
- [ ] Review request automation (send review link after completed service)
- [ ] Seasonal maintenance reminders based on last service date

### 3C: Business Intelligence
- [ ] Weekly business summary report (auto-generated, emailed to owner)
- [ ] Competitor monitoring alerts (track local competitor reviews/ratings)
- [x] Customer satisfaction score tracking from review sentiment (via reviews page)
- [x] Peak hours analysis from booking data (via admin analytics)

## Sprint 4 — Trend-Setting & Market Domination

### 4A: Video & Rich Media Content
- [ ] "Shop Tour" virtual walkthrough section on About page
- [ ] Before/After repair gallery with slider comparison
- [ ] Technician spotlight profiles with photos and specialties
- [ ] Video testimonial embed section on Reviews page
(Sprint 4A deferred — requires real shop photos/videos)

### 4B: Community & Local Authority
- [x] "Cleveland Car Care Guide" resource hub at /car-care-guide (seasonal guides, mileage milestones, warning signs)
- [ ] Local events calendar (car shows, community events Nick's sponsors)
- [ ] Partnership/sponsor badges section (local business cross-promotion)
- [x] "Ask a Mechanic" public Q&A forum page at /ask with admin answer management

### 4C: Cutting-Edge Features
- [ ] AI-powered chat upgrade: voice input support for symptom description
- [ ] Progressive Web App (PWA) install prompt for mobile users
- [ ] Push notification opt-in for specials and service reminders
- [ ] QR code generator for in-shop marketing materials (links to reviews, specials, booking)
(Sprint 4C deferred — requires additional infrastructure)

## Full Site Audit & Redesign (March 18, 2026)
- [x] Complete full site audit of every page and feature
- [x] Create Tesla-style redesign presentation (modern, minimal, fewer options)
- [x] Google Search Console: submit sitemap, verify indexing, optimize all settings
- [x] Fill out every possible GSC detail for maximum SEO success

## Tesla-Style Redesign Implementation

- [x] Global theme: near-black (#0A0A0A) background, Inter font, yellow/blue accents
- [x] Remove: caution stripes, glow effects, gradient text, accent bars, Oswald font
- [x] Typography: Inter font, massive headlines, wide letter-spacing
- [x] Simplified navigation: 5 items only (Services, Reviews, Specials, About, Contact)
- [x] Homepage: full-bleed hero, one-service-per-screen sections, trust-through-numbers
- [x] Redesign secondary pages (About, Contact, Reviews, Specials, Diagnose)
- [x] Redesign community pages (Ask, Car Care, Refer, My Garage)
- [x] Redesign Service/City/Problem template pages
- [ ] Redesign Admin dashboard (kept functional layout, updated colors)
- [x] Full visual QA across all pages
- [x] Run all tests and verify zero errors
## Google Search Console — Full Configuration (March 18, 2026)
- [ ] URL inspection and request indexing for all new Sprint 2-4 pages
- [ ] Verify sitemap status shows 44 URLs discovered
- [ ] Check Pages/Coverage report for any indexing issues
- [ ] Review Mobile Usability report
- [ ] Review Enhancements: structured data, breadcrumbs, sitelinks, review snippets
- [ ] Check Core Web Vitals report
- [ ] Configure Settings: international targeting, crawl rate, associations
- [ ] Review Links report (internal and external)
- [ ] Check Security & Manual Actions (should be clean)
- [ ] Verify all rich results are detected (LocalBusiness, AutoRepair, reviews)

## SEO Fixes (March 18, 2026)
- [x] Fix homepage title — trim from 71 chars to 47 chars: "Nick's Tire & Auto | Cleveland Auto Repair Shop"
- [ ] Audit all page titles — ensure every page is 30-60 characters
- [ ] Audit all meta descriptions — ensure every page is 120-160 characters
- [ ] Fix any titles/descriptions that are out of range

## Phase 24 — Recognition & Growth Upgrades (March 2026)
### Immediate Wins (Week 1)
- [x] Install Meta Pixel on website (retargeting + conversion tracking)
- [x] Install Google Analytics 4 (GA4) on website (G-B1LJ1P43G8)
- [x] Build review generation page at /review with QR code
- [x] Update Meta Business Suite auto reply (Nick's message, both channels, saved)
- [ ] Set up remaining Meta automations (away msg, contact, hours, location, FAQ) — messages written in meta_automation_messages.md
### Growth Engine (Week 2-3)
- [x] Add AEO-optimized Q&A content to service pages (24 quick answers, 4 per service, FAQ schema updated)
- [ ] Optimize Google Business Profile (posts, services, products, photos)
- [ ] Submit to top 20 local citation directories
- [ ] Create Instagram Reels content strategy and 30-day calendar
### Authority Building (Week 3-6)
- [ ] Guide Google Local Service Ads (LSA) setup
- [ ] Guide Google Ads search campaign setup
### Retention & Referral (Month 2-3)
- [ ] Build referral program upgrade (text-to-refer system)
- [ ] Plan email/SMS service reminder system
- [ ] Create community partnership outreach plan

## Phase 25 — Website Upgrade Plan (10 Upgrades)

### Tier 1: Revenue Conversion
- [x] Upgrade 1: Instant Price Estimator (/pricing page with vehicle + service → price range)
- [x] Upgrade 2: Service Status Tracker (/status page + admin Job Board with stage progression)
- [x] Upgrade 3a: Booking Urgency Routing (Emergency/This Week/Whenever selector)
- [x] Upgrade 3b: Callback Request Button (floating "Call Me Back" on every page, name + phone only)

### Tier 2: Retention & Repeat Business
- [x] Upgrade 4: Automated Post-Service Follow-Ups (24hr thank-you, 7-day review request, mileage reminders)
- [ ] Upgrade 5: Customer SMS/Text Channel (Twilio integration — requires Twilio account setup)
- [x] Upgrade 6: Loyalty Points Program (1 point/$1, milestones, integrated into My Garage)

### Tier 3: Competitive Edge
- [x] Upgrade 7: Digital Vehicle Inspection Reports (/inspection/:token with photos, green/yellow/red ratings)
- [x] Upgrade 8: Fleet & Commercial Accounts Page (/fleet with quote form)
- [x] Upgrade 9: Financing Options Page (/financing with Synchrony + Sunbit info)
- [x] Upgrade 10: Weekly Owner Intelligence Report (automated Monday summary via notifyOwner)

## Phase 26 — Twilio SMS Integration
- [x] Configure Twilio environment secrets (Account SID, Auth Token, Phone Number)
- [x] Build Twilio SMS server module (sendSMS helper)
- [x] Wire SMS into status update notifications (when admin updates job stage)
- [x] Wire SMS into automated follow-ups (24hr thank-you, 7-day review request)
- [x] Wire SMS into callback request confirmations
- [x] Add admin SMS settings/log panel
- [x] Write tests for SMS module (18 tests passing)

## Phase 27 — Comprehensive Website Upgrades (March 19, 2026)
### SEO & Internal Linking
- [x] Create InternalLinks component (cross-page SEO linking, 18 link targets, deterministic rotation)
- [x] Integrate InternalLinks into 10 pages (ServicePage, About, Contact, FAQ, Financing, Fleet, Reviews, Diagnose, Blog, PriceEstimator)
- [x] Add InternalLinks to Home page
- [x] Update sitemap.xml from 44 to 50 URLs with lastmod dates on all entries
### Conversion Optimization
- [x] Create ComparisonTable component (Nick's vs Dealership vs Chain comparison)
- [x] Integrate ComparisonTable into Home page (between Reviews and Contact sections)
- [x] Create TrustBadges component (6 trust signals: stars, licensed, same-day, ASE, family-owned, location)
### Mobile & Accessibility
- [x] Enhance SiteMobileCTA with 3-button layout (Call, Directions, Book)
- [x] Add Google Maps directions link to mobile CTA
- [x] Add viewport-fit=cover for notch device support
- [x] Add safe-area CSS for mobile bottom bar
- [x] Change maximum-scale from 1 to 5 for accessibility (pinch-to-zoom)
### Performance
- [x] Add font-display: swap CSS optimization
- [x] Add lazy-loaded image fade-in transitions
### Admin Dashboard
- [x] Update sitemapPageCount from 32 to 50 in admin stats
- [x] Add nickstire.manus.space to domains list in admin health
### Testing
- [x] All 168 tests passing (11 test files, 0 failures)
