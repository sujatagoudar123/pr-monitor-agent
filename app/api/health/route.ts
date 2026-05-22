import { NextResponse } from 'next/server';
import { allSources } from '@/lib/sources';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      NEWSAPI_KEY: !!process.env.NEWSAPI_KEY,
      BING_NEWS_API_KEY: !!process.env.BING_NEWS_API_KEY,
      SMTP_HOST: !!process.env.SMTP_HOST,
      SMTP_USER: !!process.env.SMTP_USER,
      SMTP_PASS: !!process.env.SMTP_PASS,
      SMTP_FROM: process.env.SMTP_FROM || '(not set)',
    },
    sources: allSources.map((s) => ({
      name: s.name,
      enabled: s.enabled,
    })),
  });
}
