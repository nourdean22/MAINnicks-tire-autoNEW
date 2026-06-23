import { google } from "googleapis";

export interface GbpLocation {
  name: string;      // format: "locations/{locationId}"
  title: string;     // e.g. "Nick's Tire & Auto Service"
  storeCode?: string;
}

export interface GbpAccount {
  name: string;      // format: "accounts/{accountId}"
  accountName: string; // e.g. "Nick's Tire"
  type: string;      // e.g. "PERSONAL", "ORGANIZATION"
}

/**
 * Retrieves the list of Google Business Profile accounts accessible by the credentials.
 */
export async function listGbpAccounts(authClient: any): Promise<GbpAccount[]> {
  try {
    const accountManagement = google.mybusinessaccountmanagement({
      version: "v1",
      auth: authClient
    });

    const res = await accountManagement.accounts.list();
    const accounts = res.data.accounts || [];

    return accounts.map((acc: any) => ({
      name: acc.name || "",
      accountName: acc.accountName || "",
      type: acc.type || ""
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to list Google Business Profile accounts: ${msg}`);
  }
}

/**
 * Retrieves all locations for a specific Google Business Profile account.
 */
export async function listGbpLocations(
  authClient: any,
  accountName: string
): Promise<GbpLocation[]> {
  try {
    const businessInfo = google.mybusinessbusinessinformation({
      version: "v1",
      auth: authClient
    });

    const res = await businessInfo.accounts.locations.list({
      parent: accountName,
      readMask: "name,title,storeCode"
    });

    const locations = res.data.locations || [];

    return locations.map((loc: any) => ({
      name: loc.name || "",
      title: loc.title || "",
      storeCode: loc.storeCode
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to list Google Business Profile locations for ${accountName}: ${msg}`);
  }
}
