### Monorepo Architecture & Operator Profile

*   **Nour Dean is the CEO and Owner-Operator** of Nick’s Tire & Auto at 17625 Euclid Ave in Cleveland, Ohio, and is the developer behind **Statenour OS** (NOUR OS).
*   The unified repository runs four main services on a **single Git branch (`main`)** hosted on a single Railway project: Nick's Tire & Auto (Vite/React + Express/Drizzle MySQL), Statenour OS (Next.js Standalone + Prisma/Neon Postgres), Statenour Worker (Express node-cron relay), and Statenour Voice (Python LiveKit agent).
*   Under strict **App Isolation Rules**, concurrent sibling sessions must never touch both applications in the same session, and developers must commit to named branches rather than pushing directly to `main`.
*   The web products are structurally independent and have **no database-level coupling**, exchanging data solely through a restricted, timing-safe API bridge endpoint (`/api/bridge/*`) secured by the `STATENOUR_SYNC_KEY`.
*   Because both applications operate as **standalone iOS PWAs**, native system alerts, confirms, and prompts (`window.confirm`, `window.alert`) are silently suppressed on iPhones, requiring custom in-DOM two-tap confirmation components.
*   The Windows PowerShell command parser **does not support standard Unix `&&` chaining**; attempting to do so triggers a fatal syntax parser error, requiring commands to be chained with a semicolon `;` instead.

### Acima Conversion & FTC Compliance

*   Acima is legally classified as a **lease-to-own (rental purchase) agreement** and must never be described as or commingled with financing, credit, or loans. Misrepresenting this risks merchant termination, Google listing suspension, or FTC fines of up to **$53,088/day**.
*   Hiding cost-of-ownership disclosures behind non-descript dropdown menus is legally classified as deceptive under FTC enforcement standards, as demonstrated by the **$175 million Progressive Leasing settlement**.
*   If a pricing "trigger term" (e.g., "$12/week") is displayed on the website, regulations mandate the **immediate and clear disclosure of the total cost of ownership**, along with a statement that leasing costs more than paying cash.
*   To prevent Google Ads or social media policy flags, merchant copy must prioritize phrases like **"no credit history required" or "shop without credit"** over high-risk, prohibited claims like "no credit check".

### Genetic Methylation & Detoxification Profiles

*   A single nucleotide polymorphism (SNP) mutation (+/+ homozygous or +/- heterozygous) does not mean a gene is defective, but rather that it is **operating with altered efficiency**.
*   A **CBS defect represents an upregulation of the enzyme**, causing it to work too fast and rapidly convert homocysteine to taurine, which leads to high ammonia levels and sulfur intolerance.
*   An **MTHFR C677T mutation restricts enzyme activity by 70% in homozygous (+/+) individuals** and 30% in heterozygous (+/-) individuals, potentially contributing to elevated homocysteine. When combined with an **MTR A2756G** mutation, it causes persistently high homocysteine unless treated with both B12 and folate.
*   The **MTHFR A1298C mutation** is involved in generating BH4 (a critical factor for ammonia detoxification and neurotransmitter production), but it does not lead to elevated homocysteine unless paired as a compound heterozygous mutation with MTHFR C677T.
*   Individuals with a **COMT V158M (+/+) homozygous mutation** may experience irritability, hyperactivity, or mood swings when exposed to methyl donors due to an accumulation of S-adenosylhomocysteine (SAH), which impairs the enzyme's ability to break down dopamine, epinephrine, and norepinephrine.
*   **MAO-A is an X-linked enzyme** responsible for breaking down serotonin and dopamine; because males carry only one allele, they can never be heterozygous (+/-) for this mutation. Combining a high-activity MAO-A mutation with a COMT mutation significantly increases neurotransmitter imbalances.
*   The **MTR A2756G mutation uregulates activity** and causes methionine synthase to deplete its required cofactor, cobalamin (B12), at a faster rate, which can lead to methylcobalamin deficiency and megaloblastic anemia.

### Automated Social Media & Video Production Protocols

*   The automated posting systems run on a **strict 8-second time budget for live web scraping**; if the scraped source hangs or times out, the script triggers an immediate kill switch and falls back directly to pre-configured business facts.
*   To eliminate the artificial "AI sheen" from generated videos, the Higgsfield output must enforce **Engineered Grit and photographic imperfection**, such as a shallow depth of field, 35mm film grain, dirty fingernails, scratched metal, and oil-stained concrete.
*   The Instagram web interface rejects automated emoji typing, meaning captions must either be **100% ASCII-only** or injected directly into the DOM using clipboard data or JavaScript value setters verified via `element.value.length > 0`.
*   All video files are capped at **10MB for Instagram publication** using specific FFmpeg parameters (`-crf 26 -vcodec libx264 -pix_fmt yuv420p -b:a 128k`); if the compiled file exceeds 9.5MB, it must be instantly re-encoded at `-crf 28`.

### Automotive Safety & Road Physics

*   AAA wet-road testing proves that tires worn down to **4/32" of tread require an average of 87 extra feet to bring a vehicle to a complete stop at 60 mph** compared to new tires—a distance equivalent to an entire Cleveland block.
*   Electric vehicles (EVs) wear out their tires **almost twice as fast** (requiring replacement at 20,000–30,000 miles compared to the standard 40,000–50,000 miles for gas vehicles) due to the extra 1,000+ lbs of battery pack weight and instant electric motor torque.
*   A rapid, **10-second check for wet-braking safety is the quarter test**: inserting a quarter upside down into the tread; if the top of Washington’s head is visible, the tread is at or below 4/32" and needs replacement.
