/**
 * Apollo.io — Sales intelligence and lead generation.
 * Free tier: 50 credits/month for contact lookups.
 * Used for: fleet manager contacts, B2B outreach, commercial account prospecting.
 */

interface ApolloContact {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  email?: string;
  phone?: string;
  company: string;
  linkedinUrl?: string;
  city?: string;
  state?: string;
}

interface ApolloSearchResult {
  contacts: ApolloContact[];
  totalResults: number;
  creditsUsed: number;
}

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_API_KEY not configured");
  return key;
}

async function apolloRequest(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.apollo.io/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({ ...body, api_key: getApiKey() }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Apollo API error ${res.status}: ${err}`);
  }

  return res.json();
}

/**
 * Search for fleet managers and commercial contacts in the Cleveland area.
 */
export async function searchFleetContacts(params?: {
  titles?: string[];
  locations?: string[];
  industries?: string[];
  limit?: number;
}): Promise<ApolloSearchResult> {
  const {
    titles = ["Fleet Manager", "Operations Manager", "Facility Manager", "Transportation Director"],
    locations = ["Cleveland, Ohio", "Euclid, Ohio", "East Cleveland, Ohio"],
    industries = ["Transportation", "Logistics", "Construction", "Manufacturing"],
    limit = 10,
  } = params || {};

  const data = (await apolloRequest("mixed_people/search", {
    person_titles: titles,
    person_locations: locations,
    organization_industries: industries,
    per_page: Math.min(limit, 25),
    page: 1,
  })) as { people?: Array<Record<string, unknown>>; pagination?: { total_entries?: number } };

  const contacts: ApolloContact[] = (data.people || []).map((p) => ({
    id: String(p.id || ""),
    firstName: String(p.first_name || ""),
    lastName: String(p.last_name || ""),
    title: String(p.title || ""),
    email: p.email ? String(p.email) : undefined,
    phone: p.phone_number ? String(p.phone_number) : undefined,
    company: String((p.organization as Record<string, unknown>)?.name || ""),
    linkedinUrl: p.linkedin_url ? String(p.linkedin_url) : undefined,
    city: p.city ? String(p.city) : undefined,
    state: p.state ? String(p.state) : undefined,
  }));

  return {
    contacts,
    totalResults: (data.pagination?.total_entries as number) || 0,
    creditsUsed: contacts.length,
  };
}

/**
 * Look up a specific person's contact info.
 */
export async function enrichContact(params: {
  firstName: string;
  lastName: string;
  company?: string;
  domain?: string;
}): Promise<ApolloContact | null> {
  const data = (await apolloRequest("people/match", {
    first_name: params.firstName,
    last_name: params.lastName,
    organization_name: params.company,
    domain: params.domain,
  })) as { person?: Record<string, unknown> };

  const p = data.person;
  if (!p) return null;

  return {
    id: String(p.id || ""),
    firstName: String(p.first_name || ""),
    lastName: String(p.last_name || ""),
    title: String(p.title || ""),
    email: p.email ? String(p.email) : undefined,
    phone: p.phone_number ? String(p.phone_number) : undefined,
    company: String((p.organization as Record<string, unknown>)?.name || ""),
    linkedinUrl: p.linkedin_url ? String(p.linkedin_url) : undefined,
  };
}
