export interface SearchResult {
  query: string;
  results?: unknown;
  error?: string;
}

export interface ExternalSearchProvider {
  search(query: string, options?: Record<string, unknown>): Promise<SearchResult>;
}
