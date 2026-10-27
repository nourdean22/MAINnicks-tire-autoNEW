# Shop OS 03: vendors (who we buy from and how each one plugs in)

Job 2026-10-26-shop-os. The vendor list is the shop's Chrome bookmarks (moeseuclid profile, read 2026-10-26, FACT).
Spend per vendor is UNKNOWN until ALG ticket lines are mapped (04-DATA-MAP section 3). Integration paths come from
research R1, R6, R7 (02-RESEARCH); labels as there. "Via PartsTech" = PartsTech's help articles list the supplier
(CLAIM until our own account shows it connected).

## Parts

| Vendor | Portal we use | Best path | What the shop must provide | Next step |
|---|---|---|---|---|
| O'Reilly | firstcallonline.com | Direct API or punchout for a single location (FACT); also via PartsTech | Account number + an electronic-order invoice from the last 30 days | Request at integrations.oreillypro.com |
| AutoZone | autozonepro.com | Via PartsTech | AutoZone Pro PIN (Account > My Account > Manage Shop) + servicing store | Connect in PartsTech |
| Parts Authority / IMC | imcparts.net | Via PartsTech (manual review); Web Warehouse direct as backup | Account number + servicing location | Connect in PartsTech |
| Federated Auto Parts | federatedlink.com | Via PartsTech (rep-initiated approval) | Account number from an invoice; ask the rep | Ask the Federated rep |
| Car Parts Warehouse (Parts Plus) | Nexpart WebShop + ACDelco Connection | Via PartsTech (CPW advertises it) or WHI Nexpart NEXLINK | WebShop credentials + servicing branch (Euclid: 23520 St. Clair Ave, CLAIM) | Ask CPW which branch serves us |
| Premium Guard | pgfilters.com | Brand catalog only; buy through a distributor | none | No integration |
| Car-Part.com (used OEM) | car-part.com | Car Part Pro/iPro integration (license needed); manual search meanwhile | separate agreement | Later |
| Amazon, eBay | web | Manual purchase lines | none | No integration |

## Tires and wheels

| Vendor | Portal we use | Best path | Next step |
|---|---|---|---|
| D&K Tire (Gateway) | D&K treadsearch portal | LIVE in nickstire: `gatewayClient.ts` + `gatewaySupplierOrder.ts` (fitment, stock, order) | Reuse; note `dkClient.ts` is an unused mock |
| ATD | atdonline.com | PartsTech paid tier, Tireweb, TireBase (CLAIM) | Price PartsTech's paid tier vs Tireweb |
| Capital Tire | capitaltire.net | PartsTech free tier, Tireweb (CLAIM) | Connect in PartsTech |
| Cleveland Wholesale Tire | tireaccess.tirebase.io | TireBase API, tenant must authorize us (CLAIM) | Ask the distributor for API access |
| Wheel Pros | dl.wheelpros.com | Own developer portal; order API off by default; data@wheelpros.com (CLAIM) | Request product, stock, price and order access |
| Xpress Tire | dealer.xpress-tire.com | UNKNOWN (name matches in Tireweb/PartsTech are not confirmed) | Ask the rep which platform they use |
| Elite Tire and Wheel | shop.ewwfl.com | B2B portal only (CLAIM) | Ask for a feed or API |

## Labor and repair data

| Source | Plan |
|---|---|
| Real-Time Labor Guide / ShopDriver Elite (Dowell Systems) | Replace. Its labor content is licensed to us as users, not ours to copy. |
| MOTOR via PartsTech (`/taxonomy/labor`, maintenance schedules, fluids, specs) | Primary (FACT: in PartsTech's OpenAPI v2.021.1); MOTOR answers must carry MOTOR's compliance link |
| MOTOR direct (DaaS) | Fallback; quote only |
| Mitchell 1 ProDemand | Ruled out: no single-facility software integrations (CLAIM, R2) |

## Money, phone and accounts already in use (bookmarks, FACT; paths from R10, CLAIM)

| What | Vendor | Path |
|---|---|---|
| Card machine | Maverick Payments | REST API + hosted forms exist; terminal push UNKNOWN; ask Maverick for our terminal model |
| Payment programs | Acima, Snap, Koalafi, American First Finance, Progressive, Sezzle, Synchrony, Kafene | Real APIs: Snap, Koalafi, AFF, Sezzle; the rest partner-gated; several already linked in nickstire |
| Shop phone | Spectrum Business Voice | No public call API; screen pop by forwarding through Twilio (already used) or porting |
| Mobile texting | Verizon | Automated texts need a registered route (UPSTREAMS 2026-09-23) |

## Contract traps to settle before writing adapters
1. PartsTech exclusivity clause (CLAIM) vs D&K tires and O'Reilly direct: get a written waiver or non-exclusive terms.
2. PartsTech: no caching beyond per-order accounting; the history we keep is our own order lines.
3. Wheel Pros and Tireweb: order permission is separate from search permission.

## One email to all of them
The request text is in 06-OPEN-QUESTIONS section 3.
