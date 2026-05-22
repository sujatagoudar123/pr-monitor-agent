import nodemailer from 'nodemailer';
import { RankedArticle } from '../sources/types';

// XSS-safe keyword highlighting for HTML email bodies.
export function highlightKeywordsHtml(
  text: string,
  keywords: string[],
): string {
  if (!text) return '';
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    if (!kw) continue;
    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(`(${escapedKw})`, 'gi');
      escaped = escaped.replace(
        regex,
        '<mark style="background:linear-gradient(180deg,transparent 60%,#FBE9A0 60%);padding:0 2px;font-weight:600;color:#0A2540;">$1</mark>',
      );
    } catch {
      continue;
    }
  }
  return escaped;
}

export function buildEmailHTML(opts: {
  company: string;
  articles: RankedArticle[];
  keywords: string[];
  executiveSummary?: string;
}): string {
  const { company, articles, keywords, executiveSummary } = opts;
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const articleBlocks = articles
    .map(
      (a) => `
    <tr><td style="padding:24px 0;border-bottom:1px solid #E5DFD3;">
      <div style="font-size:12px;color:#6B7280;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">
        ${a.source} &middot; ${new Date(a.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </div>
      <h2 style="font-family:Georgia,serif;font-size:20px;line-height:1.3;color:#0A2540;margin:0 0 12px 0;font-weight:600;">
        <a href="${a.link}" style="color:#0A2540;text-decoration:none;">${highlightKeywordsHtml(a.title, a.matchedKeywords)}</a>
      </h2>
      <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 12px 0;">
        ${highlightKeywordsHtml(a.snippet, a.matchedKeywords)}
      </p>
      <div style="background:#FAF7F2;border-left:3px solid #C9A961;padding:10px 14px;margin:12px 0 0 0;font-size:13px;color:#4B5563;">
        <strong style="color:#0A2540;">Why this matters:</strong> ${a.whyPicked}
      </div>
      <div style="margin-top:12px;">
        ${a.matchedKeywords
          .map(
            (k) =>
              `<span style="display:inline-block;background:#F4EFE6;color:#0A2540;font-size:11px;padding:3px 10px;border-radius:12px;margin-right:6px;margin-bottom:4px;font-weight:600;">${k}</span>`,
          )
          .join('')}
      </div>
      <a href="${a.link}" style="display:inline-block;margin-top:14px;color:#0F4C81;font-size:14px;font-weight:600;text-decoration:none;">
        Read full article →
      </a>
    </td></tr>
  `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>PR Monitor — ${company}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6;padding:40px 20px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#FAF7F2;border:1px solid #E5DFD3;max-width:640px;">
        <tr><td style="padding:36px 40px;border-bottom:2px solid #C9A961;">
          <div style="font-size:11px;color:#C9A961;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;">PR Monitor &middot; Agent Briefing</div>
          <h1 style="font-family:Georgia,serif;font-size:32px;color:#0A2540;margin:8px 0 0 0;font-weight:400;">${company}</h1>
          <div style="font-size:14px;color:#6B7280;margin-top:6px;">${dateStr}</div>
        </td></tr>
        ${
          executiveSummary
            ? `<tr><td style="padding:24px 40px;background:#fff;border-bottom:1px solid #E5DFD3;">
          <div style="font-size:11px;color:#A0813F;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Executive Summary</div>
          <div style="font-family:Georgia,serif;font-size:16px;color:#0A2540;line-height:1.5;">${executiveSummary}</div>
        </td></tr>`
            : ''
        }
        <tr><td style="padding:18px 40px;background:#fff;">
          <div style="font-size:13px;color:#374151;line-height:1.6;">
            <strong>${articles.length}</strong> articles selected from across your monitored sources.
            Keywords tracked: <em>${keywords.slice(0, 10).join(', ')}${keywords.length > 10 ? ', …' : ''}</em>.
          </div>
        </td></tr>
        <tr><td style="padding:0 40px;">
          <table width="100%" cellpadding="0" cellspacing="0">${articleBlocks}</table>
        </td></tr>
        <tr><td style="padding:32px 40px;background:#0A2540;color:#FAF7F2;">
          <div style="font-size:12px;opacity:0.7;letter-spacing:0.05em;">PR MONITOR &middot; AGENTIC PR INTELLIGENCE</div>
          <div style="font-size:13px;margin-top:8px;opacity:0.85;">Articles selected by an AI agent across RSS, Google News, NewsAPI, Bing News, and scraping fallbacks.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP credentials missing. Set SMTP_HOST, SMTP_USER, SMTP_PASS in your env.',
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465=SSL, 587=STARTTLS (SES recommends 587)
    auth: { user, pass },
  });
  return cachedTransporter;
}

export async function sendEmail(opts: {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
}): Promise<{ messageId: string }> {
  const from = process.env.SMTP_FROM || 'PR Monitor <no-reply@example.com>';
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from,
    to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
    cc: opts.cc ? (Array.isArray(opts.cc) ? opts.cc.join(',') : opts.cc) : undefined,
    subject: opts.subject,
    html: opts.html,
  });
  return { messageId: info.messageId };
}
