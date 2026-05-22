import Parser from 'rss-parser';
import { RawArticle, Source, SourceParams } from './types';
import { cleanText, truncate, fetchWithTimeout } from './util';

const parser = new Parser({ timeout: 8000 });

// Google News exposes a free RSS search endpoint that doesn't require auth.
// Format: https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en
// Returns up to ~100 articles per query, typically from the past 30 days.
function buildQuery(company: string, keywords: string[]): string[] {
  // Strategy: build a few diverse queries so we get broad coverage.
  // Each query is one "OR group" of related terms.
  const queries: string[] = [];

  // Q1: company name alone
  queries.push(`"${company}"`);

  // Q2: company + a few branded product/topic keywords (skip generic ones)
  const generic = new Set([
    'pharma', 'vaccine', 'cancer', 'drug', 'doctor', 'nurse', 'pharmacist',
    'physician', 'flu', 'covid', 'measles', 'hepatitis', 'medicare', 'medicaid',
    'influenza',
  ]);
  const specific = keywords.filter((k) => !generic.has(k.toLowerCase())).slice(0, 6);
  if (specific.length) {
    const ored = specific.map((k) => `"${k}"`).join(' OR ');
    queries.push(`(${ored})`);
  }

  // Q3: company + generic topic words (catches sector news)
  const generics = keywords.filter((k) => generic.has(k.toLowerCase())).slice(0, 4);
  if (generics.length) {
    const ored = generics.map((k) => `"${k}"`).join(' OR ');
    queries.push(`"${company}" (${ored})`);
  }

  return queries;
}

async function runQuery(query: string): Promise<RawArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetchWithTimeout(url, {}, 9000);
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = await parser.parseString(xml);
    return (parsed.items || []).map((item: any) => {
      // Google News titles come as "Headline - Publisher" — split it
      const rawTitle = item.title || '';
      const lastDash = rawTitle.lastIndexOf(' - ');
      let title = rawTitle;
      let publisher = 'Google News';
      if (lastDash > 0 && rawTitle.length - lastDash < 60) {
        title = rawTitle.slice(0, lastDash).trim();
        publisher = rawTitle.slice(lastDash + 3).trim();
      }
      return {
        title: cleanText(title),
        link: item.link || '',
        source: publisher,
        sourceType: 'google_news' as const,
        publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
        snippet: truncate(cleanText(item.contentSnippet || item.content || ''), 400),
      };
    });
  } catch {
    return [];
  }
}

export const googleNewsSource: Source = {
  name: 'google_news',
  enabled: true,
  async fetch({ company, keywords }: SourceParams): Promise<RawArticle[]> {
    const queries = buildQuery(company, keywords);
    const results = await Promise.all(queries.map(runQuery));
    const flat: RawArticle[] = [];
    results.forEach((arr) => flat.push(...arr));
    return flat;
  },
};
