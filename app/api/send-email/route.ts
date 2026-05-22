import { NextRequest, NextResponse } from 'next/server';
import { buildEmailHTML, sendEmail } from '@/lib/email/sender';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to, cc, subject, company, articles, keywords, executiveSummary } = body;

    if (!to || !articles?.length) {
      return NextResponse.json(
        { error: 'Required: { to, company, articles, keywords }' },
        { status: 400 },
      );
    }

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json(
        {
          success: false,
          error: 'SMTP not configured',
          hint: 'Set SMTP_HOST, SMTP_USER, SMTP_PASS (AWS SES SMTP credentials). See .env.example.',
        },
        { status: 200 },
      );
    }

    const html = buildEmailHTML({ company, articles, keywords, executiveSummary });
    const recipients = (Array.isArray(to) ? to : to.split(',')).map((s: string) => s.trim()).filter(Boolean);
    const ccList = cc
      ? (Array.isArray(cc) ? cc : cc.split(',')).map((s: string) => s.trim()).filter(Boolean)
      : undefined;

    const result = await sendEmail({
      to: recipients,
      cc: ccList,
      subject: subject || `PR Monitor — ${company} — ${articles.length} articles`,
      html,
    });

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      sentTo: recipients,
    });
  } catch (err: any) {
    console.error('[send-email] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to send email' },
      { status: 500 },
    );
  }
}
