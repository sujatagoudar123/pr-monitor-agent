// Strip HTML tags, decode common entities, normalize whitespace.
export function cleanText(html: string = ''): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Fetch with timeout. Vercel functions die at maxDuration so we cap each call.
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 9000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; PR-Monitor-Agent/2.0; +https://prmonitor.ai)',
        Accept:
          'application/rss+xml, application/json, application/xml, text/xml, text/html, */*',
        ...(opts.headers || {}),
      },
      cache: 'no-store',
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Normalize URLs so the same article fetched from different sources dedupes properly.
export function normalizeUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Strip tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'ref_src',
    ];
    trackingParams.forEach((p) => u.searchParams.delete(p));
    // Remove trailing slash, lowercase host
    u.host = u.host.toLowerCase();
    let normalized = u.toString();
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return url;
  }
}
