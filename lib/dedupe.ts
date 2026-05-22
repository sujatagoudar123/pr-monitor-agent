import { RawArticle } from './sources/types';
import { normalizeUrl } from './sources/util';

// Dedupe articles by normalized URL (cross-source same-article match).
// Also fall back to title-based dedup for cases where URLs differ slightly
// (e.g., Google News wrapper URLs vs direct publisher URL).
export function dedupeArticles(articles: RawArticle[]): RawArticle[] {
  const byUrl = new Map<string, RawArticle>();
  const byTitle = new Map<string, RawArticle>();

  for (const a of articles) {
    const url = normalizeUrl(a.link);
    const titleKey = a.title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

    // Prefer direct publisher URL over Google News wrapper URL
    if (byUrl.has(url)) {
      const existing = byUrl.get(url)!;
      if (a.sourceType !== 'google_news' && existing.sourceType === 'google_news') {
        byUrl.set(url, a);
      }
      continue;
    }
    if (titleKey.length > 20 && byTitle.has(titleKey)) {
      const existing = byTitle.get(titleKey)!;
      if (a.sourceType !== 'google_news' && existing.sourceType === 'google_news') {
        byTitle.set(titleKey, a);
        byUrl.set(url, a);
      }
      continue;
    }
    byUrl.set(url, a);
    if (titleKey.length > 20) byTitle.set(titleKey, a);
  }

  return Array.from(byUrl.values());
}

export function sortByDate(articles: RawArticle[]): RawArticle[] {
  return articles.slice().sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}
