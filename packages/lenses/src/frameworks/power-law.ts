import type { StrategicFramework } from "../types";

/**
 * Power Law (Peter Thiel · Zero to One) · distinct from Pareto. Pareto
 * says ~20% of inputs produce ~80% of effect. Power Law is sharper ·
 * the BEST input is orders-of-magnitude better than the average input.
 * VC returns, employee productivity, content virality, customer LTV ·
 * all distribute power-law not normal.
 */
export const powerLaw: StrategicFramework = {
  id: "power-law",
  name: "Power Law (Thiel · Zero to One)",
  oneLiner: "The BEST is orders-of-magnitude better than the average. Don't optimize the median · double down on the outlier · everything else is noise.",
  triggers: [
    /\bpower\s+law\b/i,
    /\b(thiel|zero\s+to\s+one|peter\s+thiel)/i,
    /\b(orders?\s+of\s+magnitude\s+(better|bigger|larger))/i,
    /\b(outlier|10x\s+(employee|customer|product))/i,
    /\b(long[\s-]tail\s+(distribution|effects?))/i,
    /\b(vc\s+returns?|venture\s+capital\s+(returns?|fund))/i,
    /\b(top\s+(\d+\s+)?customers?\s+(are\s+)?(\d+x|\d+\s+times)\s+(bigger|better))/i,
    /\b(hits[\s-]driven|hit\s+driven\s+business)\b/i,
    /\b(double\s+down\s+on\s+(the\s+)?(winner|outlier|best))/i,
  ],
  weight: 1.0,
  lens: `Apply the Power Law lens. Thiel's distinction · Pareto says
"some inputs matter more"; Power Law says "the BEST input is
ORDERS OF MAGNITUDE better than the rest." A normal distribution
clusters around the average. A power-law distribution has a tiny
elite that dwarfs everything below.

Where power laws actually live ·
  · VENTURE RETURNS · the top fund return makes a fund · 1 winner
    pays for 50 losers. Investing in the median is investing in
    a loss.
  · EMPLOYEE PRODUCTIVITY · 10x engineer is real · not 10% better,
    actually 10x output. Same in sales, design, ops · the elite
    are non-linearly more productive than competent.
  · CONTENT VIRALITY · the top 1% of posts gets 99% of the views.
    Most content is wasted effort · the goal is to ship enough
    that one wins.
  · CUSTOMER LTV · top 5% of customers in many businesses are 50x
    more valuable than the median. Treating all customers equally
    means underserving the 5% and overserving the rest.

Decision-relevant moves ·

  1. FIND YOUR POWER LAW · which inputs in your business follow
     a power-law distribution? (Hint · most do · check ads, leads,
     channels, employees, customers, suppliers, products.)

  2. DOUBLE DOWN ON THE TOP · once you've identified the outlier ·
     pour resources into amplifying it. The marginal return on
     amplifying #1 is far higher than fixing #50.

  3. KILL THE BOTTOM · power-law thinking accepts that the bottom
     half doesn't matter much · don't waste energy "improving" it.
     Cut, automate, or productize.

  4. DON'T OPTIMIZE THE MEDIAN · improving the average customer
     experience moves the needle barely · improving the top
     customers' experience moves the entire business.

The PARETO vs POWER LAW distinction · pareto = some inputs
matter more (gradual). Power Law = ONE input matters massively
(extreme). For most operator situations the underlying
distribution is power-law, the visible part looks like Pareto.

For Nick · which 1-2 customers represent 30%+ of revenue · which
1 ad creative represents 60%+ of inquiries · which 1 service line
drives 50%+ of margin? Find them · amplify them · stop spreading
attention to the long tail.

Surface · the power-law distribution in this situation · the
specific outlier · the move that amplifies it · the tail that
stops getting attention.`,
};
