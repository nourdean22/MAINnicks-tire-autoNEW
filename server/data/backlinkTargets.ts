/**
 * Local Backlink Opportunity Targets — Cleveland area
 * Pre-populated list of directories, chambers, and local organizations.
 */

export interface BacklinkTarget {
  name: string;
  type: "directory" | "sponsorship" | "guest-post" | "event" | "chamber" | "charity" | "news" | "blog";
  difficulty: "easy" | "medium" | "hard";
  value: "high" | "medium" | "low";
  url?: string;
  notes?: string;
}

export const LOCAL_BACKLINK_TARGETS: BacklinkTarget[] = [
  { name: "Euclid Chamber of Commerce", type: "chamber", difficulty: "easy", value: "high", notes: "Member listing + events" },
  { name: "Cleveland.com Business Directory", type: "directory", difficulty: "easy", value: "high" },
  { name: "Cuyahoga County Small Business Directory", type: "directory", difficulty: "easy", value: "medium" },
  { name: "BBB Cleveland", type: "directory", difficulty: "easy", value: "high", notes: "Apply for accreditation" },
  { name: "Cleveland Scene Best Of", type: "news", difficulty: "medium", value: "high", notes: "Annual nomination" },
  { name: "Local school car care fundraiser sponsorship", type: "sponsorship", difficulty: "easy", value: "medium" },
  { name: "Neighborhood newsletters (Collinwood, Glenville)", type: "blog", difficulty: "easy", value: "medium" },
  { name: "Cleveland Clinic employee wellness partnerships", type: "sponsorship", difficulty: "hard", value: "high" },
  { name: "University Circle / CSU campus flyer boards", type: "sponsorship", difficulty: "easy", value: "low" },
  { name: "Local church bulletins / community boards", type: "sponsorship", difficulty: "easy", value: "low" },
  { name: "ASE Certified Shop directories", type: "directory", difficulty: "easy", value: "medium" },
  { name: "CarFax Service Center listing", type: "directory", difficulty: "easy", value: "high" },
  { name: "RepairPal Certified listing", type: "directory", difficulty: "medium", value: "high" },
  { name: "AutoMD Shop Finder", type: "directory", difficulty: "easy", value: "medium" },
  { name: "Nextdoor Business Page", type: "directory", difficulty: "easy", value: "medium" },
  { name: "Yelp Business Page", type: "directory", difficulty: "easy", value: "high" },
  { name: "Yellow Pages / YP.com", type: "directory", difficulty: "easy", value: "medium" },
  { name: "Angi (formerly Angie's List)", type: "directory", difficulty: "easy", value: "high" },
  { name: "Euclid Observer newspaper", type: "news", difficulty: "medium", value: "medium" },
  { name: "Cleveland Neighborhood Progress", type: "charity", difficulty: "medium", value: "medium" },
];
