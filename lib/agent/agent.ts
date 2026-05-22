import Anthropic from '@anthropic-ai/sdk';
import {
  RawArticle,
  RankedArticle,
  SourceParams,
} from '../sources/types';
import { rssSource } from '../sources/rss';
import { googleNewsSource } from '../sources/google-news';
import { newsApiSource } from '../sources/newsapi';
import { bingNewsSource } from '../sources/bing-news';
import { scrapeSource } from '../sources/scrape';
import { dedupeArticles, sortByDate } from '../dedupe';
import { Company } from '../companies';

// ----------------------------------------------------------------------------
// TOOLS — the agent's action surface. Each tool corresponds to a news source.
// The agent decides which to call and in what order.
// ----------------------------------------------------------------------------
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'search_rss_feeds',
    description:
      "Fetch articles from the company's configured RSS feeds (curated trusted publications from the user's Excel list). This is the highest-signal source. Use this first.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_google_news',
    description:
      'Search Google News (free, no key) for articles matching the company name and keywords. Broad coverage across ~all major publications. Returns up to ~300 articles across multiple sub-queries.',
    input_schema: {
      type: 'object',
      properties: {
        extra_terms: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Optional additional terms to OR into the Google News query, beyond the company's keywords. Use when initial results are thin.",
        },
      },
      required: [],
    },
  },
  {
    name: 'search_newsapi',
    description:
      'Search NewsAPI.org (free tier: 100/day). Good for past-30-day coverage. May not be available if no API key is configured.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_bing_news',
    description:
      'Search Bing News (free Azure tier: 1k/mo). Good for fresh news in the past week. May not be available if no API key is configured.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'scrape_publications',
    description:
      "Scrape landing pages of major pharma/business publications that don't have reliable RSS (FiercePharma, STAT, Endpoints, Reuters Health, etc.). Use as a fallback for niche coverage.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'finalize_results',
    description:
      "Call this when you have gathered enough articles (target: at least 100, ideally 150+). The agent will then proceed to relevance-rank and return results to the user. Don't call this before gathering — it ends the search loop.",
    input_schema: {
      type: 'object',
      properties: {
        reasoning: {
          type: 'string',
          description:
            'Brief one-sentence reason why you are stopping the search now.',
        },
      },
      required: ['reasoning'],
    },
  },
];

// ----------------------------------------------------------------------------
// Tool dispatcher — calls the actual source connector for a tool name.
// ----------------------------------------------------------------------------
async function dispatchTool(
  toolName: string,
  toolInput: any,
  company: Company,
  pool: RawArticle[],
): Promise<{ count: number; sample: string[] }> {
  const baseParams: SourceParams = {
    company: company.name,
    keywords: company.keywords,
    feeds: company.feeds,
  };

  let newArticles: RawArticle[] = [];

  switch (toolName) {
    case 'search_rss_feeds':
      newArticles = await rssSource.fetch(baseParams);
      break;
    case 'search_google_news': {
      const extra = (toolInput?.extra_terms as string[]) || [];
      newArticles = await googleNewsSource.fetch({
        ...baseParams,
        keywords: [...company.keywords, ...extra],
      });
      break;
    }
    case 'search_newsapi':
      newArticles = await newsApiSource.fetch(baseParams);
      break;
    case 'search_bing_news':
      newArticles = await bingNewsSource.fetch(baseParams);
      break;
    case 'scrape_publications':
      newArticles = await scrapeSource.fetch(baseParams);
      break;
    default:
      return { count: 0, sample: [] };
  }

  pool.push(...newArticles);
  return {
    count: newArticles.length,
    sample: newArticles.slice(0, 5).map((a) => `${a.source}: ${a.title.slice(0, 80)}`),
  };
}

// ----------------------------------------------------------------------------
// AGENT LOOP — Claude decides which tools to call, observes results,
// keeps going until it calls finalize_results or hits a safety cap.
// ----------------------------------------------------------------------------
async function runAgentLoop(
  client: Anthropic,
  model: string,
  company: Company,
  enabledSourceNames: string[],
): Promise<{ pool: RawArticle[]; trace: string[] }> {
  const pool: RawArticle[] = [];
  const trace: string[] = [];

  const systemPrompt = `You are a PR-intelligence research agent. Your job: gather as many high-quality news articles as possible about ${company.name}.

You have these keywords to focus on (from the client's monitoring list):
${company.keywords.join(' | ')}

You have ${company.feeds.length} curated RSS feeds available. Available data sources (tools) right now: ${enabledSourceNames.join(', ')}.

Strategy:
1. Start with search_rss_feeds (highest signal, your curated list).
2. Then call search_google_news for broad coverage.
3. If those are insufficient, layer in NewsAPI, Bing News, and scraping.
4. Target at least 100 articles; ideally 150+. If you have far fewer after 4-5 calls, try search_google_news again with extra_terms (synonyms or product names).
5. When you have enough breadth, call finalize_results with a brief reason.

Be efficient — don't call the same tool twice unless adding new query terms. Don't exceed 8 tool calls.`;

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content: `Gather articles for ${company.name}. Begin by calling search_rss_feeds.`,
    },
  ];

  const MAX_ITERATIONS = 10;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    // Did the agent call any tools?
    const toolUses = response.content.filter(
      (c) => c.type === 'tool_use',
    ) as Anthropic.Messages.ToolUseBlock[];

    if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
      trace.push(`[iter ${i}] Agent ended without finalize. Stopping.`);
      break;
    }

    // Check for finalize_results — that's the exit signal
    const finalize = toolUses.find((t) => t.name === 'finalize_results');
    if (finalize) {
      trace.push(`[iter ${i}] Agent finalized: ${(finalize.input as any).reasoning}`);
      break;
    }

    // Otherwise dispatch all tool calls in parallel and feed results back
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        const result = await dispatchTool(tu.name, tu.input, company, pool);
        trace.push(
          `[iter ${i}] tool=${tu.name} got=${result.count} articles. Pool size=${pool.length}.`,
        );
        return {
          type: 'tool_result' as const,
          tool_use_id: tu.id,
          content: `Returned ${result.count} articles. Total pool now: ${pool.length}. Sample:\n${result.sample.join('\n')}`,
        };
      }),
    );

    messages.push({ role: 'user', content: toolResults });
  }

  return { pool, trace };
}

// ----------------------------------------------------------------------------
// RELEVANCE RANKING — second LLM pass.
// We give Claude the deduped pool and ask it to score+explain each article.
// Done in batches because some pools are 300+ articles.
// ----------------------------------------------------------------------------
async function rankArticles(
  client: Anthropic,
  model: string,
  company: Company,
  articles: RawArticle[],
): Promise<RankedArticle[]> {
  if (articles.length === 0) return [];

  // ---- PRE-FILTER ----
  // Don't send 1,600+ articles to the LLM. Cheap keyword screen first:
  // keep only articles whose title or snippet mentions ANY keyword OR the
  // company name. This cuts the ranking workload by ~10x without sacrificing
  // recall (because the multi-source agent loop already covers breadth).
  const companyLower = company.name.toLowerCase();
  const keywordLower = company.keywords.map((k) => k.toLowerCase());
  const candidates = articles.filter((a) => {
    const text = (a.title + ' ' + a.snippet).toLowerCase();
    if (text.includes(companyLower)) return true;
    return keywordLower.some((k) => text.includes(k));
  });

  // Hard cap so a worst-case run is still bounded
  const MAX_TO_RANK = 400;
  const toRank = candidates.slice(0, MAX_TO_RANK);

  const BATCH_SIZE = 25;
  const batches: RawArticle[][] = [];
  for (let i = 0; i < toRank.length; i += BATCH_SIZE) {
    batches.push(toRank.slice(i, i + BATCH_SIZE));
  }

  // ---- PARALLEL BATCH PROCESSING ----
  // Anthropic free/standard tier allows multiple concurrent requests.
  // Run 6 batches at a time so 60 batches finish in ~10 LLM round-trips
  // instead of 60 sequential ones.
  const PARALLEL = 6;
  const ranked: RankedArticle[] = [];

  for (let i = 0; i < batches.length; i += PARALLEL) {
    const group = batches.slice(i, i + PARALLEL);
    const results = await Promise.all(
      group.map((batch, gi) => rankBatch(client, model, company, batch, i + gi)),
    );
    results.forEach((arr) => ranked.push(...arr));
  }

  ranked.sort((a, b) => {
    if (Math.abs(a.relevanceScore - b.relevanceScore) > 0.05)
      return b.relevanceScore - a.relevanceScore;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return ranked;
}

/**
 * Rank a single batch of ~25 articles. Robust against the model returning
 * extra text before/after the JSON array.
 */
async function rankBatch(
  client: Anthropic,
  model: string,
  company: Company,
  batch: RawArticle[],
  batchIndex: number,
): Promise<RankedArticle[]> {
  const numbered = batch
    .map(
      (a, idx) =>
        `[${idx}] SOURCE: ${a.source}\nTITLE: ${a.title}\nSNIPPET: ${a.snippet || '(none)'}`,
    )
    .join('\n\n');

  const prompt = `You are evaluating news articles for a PR-monitoring brief about ${company.name}.

Keywords client cares about: ${company.keywords.join(', ')}

For EACH article below, decide:
- relevance: 0.0–1.0 (1.0 = clearly about ${company.name} or its specific products/topics; 0.0 = unrelated; 0.4 = mentions a keyword but not core subject)
- matchedKeywords: which keywords from the list actually appear or are clearly referenced
- whyPicked: one short sentence explaining why this matters for ${company.name} (or why it's borderline)

Reject articles where the keyword match is incidental (e.g., a high school named "${company.name}", an unrelated article that doesn't involve ${company.name} products, etc.).

CRITICAL: Reply with the JSON array ONLY. No preamble, no markdown, no commentary.
Format: [{"index":0,"relevance":0.95,"matchedKeywords":["..."],"whyPicked":"..."}]

Articles:
${numbered}`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((c) => c.type === 'text') as
      | Anthropic.Messages.TextBlock
      | undefined;
    if (!textBlock) return fallbackRank(batch, company);

    const scored = extractJsonArray(textBlock.text);
    if (!scored) {
      console.warn(`[rank] batch ${batchIndex}: could not extract JSON, using fallback`);
      return fallbackRank(batch, company);
    }

    const out: RankedArticle[] = [];
    for (const s of scored) {
      const a = batch[s.index];
      if (!a) continue;
      if (typeof s.relevance !== 'number' || s.relevance < 0.5) continue;
      out.push({
        ...a,
        relevanceScore: s.relevance,
        matchedKeywords: Array.isArray(s.matchedKeywords) ? s.matchedKeywords : [],
        whyPicked: s.whyPicked || `Mentions ${company.name}.`,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[rank] batch ${batchIndex} threw, using fallback:`, err);
    return fallbackRank(batch, company);
  }
}

interface ScoredItem {
  index: number;
  relevance: number;
  matchedKeywords: string[];
  whyPicked: string;
}

/**
 * Robustly extract a JSON array from a model response that may include
 * preamble ("Here is the analysis:"), markdown fences, or trailing commentary.
 * Returns null if no valid array can be parsed.
 */
function extractJsonArray(text: string): ScoredItem[] | null {
  if (!text) return null;
  let s = text.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

  // Fast path: clean JSON array
  if (s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      // fall through to bracket-extraction
    }
  }

  // Find the first `[` and the matching closing `]` by counting depth.
  // This handles cases like: "Here is the analysis: [...the array...] Hope this helps!"
  const start = s.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Fallback when LLM ranking fails: keep articles whose title or snippet
 * contains a keyword, with a moderate 0.6 score.
 */
function fallbackRank(batch: RawArticle[], company: Company): RankedArticle[] {
  const out: RankedArticle[] = [];
  for (const a of batch) {
    const text = (a.title + ' ' + a.snippet).toLowerCase();
    const matched = company.keywords.filter((k) =>
      text.includes(k.toLowerCase()),
    );
    if (matched.length === 0) continue;
    out.push({
      ...a,
      relevanceScore: 0.6,
      matchedKeywords: matched,
      whyPicked: `Matched keywords: ${matched.join(', ')}.`,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// EXECUTIVE SUMMARY — final LLM pass to write a 2-sentence brief.
// Used in the email and shown at the top of the UI.
// ----------------------------------------------------------------------------
async function writeExecutiveSummary(
  client: Anthropic,
  model: string,
  company: Company,
  topArticles: RankedArticle[],
): Promise<string> {
  if (topArticles.length === 0) return '';
  const sample = topArticles
    .slice(0, 15)
    .map((a) => `- ${a.source}: ${a.title}`)
    .join('\n');

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 250,
      messages: [
        {
          role: 'user',
          content: `Write a 2-3 sentence executive summary of today's top news about ${company.name}, based on these headlines. Focus on themes, not lists. Plain prose, no bullets.

Headlines:
${sample}`,
        },
      ],
    });
    const textBlock = response.content.find((c) => c.type === 'text') as any;
    return textBlock?.text?.trim() || '';
  } catch {
    return '';
  }
}

// ----------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// ----------------------------------------------------------------------------
export interface AgentResult {
  company: string;
  articles: RankedArticle[];
  executiveSummary: string;
  trace: string[];
  stats: {
    totalGathered: number;
    afterDedupe: number;
    afterRanking: number;
    sourcesUsed: string[];
  };
}

export async function runAgent(company: Company): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your environment variables.',
    );
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const client = new Anthropic({ apiKey });

  // Tell the agent which sources are actually available right now
  const enabledNames: string[] = ['search_rss_feeds', 'search_google_news', 'scrape_publications'];
  if (process.env.NEWSAPI_KEY) enabledNames.push('search_newsapi');
  if (process.env.BING_NEWS_API_KEY) enabledNames.push('search_bing_news');

  // Step 1: Run the tool-use loop to gather a raw pool of articles
  const { pool, trace } = await runAgentLoop(client, model, company, enabledNames);
  const sourcesUsed = Array.from(new Set(pool.map((a) => a.sourceType)));

  // Step 2: Dedupe across sources
  const deduped = dedupeArticles(pool);

  // Step 3: LLM relevance ranking + reasoning generation
  const ranked = await rankArticles(client, model, company, sortByDate(deduped));

  // Step 4: Executive summary
  const summary = await writeExecutiveSummary(client, model, company, ranked);

  return {
    company: company.name,
    articles: ranked,
    executiveSummary: summary,
    trace,
    stats: {
      totalGathered: pool.length,
      afterDedupe: deduped.length,
      afterRanking: ranked.length,
      sourcesUsed,
    },
  };
}
