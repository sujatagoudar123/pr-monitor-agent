# PR Monitor Agent v2 — Actually Agentic.

A production-ready, Claude-powered PR-monitoring agent that gathers news articles about your monitored companies from **5 sources in parallel**, then uses an LLM to rank relevance and explain why each article matters.

This is **v2** — the genuinely agentic rebuild. Where v1 was "regex matching across RSS feeds in a nice UI," v2 has Claude planning the research, calling tools, and reasoning about each article.

---

## What "agentic" means here

```
User: "GSK"
   ↓
Step 1 — PLAN: Claude reads the company name + 24 keywords from your Excel,
              decides which data sources to query first.

Step 2 — TOOL CALLS (chosen by Claude, executed in parallel):
   • search_rss_feeds       → your 44 GSK RSS feeds
   • search_google_news     → broad coverage, no API key needed
   • search_newsapi         → if NEWSAPI_KEY is set
   • search_bing_news       → if BING_NEWS_API_KEY is set
   • scrape_publications    → FiercePharma, STAT, Endpoints, Reuters Health…

Step 3 — OBSERVE: Claude sees how many articles came back, samples titles.

Step 4 — DECIDE: "Got 280 articles, that's enough" or "Only 40, let me try
                 search_google_news again with extra_terms=['Arexvy','Shingrix']"

Step 5 — DEDUPE: Same article from RSS + Google News collapses to one entry.

Step 6 — RANK: Claude reads each article (in batches of 25) and assigns:
              - relevance score 0.0–1.0
              - which of your keywords actually matched
              - a one-sentence "why this was picked" rationale

Step 7 — SUMMARIZE: Claude writes a 2-3 sentence executive briefing of the day.
```

The full agent trace is visible in the UI (click "Show Agent Trace") so you can audit exactly what the agent did at each step.

---

## Features

- **Actually agentic** — Claude tool-use loop, not regex pattern matching.
- **5 data sources in parallel** — RSS, Google News, NewsAPI, Bing News, HTML scraping.
- **LLM-ranked relevance** — every article scored 0–1.0; only ≥0.5 shown.
- **LLM-written rationales** — each "why this was picked" is generated, not templated.
- **Executive summary** — Claude writes a 2-3 sentence briefing at the top.
- **Editable keywords per company** — edit live, agent re-runs.
- **Voice in / voice out** — Web Speech API, zero cost.
- **Email to client** — AWS SES SMTP via nodemailer, Fortune-500 HTML template.
- **Source-type badges** — see whether each article came from RSS, Google News, scraping, etc.
- **Agent trace viewer** — full auditability of every tool call and result.
- **7 companies + 86 keywords + 279 RSS feeds** pre-loaded from your Excel files.

---

## Setup

### 1. Install

```bash
git clone <repo>
cd pr-monitor-agent
npm install
cp .env.example .env.local
```

### 2. Configure env vars

Edit `.env.local`:

```bash
# REQUIRED — the agent's brain
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # cheap/fast; switch to sonnet for smarter ranking

# OPTIONAL — extra news sources
NEWSAPI_KEY=                # https://newsapi.org (free 100/day)
BING_NEWS_API_KEY=          # Azure Bing Search v7 (free 1k/mo)
# Google News needs no key — it just works.
# HTML scraping needs no key.

# REQUIRED for email — AWS SES SMTP
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIA...           # SES SMTP username (NOT your IAM access key)
SMTP_PASS=...               # SES SMTP password
SMTP_FROM="PR Monitor <pr-monitor@yourverifieddomain.com>"
```

#### Getting AWS SES SMTP credentials

1. AWS Console → **SES** (Simple Email Service, *not* SNS).
2. Choose a region (e.g., us-east-1, ap-south-1).
3. **Verified identities** → verify your sender domain or email.
4. **SMTP Settings** → **Create SMTP credentials** → AWS will create an IAM user and give you a username/password specifically for SMTP. Save them.
5. If you're still in the SES sandbox, you can only send to verified emails. To send to clients, request **production access** in the SES console.

#### Getting an Anthropic API key

Go to https://console.anthropic.com → API keys → Create key.

Cost estimate per company search (with Claude Haiku):
- Agent loop: ~5 LLM calls × ~$0.0001 = $0.0005
- Ranking 200 articles in batches: ~8 calls × ~$0.002 = $0.016
- Summary: 1 call × ~$0.0005 = $0.0005
- **Total: ~$0.02 per search** with Haiku. With Sonnet, ~10× that.

### 3. Run locally

```bash
npm run dev
# → http://localhost:3000
```

### 4. Deploy to Vercel

```bash
vercel
# Or push to GitHub and import at vercel.com/new
```

Add all env vars in the Vercel dashboard. The included `vercel.json` already sets `maxDuration: 300` on the agent endpoint (you need a Vercel Pro plan or higher; Hobby tier caps at 60s which may not be enough for the full agent loop on a slow day).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  • Web Speech API (mic + speakers)                           │
│  • React 18 + Tailwind                                       │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  Next.js App Router                                          │
│  • /api/agent-search   → kicks off the agent                 │
│  • /api/companies      → list, edit keywords                 │
│  • /api/send-email     → AWS SES SMTP via nodemailer         │
│  • /api/health         → env diagnostics                     │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  lib/agent/agent.ts — THE AGENT                              │
│                                                              │
│  1. runAgentLoop(client, model, company, sources)            │
│     – Anthropic SDK tool-use loop                            │
│     – Claude decides which sources to query, in what order   │
│     – Up to 10 iterations, 8 tool calls                      │
│                                                              │
│  2. dedupeArticles()                                         │
│     – URL normalization (strip UTM, lowercase host)          │
│     – Title-based fallback dedup                             │
│     – Prefers direct URLs over Google News wrappers          │
│                                                              │
│  3. rankArticles()                                           │
│     – Batches of 25 articles                                 │
│     – Claude returns JSON: relevance, matchedKeywords, why   │
│     – Drops anything < 0.5 relevance                         │
│                                                              │
│  4. writeExecutiveSummary()                                  │
│     – Final LLM pass, 2-3 sentences                          │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  lib/sources/* — DATA SOURCES                                │
│                                                              │
│  • rss.ts          → 279 curated feeds from your Excel       │
│  • google-news.ts  → Google News RSS (no key, ~unlimited)    │
│  • newsapi.ts      → NewsAPI.org (key required)              │
│  • bing-news.ts    → Bing News v7 (Azure key required)       │
│  • scrape.ts       → cheerio scraping of fiercepharma,       │
│                      statnews, endpts, reuters healthcare    │
└──────────────────────────────────────────────────────────────┘
```

---

## API reference

### `POST /api/agent-search`

Body: `{ "company": "GSK" }`

Response:
```json
{
  "company": "GSK",
  "keywordsUsed": [...],
  "executiveSummary": "Today's GSK coverage focused on Q3 vaccine revenue beats and the latest RSV booster trial data...",
  "articles": [{
    "title": "...",
    "link": "...",
    "source": "BBC",
    "sourceType": "rss",
    "publishedAt": "...",
    "snippet": "...",
    "matchedKeywords": ["GSK", "Vaccine"],
    "whyPicked": "Reports on GSK's Q3 earnings beat driven by vaccine revenue.",
    "relevanceScore": 0.95
  }],
  "stats": {
    "totalGathered": 287,
    "afterDedupe": 142,
    "afterRanking": 98,
    "sourcesUsed": ["rss", "google_news", "scrape"]
  },
  "trace": [
    "[iter 0] tool=search_rss_feeds got=78 articles. Pool size=78.",
    "[iter 1] tool=search_google_news got=145 articles. Pool size=223.",
    "[iter 2] tool=scrape_publications got=64 articles. Pool size=287.",
    "[iter 3] Agent finalized: Gathered 287 articles across 3 sources, sufficient breadth."
  ]
}
```

### `GET /api/companies`

Lists all monitored companies + keywords + feed counts.

### `PATCH /api/companies`

```json
{ "name": "GSK", "keywords": ["new", "list"] }
```

### `POST /api/send-email`

```json
{
  "to": "client@example.com",
  "cc": "manager@example.com",
  "company": "GSK",
  "articles": [...],
  "keywords": [...],
  "executiveSummary": "..."
}
```

### `GET /api/health`

Diagnostic endpoint — shows which env vars and sources are configured.

---

## Cost & rate limits

| Service | Free tier | Cost |
|---|---|---|
| Anthropic Claude Haiku | None | ~$0.02 per company search |
| Anthropic Claude Sonnet | None | ~$0.20 per company search |
| Google News RSS | Unlimited | Free |
| NewsAPI.org | 100/day | $449/mo for more |
| Bing News v7 | 1k/mo | $7 per 1k calls |
| HTML scraping | Unlimited | Free |
| AWS SES | 62k/mo from EC2 free | $0.10 per 1k |

For a small team doing 10-20 company searches per day, total monthly cost should be under $20.

---

## Production checklist

- ✅ All API routes set `dynamic = 'force-dynamic'`
- ✅ `maxDuration: 300` on agent endpoint (Vercel Pro required for >60s)
- ✅ Source connectors all timeout at 9-10s individually
- ✅ Individual source failures fall through silently — one bad source never breaks the agent
- ✅ LLM ranking failures fall back to regex keyword matching
- ✅ URL normalization strips UTM params for clean dedup
- ✅ XSS-safe keyword highlighting (escapes HTML before inserting `<mark>`)
- ✅ Email HTML responsive, renders in Gmail/Outlook/Apple Mail
- ✅ Web Speech API gracefully degrades on unsupported browsers
- ✅ `/api/health` endpoint for ops to verify env config in prod

---

## Notes on the SES vs SNS thing

In your earlier message you said "AWS SNS". SNS (Simple Notification Service) is pub/sub for system-to-system messaging — it doesn't send formatted emails to end users. **SES (Simple Email Service)** is what you want for sending PR-briefing emails to clients. This project uses SES SMTP. If you genuinely meant SNS (e.g., to publish to an SNS topic that then triggers other automation), open an issue and I'll add an alternative SNS path — but for email-to-client, SES is correct.
