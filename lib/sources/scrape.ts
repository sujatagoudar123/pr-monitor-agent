import * as cheerio from 'cheerio';
import { RawArticle, Source, SourceParams } from './types';
import { cleanText, truncate, fetchWithTimeout } from './util';

// Curated list of major publications with no reliable RSS where we scrape
// the front page or a topic section. Selectors are best-effort and may need
// occasional updates if a site redesigns.
//
// Scraping is intentionally minimal and respectful — we only read public
// landing pages, no auth bypassing, no rate-limit violation. If a site blocks
// the User-Agent, the fetch silently fails and the agent moves on.
const SCRAPE_TARGETS: Array<{
  source: string;
  url: string;
  itemSelector: string;
  titleSelector: string;
  linkAttr?: string;
  linkSelector?: string;
  baseUrl?: string;
}> = [
  {
    source: 'Reuters Health',
    url: 'https://www.reuters.com/business/healthcare-pharmaceuticals/',
    itemSelector: 'a[data-testid="Heading"]',
    titleSelector: '',
    linkAttr: 'href',
    baseUrl: 'https://www.reuters.com',
  },
  {
    source: 'FiercePharma',
    url: 'https://www.fiercepharma.com/',
    itemSelector: 'h3 a, h2 a',
    titleSelector: '',
    linkAttr: 'href',
    baseUrl: 'https://www.fiercepharma.com',
  },
  {
    source: 'FierceBiotech',
    url: 'https://www.fiercebiotech.com/',
    itemSelector: 'h3 a, h2 a',
    titleSelector: '',
    linkAttr: 'href',
    baseUrl: 'https://www.fiercebiotech.com',
  },
  {
    source: 'STAT News',
    url: 'https://www.statnews.com/category/pharma/',
    itemSelector: 'h3.article__title a, h2 a',
    titleSelector: '',
    linkAttr: 'href',
  },
  {
    source: 'Endpoints News',
    url: 'https://endpts.com/',
    itemSelector: 'h2 a, h3 a',
    titleSelector: '',
    linkAttr: 'href',
  },
];

async function scrapeOne(
  target: (typeof SCRAPE_TARGETS)[number],
): Promise<RawArticle[]> {
  try {
    const res = await fetchWithTimeout(target.url, {}, 8000);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const articles: RawArticle[] = [];
    const seen = new Set<string>();

    $(target.itemSelector).each((_, el) => {
      const $el = $(el);
      const href = $el.attr(target.linkAttr || 'href');
      if (!href) return;
      const link = href.startsWith('http')
        ? href
        : `${target.baseUrl || ''}${href}`;
      if (seen.has(link)) return;
      seen.add(link);

      const title = cleanText($el.text());
      if (!title || title.length < 10) return;

      articles.push({
        title,
        link,
        source: target.source,
        sourceType: 'scrape',
        publishedAt: new Date().toISOString(), // scrape pages rarely give clean dates
        snippet: truncate(title, 200), // best we can do from a list page
      });

      if (articles.length >= 30) return false; // cap per source
    });

    return articles;
  } catch {
    return [];
  }
}

export const scrapeSource: Source = {
  name: 'scrape',
  enabled: true,
  async fetch(_: SourceParams): Promise<RawArticle[]> {
    const results = await Promise.all(SCRAPE_TARGETS.map(scrapeOne));
    const flat: RawArticle[] = [];
    results.forEach((arr) => flat.push(...arr));
    return flat;
  },
};
