import { RawArticle, Source, SourceParams } from './types';
import { truncate, fetchWithTimeout } from './util';

// Docs: https://newsapi.org/docs/endpoints/everything
// Free tier: 100 requests/day, articles from past 30 days only.
// We build one OR-query to consume a single request per company search.

function buildQuery(company: string, keywords: string[]): string {
  // NewsAPI uses Lucene-like syntax: "term1" OR "term2"
  // Cap at ~10 keywords; long queries get rejected.
  const top = keywords.slice(0, 10);
  const parts = [`"${company}"`, ...top.map((k) => `"${k}"`)];
  // Dedupe (company may equal first keyword)
  const unique = Array.from(new Set(parts));
  return unique.join(' OR ');
}

export const newsApiSource: Source = {
  name: 'newsapi',
  get enabled() {
    return !!process.env.NEWSAPI_KEY;
  },
  async fetch({ company, keywords }: SourceParams): Promise<RawArticle[]> {
    const key = process.env.NEWSAPI_KEY;
    if (!key) return [];

    const q = buildQuery(company, keywords);
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(
      q,
    )}&language=en&sortBy=publishedAt&pageSize=100`;

    try {
      const res = await fetchWithTimeout(url, { headers: { 'X-Api-Key': key } }, 10000);
      if (!res.ok) {
        console.warn(`[newsapi] HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      if (data.status !== 'ok') return [];
      return (data.articles || []).map((a: any) => ({
        title: a.title || '',
        link: a.url || '',
        source: a.source?.name || 'NewsAPI',
        sourceType: 'newsapi' as const,
        publishedAt: a.publishedAt || new Date().toISOString(),
        snippet: truncate(a.description || a.content || '', 400),
        imageUrl: a.urlToImage || undefined,
        author: a.author || undefined,
      }));
    } catch (err) {
      console.warn('[newsapi] fetch failed:', err);
      return [];
    }
  },
};
