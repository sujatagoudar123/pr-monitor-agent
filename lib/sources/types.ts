// Canonical shape every source connector must return.
// Source-agnostic so the agent can reason about articles uniformly.

export interface RawArticle {
  title: string;
  link: string;
  source: string;       // human-readable publication name
  sourceType: 'rss' | 'google_news' | 'bing_news' | 'newsapi' | 'scrape';
  publishedAt: string;  // ISO 8601
  snippet: string;      // clean text, no HTML
  imageUrl?: string;
  author?: string;
}

// Article AFTER the agent has evaluated relevance
export interface RankedArticle extends RawArticle {
  matchedKeywords: string[];   // keywords from the user's list that appear
  relevanceScore: number;       // 0..1, set by the LLM
  whyPicked: string;            // LLM-written reasoning
}

export interface Source {
  name: string;
  enabled: boolean;
  fetch(params: SourceParams): Promise<RawArticle[]>;
}

export interface SourceParams {
  company: string;
  keywords: string[];
  feeds?: { name: string; url: string }[];
  maxResults?: number;
}
