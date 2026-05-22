import { rssSource } from './rss';
import { googleNewsSource } from './google-news';
import { newsApiSource } from './newsapi';
import { bingNewsSource } from './bing-news';
import { scrapeSource } from './scrape';
import { Source } from './types';

export const allSources: Source[] = [
  rssSource,
  googleNewsSource,
  newsApiSource,
  bingNewsSource,
  scrapeSource,
];

export function getEnabledSources(): Source[] {
  return allSources.filter((s) => s.enabled);
}

export type { RawArticle, RankedArticle, Source, SourceParams } from './types';
