import { NextRequest, NextResponse } from 'next/server';
import {
  getAllCompanies,
  getCompany,
  updateCompanyKeywords,
} from '@/lib/companies';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');
  if (name) {
    const c = getCompany(name);
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(c);
  }
  return NextResponse.json({
    companies: getAllCompanies().map((c) => ({
      name: c.name,
      keywords: c.keywords,
      feedCount: c.feeds.length,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const { name, keywords } = await req.json();
    if (!name || !Array.isArray(keywords)) {
      return NextResponse.json(
        { error: 'Provide { name: string, keywords: string[] }' },
        { status: 400 },
      );
    }
    const updated = updateCompanyKeywords(name, keywords);
    if (!updated)
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    return NextResponse.json({ success: true, company: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
