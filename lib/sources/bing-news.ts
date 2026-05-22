import { RawArticle, Source, SourceParams } from './types';
import { truncate, fetchWithTimeout } from './util';

// Docs: https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/endpoints
// Free F0 tier: 1,000 calls/month, 3 calls/second.
// Endpoint: https://api.bing.microsoft.com/v7.0/news/search?q=<query>&count=50

function buildQuery(company: string, keywords: string[]): string {
  const top = keywords.slice(0, 6);
  const parts = [company, ...top];
  return parts.map((p) => `"${p}"`).join(' OR ');
}

export const bingNewsSource: Source = {
  name: 'bing_news',
  get enabled() {
    return !!process.env.BING_NEWS_API_KEY;
  },
  async fetch({ company, keywords }: SourceParams): Promise<RawArticle[]> {
    const key = process.env.BING_NEWS_API_KEY;
    if (!key) return [];

    const q = buildQuery(company, keywords);
    const url = `https://api.bing.microsoft.com/v7.0/news/search?q=${encodeURIComponent(
      q,
    )}&count=50&mkt=en-US&freshness=Week`;

    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { 'Ocp-Apim-Subscription-Key': key } },
        10000,
      );
      if (!res.ok) {
        console.warn(`[bing-news] HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      return (data.value || []).map((a: any) => ({
        title: a.name || '',
        link: a.url || '',
        source: a.provider?.[0]?.name || 'Bing News',
        sourceType: 'bing_news' as const,
        publishedAt: a.datePublished || new Date().toISOString(),
        snippet: truncate(a.description || '', 400),
        imageUrl: a.image?.thumbnail?.contentUrl || undefined,
      }));
    } catch (err) {
      console.warn('[bing-news] fetch failed:', err);
      return [];
    }
  },
};
