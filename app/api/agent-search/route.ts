import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent/agent';
import { getCompany, resolveCompanyName } from '@/lib/companies';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company: input } = body;

    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing "company" field' }, { status: 400 });
    }

    const resolved = resolveCompanyName(input);
    if (!resolved) {
      return NextResponse.json(
        {
          error: `Company "${input}" not found. Available: GSK, Mazda, Trane, BeOne, Amgen, Otsuka, Indivior.`,
        },
        { status: 404 },
      );
    }

    const company = getCompany(resolved);
    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const result = await runAgent(company);

    return NextResponse.json({
      company: result.company,
      keywordsUsed: company.keywords,
      articles: result.articles,
      executiveSummary: result.executiveSummary,
      stats: result.stats,
      trace: result.trace,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: any) {
    console.error('[agent-search] error:', err);
    return NextResponse.json(
      { error: err.message || 'Agent failed' },
      { status: 500 },
    );
  }
}
