# Nick's Tire & Auto — Site Usage Manual

**Site:** https://nickstire.org
**Admin:** https://nickstire.org/admin
**Phone:** (216) 862-0005
**Address:** 17625 Euclid Ave, Cleveland, OH 44112

---

## 1. PUBLIC WEBSITE (nickstire.org)

### Core Pages
| Page | URL | Purpose |
|------|-----|---------|
| Homepage | `/` | Main landing — hero, services, reviews, CTA |
| Services | `/services` | All services overview |
| About | `/about` | Shop story, team, trust signals |
| Contact | `/contact` | Address, map, phone, hours, contact form |
| Reviews | `/reviews` | Google reviews showcase |
| FAQ | `/faq` | 20+ categorized FAQs |
| Blog | `/blog` | Auto care articles, SEO content |

### Service Pages (15+ pages)
Each service has its own dedicated page with SEO optimization:

| Service | URL |
|---------|-----|
| Tires (main shop) | `/tires` |
| Tire Info/Details | `/tires/info` |
| Brakes | `/brakes` |
| Diagnostics | `/diagnostics` |
| Emissions / E-Check | `/emissions` |
| Oil Change | `/oil-change` |
| General Repair | `/general-repair` |
| Alignment | `/alignment` |
| AC Repair | `/ac-repair` |
| Transmission | `/transmission` |
| Electrical | `/electrical` |
| Battery | `/battery` |
| Exhaust / Muffler | `/exhaust` |
| Cooling System | `/cooling` |
| Pre-Purchase Inspection | `/pre-purchase-inspection` |
| Belts & Hoses | `/belts-hoses` |
| Starter & Alternator | `/starter-alternator` |

### Customer Tools
| Tool | URL | What It Does |
|------|-----|-------------|
| Tire Finder | `/tires` | Search tires by size, browse inventory, order online |
| Instant Quote | `/instant-quote` | Get a quick repair estimate |
| Cost Estimator | `/cost-estimator` | Estimate repair costs by service type |
| Price Estimator | `/price-estimator` | Price calculator for common services |
| Book Appointment | `/appointment` | Online booking form |
| Track Order | `/track-order` | Track tire order status |
| Status Tracker | `/status` | Track vehicle repair status |
| Customer Portal | `/portal` | Customer account — history, vehicles, loyalty |
| My Garage | `/my-garage` | Save vehicles, track maintenance |
| Ask a Mechanic | `/ask-mechanic` | AI-powered chat for car questions |
| Diagnose My Car | `/diagnose` | AI symptom checker tool |
| Car Care Guide | `/car-care-guide` | Maintenance schedules and tips |
| Inspection Report | `/inspection/:id` | View digital vehicle inspection results |

### Loyalty & Referrals
| Page | URL | Purpose |
|------|-----|---------|
| Loyalty Program | `/loyalty` | Points program — earn on services |
| Referral Program | `/referral` | Refer friends, earn rewards |
| Share Page | `/share` | Social sharing tools |
| Specials | `/specials` | Current deals and promotions |
| Financing | `/financing` | $10-down financing info and application |

### Other Pages
| Page | URL |
|------|-----|
| Careers | `/careers` |
| Fleet Services | `/fleet` |
| Privacy Policy | `/privacy` |
| Terms of Service | `/terms` |

### City/Area Landing Pages (15+ cities)
SEO pages for local search — each targets "[city] auto repair":
- `/cleveland-auto-repair`
- `/euclid-auto-repair`
- `/lakewood-auto-repair`
- `/parma-auto-repair`
- `/east-cleveland-auto-repair`
- `/shaker-heights-auto-repair`
- `/cleveland-heights-auto-repair`
- `/mentor-auto-repair`
- `/south-euclid-auto-repair`
- `/garfield-heights-auto-repair`
- `/richmond-heights-auto-repair`
- `/lyndhurst-auto-repair`
- `/willoughby-auto-repair`
- `/maple-heights-auto-repair`
- `/bedford-auto-repair`
- Plus neighborhood pages and intersection pages

---

## 2. ADMIN DASHBOARD (nickstire.org/admin)

**Access:** Login required (admin credentials)

### Dashboard Group
| Section | What It Shows |
|---------|--------------|
| **Overview** | KPIs at a glance — today's bookings, leads, revenue, chat sessions |
| **Analytics** | Traffic, conversions, top pages, UTM tracking data |
| **Call Tracking** | Phone call logs with UTM attribution, source pages, timestamps |
| **Revenue Center** | Revenue tracking, estimates vs. actuals, trends |
| **Site Health** | Uptime, page speed, error monitoring |
| **Export Data** | Download CSV/Excel exports of any data section |

### Sales Pipeline
| Section | What It Does |
|---------|-------------|
| **Bookings** | Manage appointment requests (new/confirmed/completed/cancelled) |
| **Tire Orders** | Track online tire orders, fulfillment status |
| **Leads / CRM** | Lead management with status pipeline (new → contacted → booked → completed) |
| **Financing** | Track financing applications and approvals |
| **Chat Sessions** | Review AI chat transcripts with customers |

### Customers & SMS
| Section | What It Does |
|---------|-------------|
| **Customers** | Customer database — contact info, visit history, vehicles |
| **SMS** | Send/receive text messages to customers |
| **Win-Back** | Re-engage lapsed customers with targeted outreach |
| **Campaigns** | Create and manage SMS/email campaigns |
| **Auto Follow-Up** | Automated follow-up sequences after service |
| **Follow-Ups** | Manual follow-up task queue |

### Marketing
| Section | What It Does |
|---------|-------------|
| **Content** | Manage blog posts, page content |
| **Coupons** | Create/manage discount codes and specials |
| **Referrals** | Track referral program activity |
| **Reviews** | Send review requests, track review responses |

### Operations
| Section | What It Does |
|---------|-------------|
| **Inspections** | Digital vehicle inspections — create, share with customers |
| **Loyalty** | Manage loyalty program — points, tiers, redemptions |
| **Q&A** | Manage FAQ entries on the site |
| **Job Board** | Post and manage job listings |
| **Integrations** | Connected services (Twilio, Meta Pixel, GA4, etc.) |

### System
| Section | What It Does |
|---------|-------------|
| **Settings** | Shop info, hours, contact details, config |
| **Estimates** | Create and send repair estimates |
| **Activity** | Activity log — who did what, when |
| **NOUR OS Bridge** | Connection to your personal dashboard (autonicks.com) |
| **Shop Driver** | Internal tools for shop workflow |

---

## 3. KEY WORKFLOWS

### Booking a Customer
1. Customer fills out form at `/appointment`
2. Appears in Admin → **Bookings** as "New"
3. You confirm → status changes to "Confirmed"
4. After service → mark "Completed"

### Processing a Tire Order
1. Customer browses tires at `/tires`
2. Selects tire, submits order
3. Order appears in Admin → **Tire Orders**
4. Customer can track at `/track-order`

### Sending SMS to a Customer
1. Go to Admin → **SMS**
2. Select customer or enter number
3. Type message, send
4. Powered by Twilio integration

### Running a Win-Back Campaign
1. Admin → **Win-Back** shows customers who haven't visited in X days
2. Select customers
3. Send targeted SMS/campaign with a coupon

### Creating a Coupon
1. Admin → **Coupons**
2. Create new coupon with code, discount %, expiry
3. Share via SMS campaigns or on `/specials`

### Sending Review Requests
1. After completing service, go to Admin → **Reviews**
2. Select customer
3. Send review request via SMS with direct Google review link

### Digital Inspection
1. During service, create inspection in Admin → **Inspections**
2. Add photos, notes, green/yellow/red status per item
3. Share link with customer — they view at `/inspection/:id`

---

## 4. INFRASTRUCTURE

| Component | Service | URL |
|-----------|---------|-----|
| Web App | Railway | nickstire.org |
| Database | TiDB Cloud (MySQL) | gateway01.us-east-1.prod.aws.tidbcloud.com |
| SMS | Twilio | Via API |
| Analytics | Umami + GA4 + Meta Pixel | Built-in |
| OG Images | CloudFront CDN | d2xsxph8kpxj0f.cloudfront.net |
| NOUR OS | Vercel | autonicks.com |

### Tech Stack
- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Vite 7
- **Backend:** Express 4, tRPC 11
- **Database:** MySQL (TiDB Cloud), Drizzle ORM
- **Routing:** wouter (client), Express (server)
- **SMS:** Twilio
- **Analytics:** Umami, GA4, Meta Pixel
- **Hosting:** Railway (production)

---

## 5. SEO FEATURES

- **139 URLs** in sitemap (`/sitemap.xml`)
- **JSON-LD schemas:** LocalBusiness, AutoRepair, TireShop, FAQPage, Article, BreadcrumbList
- **Dynamic meta tags:** Every page has unique title, description, OG/Twitter cards
- **City landing pages:** 15+ targeting "[city] auto repair" searches
- **Neighborhood pages:** Targeting hyperlocal search terms
- **Service+City pages:** Cross-product pages like "brakes in Euclid OH"
- **Blog:** SEO-optimized articles for long-tail keywords
- **Prerender middleware:** Serves static HTML to search engine bots

---

## 6. QUICK REFERENCE

| Action | How |
|--------|-----|
| Call the shop | (216) 862-0005 |
| View live site | https://nickstire.org |
| Open admin panel | https://nickstire.org/admin |
| Check sitemap | https://nickstire.org/sitemap.xml |
| Check robots.txt | https://nickstire.org/robots.txt |
| View API health | https://nickstire.org/api/health |
| NOUR OS dashboard | https://autonicks.com |
| Railway dashboard | https://railway.com (project: natural-appreciation) |
