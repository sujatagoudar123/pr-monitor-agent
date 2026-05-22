import Parser from 'rss-parser';
import { RawArticle, Source, SourceParams } from './types';
import { cleanText, truncate, fetchWithTimeout } from './util';

const parser = new Parser({
  timeout: 8000,
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
    ],
  },
});

function extractImage(item: any): string | undefined {
  if (item.enclosure?.url && /\.(jpe?g|png|webp|gif)/i.test(item.enclosure.url)) {
    return item.enclosure.url;
  }
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  const content = item.contentEncoded || item.content || '';
  const m = String(content).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : undefined;
}

async function fetchOneFeed(feed: { name: string; url: string }): Promise<RawArticle[]> {
  try {
    const res = await fetchWithTimeout(feed.url, {}, 9000);
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = await parser.parseString(xml);
    return (parsed.items || []).map((item: any) => ({
      title: cleanText(item.title || ''),
      link: item.link || '',
      source: feed.name,
      sourceType: 'rss' as const,
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      snippet: truncate(
        cleanText(
          item.contentSnippet ||
            item.summary ||
            item.content ||
            item.contentEncoded ||
            '',
        ),
        400,
      ),
      imageUrl: extractImage(item),
      author: item.creator || item['dc:creator'] || undefined,
    }));
  } catch {
    return [];
  }
}

export const rssSource: Source = {
  name: 'rss',
  enabled: true,
  async fetch({ feeds = [] }: SourceParams): Promise<RawArticle[]> {
    if (!feeds.length) return [];
    // Batch 15 at a time to stay polite and within edge limits
    const BATCH = 15;
    const all: RawArticle[] = [];
    for (let i = 0; i < feeds.length; i += BATCH) {
      const batch = feeds.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(fetchOneFeed));
      results.forEach((arr) => all.push(...arr));
    }
    return all;
  },
};
