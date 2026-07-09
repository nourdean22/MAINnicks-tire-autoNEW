export function buildMetaUtms(
  campaignName: string,
  adSetName: string,
  adName: string,
  baseUrl: string = "https://nickstire.com"
): string {
  const url = new URL(baseUrl);
  
  // Follow strict Nick's Tire Meta Ads UTM conventions
  url.searchParams.set("utm_source", "meta");
  url.searchParams.set("utm_medium", "paid_social");
  url.searchParams.set("utm_campaign", campaignName);
  url.searchParams.set("utm_content", adSetName);
  url.searchParams.set("utm_term", adName);

  return url.toString();
}

export function generateSuggestedUtms(
  campaignName: string,
  adSets: string[],
  ads: string[],
  baseUrl: string = "https://nickstire.com"
): Array<{ adSet: string; ad: string; url: string }> {
  const suggestions: Array<{ adSet: string; ad: string; url: string }> = [];

  for (const adSet of adSets) {
    for (const ad of ads) {
      suggestions.push({
        adSet,
        ad,
        url: buildMetaUtms(campaignName, adSet, ad, baseUrl),
      });
    }
  }

  return suggestions;
}
