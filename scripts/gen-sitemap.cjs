const fs = require('fs');
const path = require('path');

const BASE = 'https://nickstire.org';
const TODAY = '2026-03-25';

// Read existing sitemap to get core pages
const existing = fs.readFileSync(
  path.join(__dirname, '..', 'client', 'public', 'sitemap.xml'),
  'utf8'
);

// Extract existing URLs
const existingUrls = [];
const locRegex = /<loc>(.*?)<\/loc>/g;
let match;
while ((match = locRegex.exec(existing)) !== null) {
  existingUrls.push(match[1]);
}

// Intersection slugs
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
  'e-185th-st-lake-shore', 'waterloo-rd-e-156th', 'e-260th-euclid-ave'
];

const services = [
  'tires', 'brakes', 'oil-change', 'diagnostics', 'emissions',
  'alignment', 'ac-repair', 'suspension', 'transmission',
  'electrical', 'exhaust', 'general-repair', 'battery'
];

const cities = [
  'cleveland', 'euclid', 'east-cleveland', 'south-euclid',
  'cleveland-heights', 'lakewood', 'parma', 'parma-heights',
  'shaker-heights', 'garfield-heights', 'maple-heights', 'bedford',
  'wickliffe', 'willoughby', 'mentor', 'richmond-heights',
  'lyndhurst', 'warrensville-heights', 'strongsville', 'collinwood'
];

let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n';

// Re-add existing URLs (already nickstire.org)
for (const url of existingUrls) {
  const priority = url === BASE + '/' ? '1.0' :
    url.includes('/tires') ? '0.9' :
    url.includes('/services') ? '0.9' :
    url.includes('/blog/') ? '0.6' : '0.8';
  const freq = url.includes('/blog/') ? 'monthly' : 'weekly';
  xml += `  <url><loc>${url}</loc><lastmod>${TODAY}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>\n`;
}

xml += '\n  <!-- Intersection Pages (29) -->\n';
for (const slug of intersections) {
  xml += `  <url><loc>${BASE}/near/${slug}</loc><lastmod>${TODAY}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
}

xml += '\n  <!-- Service+City Pages (260+) -->\n';
for (const svc of services) {
  for (const city of cities) {
    xml += `  <url><loc>${BASE}/services/${svc}-${city}-oh</loc><lastmod>${TODAY}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
  }
}

xml += '\n  <!-- Track Order -->\n';
xml += `  <url><loc>${BASE}/track-order</loc><lastmod>${TODAY}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`;

xml += '\n</urlset>\n';

// Write the file
const outPath = path.join(__dirname, '..', 'client', 'public', 'sitemap.xml');
fs.writeFileSync(outPath, xml, 'utf8');

// Count URLs
const count = (xml.match(/<loc>/g) || []).length;
console.log('Sitemap generated with ' + count + ' URLs');
console.log('Written to: ' + outPath);
