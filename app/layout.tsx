import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PR Monitor Agent — Agentic PR Intelligence',
  description:
    'Claude-powered PR monitoring agent. Aggregates from RSS, Google News, NewsAPI, Bing News, and HTML scraping.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
