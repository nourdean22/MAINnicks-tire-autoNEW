const fs = require('fs');
const path = require('path');

const BASE = 'https://nickstire.org';
const TODAY = new Date().toISOString().split('T')[0];

// ── Static/Core Pages ────────────────────────────────────
const corePages = [
  { path: '/', priority: '1.0', freq: 'weekly' },
  { path: '/about', priority: '0.8', freq: 'monthly' },
  { path: '/contact', priority: '0.8', freq: 'monthly' },
  { path: '/services', priority: '0.9', freq: 'weekly' },
  { path: '/tires', priority: '0.9', freq: 'weekly' },
  { path: '/blog', priority: '0.8', freq: 'weekly' },
  { path: '/faq', priority: '0.7', freq: 'monthly' },
  { path: '/financing', priority: '0.8', freq: 'monthly' },
  { path: '/reviews', priority: '0.8', freq: 'weekly' },
  { path: '/careers', priority: '0.6', freq: 'monthly' },
  { path: '/booking', priority: '0.9', freq: 'monthly' },
  { path: '/specials', priority: '0.8', freq: 'weekly' },
  { path: '/fleet', priority: '0.7', freq: 'monthly' },
  { path: '/loyalty', priority: '0.6', freq: 'monthly' },
  { path: '/tire-finder', priority: '0.9', freq: 'weekly' },
  { path: '/ask-mechanic', priority: '0.7', freq: 'monthly' },
  { path: '/diagnose', priority: '0.7', freq: 'monthly' },
  { path: '/cost-estimator', priority: '0.7', freq: 'monthly' },
  { path: '/privacy-policy', priority: '0.3', freq: 'yearly' },
  { path: '/terms', priority: '0.3', freq: 'yearly' },
  { path: '/track-order', priority: '0.6', freq: 'monthly' },
  { path: '/guides', priority: '0.7', freq: 'weekly' },
];

// ── Service Pages ────────────────────────────────────────
const services = [
  'tires', 'brakes', 'oil-change', 'diagnostics', 'emissions',
  'alignment', 'general-repair', 'ac-repair', 'suspension', 'transmission',
  'electrical', 'exhaust', 'battery', 'cooling', 'belts-hoses',
  'starter-alternator', 'pre-purchase-inspection',
];

// ── SEO Service Pages (long-tail) ────────────────────────
const seoPages = [
  'brake-repair-cleveland', 'check-engine-light-cleveland', 'tire-repair-cleveland',
  'suspension-repair-cleveland', 'ac-repair-cleveland', 'oil-change-near-me-cleveland',
  'transmission-repair-cleveland', 'engine-diagnostics-cleveland', 'echeck-emissions-cleveland',
  'used-tires-cleveland', 'wheel-alignment-cleveland', 'auto-electrical-cleveland',
  'flat-tire-repair-cleveland', 'battery-replacement-cleveland', 'exhaust-repair-cleveland',
  'coolant-flush-cleveland', 'brake-fluid-service-cleveland', 'power-steering-repair-cleveland',
  'cv-axle-repair-cleveland', 'car-wont-start-cleveland', 'catalytic-converter-cleveland',
  'muffler-repair-cleveland', 'radiator-repair-cleveland', 'thermostat-replacement-cleveland',
  'timing-belt-cleveland', 'water-pump-repair-cleveland', 'car-inspection-cleveland',
  'pre-purchase-inspection-cleveland', 'fleet-maintenance-cleveland',
];

// ── Neighborhood/Area Pages (read dynamically from data) ──
const neighborhoodFile = fs.readFileSync(path.join(__dirname, '..', 'shared', 'neighborhoods.ts'), 'utf8');
const neighborhoods = [];
const nSlugRegex = /slug:\s*"([^"]+)"/g;
let nMatch;
while ((nMatch = nSlugRegex.exec(neighborhoodFile)) !== null) {
  neighborhoods.push(nMatch[1]);
}

// ── Blog Slugs (read dynamically from blog.ts) ──────────
const blogFile = fs.readFileSync(path.join(__dirname, '..', 'shared', 'blog.ts'), 'utf8');
const blogSlugs = [];
const slugRegex = /slug:\s*"([^"]+)"/g;
let m;
while ((m = slugRegex.exec(blogFile)) !== null) {
  blogSlugs.push(m[1]);
}

// ── Intersection Pages ───────────────────────────────────
const intersections = [
  'euclid-ave-e-222nd', 'euclid-ave-e-200th', 'euclid-ave-chardon-rd',
  'lakeshore-blvd-e-222nd', 'babbitt-rd-euclid-ave', 'i-90-euclid-ave',
  'i-90-e-185th', 'i-271-euclid-ave', 'euclid-ave-lloyd-rd',
  'vine-st-euclid-ave-wickliffe', 'mayfield-rd-green-rd', 'cedar-rd-green-rd',
  'euclid-ave-e-105th', 'superior-ave-e-140th', 'lakeshore-blvd-e-185th',
  'st-clair-ave-e-152nd', 'nottingham-rd-st-clair', 'richmond-rd-wilson-mills',
  'chardon-rd-richmond-rd', 'turney-rd-granger-rd', 'broadway-ave-union-ave',
  'lee-rd-harvard-rd', 'cedar-rd-lee-rd', 'mayfield-rd-s-taylor-rd',
  'warrensville-center-rd-cedar', 'som-center-rd-mayfield',
  'e-185th-st-lake-shore', 'waterloo-rd-e-156th', 'e-260th-euclid-ave',
];

// ── Service × City Combos ────────────────────────────────
const comboServices = [
  'tires', 'brakes', 'oil-change', 'diagnostics', 'emissions',
  'alignment', 'ac-repair', 'suspension', 'transmission',
  'electrical', 'exhaust', 'general-repair', 'battery',
];
const cities = [
  'cleveland', 'euclid', 'east-cleveland', 'south-euclid',
  'cleveland-heights', 'lakewood', 'parma', 'parma-heights',
  'shaker-heights', 'garfield-heights', 'maple-heights', 'bedford',
  'wickliffe', 'willoughby', 'mentor', 'richmond-heights',
  'lyndhurst', 'warrensville-heights', 'strongsville', 'collinwood',
];

// ── Vehicle Make Pages ───────────────────────────────────
const vehicleMakes = [
  'chevy-repair-cleveland', 'ford-repair-cleveland', 'honda-repair-cleveland',
  'toyota-repair-cleveland', 'nissan-repair-cleveland', 'hyundai-repair-cleveland',
  'kia-repair-cleveland', 'dodge-repair-cleveland', 'jeep-repair-cleveland',
  'gmc-repair-cleveland', 'bmw-repair-cleveland', 'mercedes-repair-cleveland',
];

// ── City Pages ───────────────────────────────────────────
const cityPages = [
  'cleveland-auto-repair', 'euclid-auto-repair', 'south-euclid-auto-repair',
  'richmond-heights-auto-repair', 'cleveland-heights-auto-repair',
  'lakewood-auto-shop', 'parma-auto-repair', 'shaker-heights-auto-repair',
  'garfield-heights-auto-repair', 'maple-heights-auto-repair',
  'wickliffe-auto-repair', 'willoughby-auto-repair', 'mentor-auto-repair',
  'lyndhurst-auto-repair', 'bedford-auto-repair', 'strongsville-auto-repair',
  'warrensville-heights-auto-repair',
];

// ── Build XML ────────────────────────────────────────────

let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n';

function addUrl(loc, priority, freq) {
  xml += `  <url><loc>${BASE}${loc}</loc><lastmod>${TODAY}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>\n`;
}

// Core pages
xml += '  <!-- Core Pages -->\n';
for (const p of corePages) addUrl(p.path, p.priority, p.freq);

// Services
xml += '\n  <!-- Service Pages -->\n';
for (const s of services) addUrl(`/${s}`, '0.8', 'monthly');

// SEO long-tail pages
xml += '\n  <!-- SEO Service Pages -->\n';
for (const s of seoPages) addUrl(`/${s}`, '0.8', 'monthly');

// Neighborhoods
xml += '\n  <!-- Neighborhood/Area Pages -->\n';
for (const n of neighborhoods) addUrl(`/${n}`, '0.7', 'monthly');

// Blog articles
xml += `\n  <!-- Blog Articles (${blogSlugs.length}) -->\n`;
for (const slug of blogSlugs) addUrl(`/blog/${slug}`, '0.6', 'monthly');

// Intersection pages
xml += `\n  <!-- Intersection Pages (${intersections.length}) -->\n`;
for (const slug of intersections) addUrl(`/near/${slug}`, '0.7', 'monthly');

// Service × City combos
xml += `\n  <!-- Service+City Pages (${comboServices.length * cities.length}) -->\n`;
for (const svc of comboServices) {
  for (const city of cities) {
    addUrl(`/services/${svc}-${city}-oh`, '0.7', 'monthly');
  }
}

// Vehicle make pages
xml += `\n  <!-- Vehicle Make Pages (${vehicleMakes.length}) -->\n`;
for (const v of vehicleMakes) addUrl(`/${v}`, '0.7', 'monthly');

// City pages
xml += `\n  <!-- City Pages (${cityPages.length}) -->\n`;
for (const c of cityPages) addUrl(`/${c}`, '0.7', 'monthly');

xml += '\n</urlset>\n';

// Write
const outPath = path.join(__dirname, '..', 'client', 'public', 'sitemap.xml');
fs.writeFileSync(outPath, xml, 'utf8');

const count = (xml.match(/<loc>/g) || []).length;
console.log(`Sitemap generated: ${count} URLs`);
console.log(`  Core: ${corePages.length}`);
console.log(`  Services: ${services.length}`);
console.log(`  SEO pages: ${seoPages.length}`);
console.log(`  Neighborhoods: ${neighborhoods.length}`);
console.log(`  Blogs: ${blogSlugs.length}`);
console.log(`  Intersections: ${intersections.length}`);
console.log(`  Service×City: ${comboServices.length * cities.length}`);
console.log(`  Vehicle makes: ${vehicleMakes.length}`);
console.log(`  City pages: ${cityPages.length}`);
console.log(`Written to: ${outPath}`);
