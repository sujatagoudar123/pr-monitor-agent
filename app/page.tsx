'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Search, Mic, MicOff, Volume2, VolumeX, Edit3, Save, X, Mail,
  ExternalLink, Sparkles, TrendingUp, Building2, Loader2, Check,
  AlertCircle, Plus, Tag, Calendar, FileText, Terminal, Brain,
} from 'lucide-react';

interface RankedArticle {
  title: string;
  link: string;
  source: string;
  sourceType: 'rss' | 'google_news' | 'bing_news' | 'newsapi' | 'scrape';
  publishedAt: string;
  snippet: string;
  matchedKeywords: string[];
  whyPicked: string;
  relevanceScore: number;
  imageUrl?: string;
}

interface CompanyMeta {
  name: string;
  keywords: string[];
  feedCount: number;
}

interface SearchResult {
  company: string;
  keywordsUsed: string[];
  articles: RankedArticle[];
  executiveSummary: string;
  stats: {
    totalGathered: number;
    afterDedupe: number;
    afterRanking: number;
    sourcesUsed: string[];
  };
  trace: string[];
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  rss: { label: 'RSS', color: 'bg-blue-100 text-blue-800' },
  google_news: { label: 'Google News', color: 'bg-emerald-100 text-emerald-800' },
  newsapi: { label: 'NewsAPI', color: 'bg-purple-100 text-purple-800' },
  bing_news: { label: 'Bing News', color: 'bg-amber-100 text-amber-800' },
  scrape: { label: 'Scraped', color: 'bg-rose-100 text-rose-800' },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diffHrs = (Date.now() - d.getTime()) / 3600000;
    if (diffHrs < 1) return 'Just now';
    if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;
    if (diffHrs < 48) return 'Yesterday';
    if (diffHrs < 168) return `${Math.floor(diffHrs / 24)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function highlightInText(text: string, keywords: string[]): React.ReactNode {
  if (!text || !keywords.length) return text;
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    const isMatch = sorted.some((k) => k.toLowerCase() === part.toLowerCase());
    return isMatch ? <mark key={i} className="keyword-highlight">{part}</mark> : <span key={i}>{part}</span>;
  });
}

export default function Home() {
  const [companies, setCompanies] = useState<CompanyMeta[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingKeywords, setEditingKeywords] = useState(false);
  const [draftKeywords, setDraftKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [showTrace, setShowTrace] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailStatus, setEmailStatus] = useState<{ type: string; message?: string }>({ type: 'idle' });

  const [recording, setRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    fetch('/api/companies').then((r) => r.json())
      .then((d) => setCompanies(d.companies || []))
      .catch(() => setError('Failed to load companies'));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVoiceSupported(false); return; }
    setVoiceSupported(true);
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInterimTranscript(interim);
      if (final) {
        setQuery(final.trim());
        setInterimTranscript('');
        handleSearch(final.trim());
      }
    };
    rec.onend = () => { setRecording(false); setInterimTranscript(''); };
    rec.onerror = () => { setRecording(false); setInterimTranscript(''); };
    recognitionRef.current = rec;
  }, []);

  const speak = (text: string) => {
    if (!speakerEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.volume = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v => v.lang.startsWith('en') &&
      (v.name.includes('Samantha') || v.name.includes('Google US English') || v.name.includes('Aria')));
    if (pref) u.voice = pref;
    window.speechSynthesis.speak(u);
  };

  const toggleRecording = () => {
    if (!recognitionRef.current) return;
    if (recording) { recognitionRef.current.stop(); setRecording(false); }
    else { setInterimTranscript(''); recognitionRef.current.start(); setRecording(true); }
  };

  const handleSearch = async (raw?: string) => {
    const q = (raw ?? query).trim();
    if (!q) return;
    setLoading(true);
    setLoadingStep('Starting agent…');
    setError(null);
    setResult(null);

    // simulate progress messages for UX (real progress comes from trace at end)
    const steps = [
      'Resolving company…',
      'Agent planning research strategy…',
      'Fetching RSS feeds across publications…',
      'Searching Google News…',
      'Cross-referencing additional sources…',
      'Ranking articles by relevance…',
      'Writing executive summary…',
    ];
    let stepIdx = 0;
    const tick = setInterval(() => {
      if (stepIdx < steps.length) setLoadingStep(steps[stepIdx++]);
    }, 3500);

    try {
      const res = await fetch('/api/agent-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Agent failed');
        speak(data.error || 'Something went wrong.');
        return;
      }
      setResult(data);
      setSelectedCompany(data.company);
      speak(`Found ${data.articles.length} articles for ${data.company} after ranking ${data.stats.afterDedupe} candidates.`);
    } catch (err: any) {
      setError(err.message || 'Network error');
      speak('Search failed. Please try again.');
    } finally {
      clearInterval(tick);
      setLoading(false);
      setLoadingStep('');
    }
  };

  const handleCompanyClick = (n: string) => { setQuery(n); handleSearch(n); };

  const startEditKeywords = () => {
    if (!result) return;
    setDraftKeywords([...result.keywordsUsed]);
    setEditingKeywords(true);
  };

  const saveKeywords = async () => {
    if (!selectedCompany) return;
    try {
      const res = await fetch('/api/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedCompany, keywords: draftKeywords }),
      });
      if (res.ok) {
        setEditingKeywords(false);
        const cRes = await fetch('/api/companies');
        const c = await cRes.json();
        setCompanies(c.companies);
        handleSearch(selectedCompany);
      } else {
        const d = await res.json();
        setError(d.error || 'Failed to save');
      }
    } catch (err: any) { setError(err.message); }
  };

  const addKeyword = () => {
    const t = newKeyword.trim();
    if (t && !draftKeywords.includes(t)) {
      setDraftKeywords([...draftKeywords, t]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw: string) =>
    setDraftKeywords(draftKeywords.filter(k => k !== kw));

  const sendEmail = async () => {
    if (!emailTo || !result?.articles.length) return;
    setEmailStatus({ type: 'sending' });
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo.split(',').map(s => s.trim()).filter(Boolean),
          cc: emailCc ? emailCc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          company: selectedCompany,
          articles: result.articles,
          keywords: result.keywordsUsed,
          executiveSummary: result.executiveSummary,
          subject: `PR Monitor — ${selectedCompany} — ${result.articles.length} articles`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEmailStatus({ type: 'success', message: `Sent to ${data.sentTo.join(', ')}` });
        speak(`Email sent to ${data.sentTo.length} recipients.`);
        setTimeout(() => { setEmailModalOpen(false); setEmailStatus({ type: 'idle' }); }, 2500);
      } else {
        setEmailStatus({ type: 'error', message: data.hint || data.error || 'Failed' });
      }
    } catch (err: any) {
      setEmailStatus({ type: 'error', message: err.message });
    }
  };

  return (
    <div className="min-h-screen bg-ivory">
      <header className="border-b border-border bg-ivory/90 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-navy flex items-center justify-center">
              <Brain className="w-5 h-5 text-gold" />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.2em] text-goldDark font-semibold uppercase">PR Monitor Agent</div>
              <div className="text-base font-serif font-semibold text-navy leading-tight">Claude-powered PR Intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setSpeakerEnabled(!speakerEnabled)}
              className="p-2 rounded-md hover:bg-cream transition text-navy"
              title={speakerEnabled ? 'Mute' : 'Enable voice'}>
              {speakerEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-muted" />}
            </button>
            <div className="hidden md:flex items-center gap-2 text-xs text-muted">
              <Calendar className="w-3.5 h-3.5" />
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <section className="mb-10">
          <h1 className="font-serif text-4xl md:text-5xl text-navy mb-2 leading-tight">
            Which company is the agent<br className="hidden md:block" /> researching today?
          </h1>
          <p className="text-muted text-base mb-8 max-w-2xl">
            Claude reasons step-by-step across your RSS feeds, Google News, NewsAPI, Bing News,
            and HTML scraping — picks the relevant articles, explains why each one was chosen,
            and writes an executive summary.
          </p>

          <div className="relative">
            <div className="flex items-center bg-white border border-border rounded-xl shadow-soft hover:shadow-medium overflow-hidden">
              <div className="pl-5"><Search className="w-5 h-5 text-muted" /></div>
              <input type="text" value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder={interimTranscript || 'Try: "GSK" or "Show me Mazda articles"…'}
                className="flex-1 px-4 py-5 bg-transparent outline-none text-navy placeholder:text-muted text-base" />
              {voiceSupported && (
                <button onClick={toggleRecording}
                  className={`mx-2 p-3 rounded-lg transition ${recording ? 'bg-gold text-navy recording-pulse' : 'bg-cream hover:bg-border text-navy'}`}>
                  {recording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
              <button onClick={() => handleSearch()} disabled={loading || !query.trim()}
                className="bg-navy hover:bg-navyLight disabled:opacity-50 disabled:cursor-not-allowed text-ivory px-7 py-5 font-medium transition">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
              </button>
            </div>
            {recording && (
              <div className="mt-3 flex items-center gap-2 text-sm text-goldDark">
                <span className="inline-block w-2 h-2 rounded-full bg-gold animate-pulse" />Listening…
              </div>
            )}
          </div>

          {companies.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="text-xs text-muted uppercase tracking-wider self-center mr-2">Monitored:</span>
              {companies.map(c => (
                <button key={c.name} onClick={() => handleCompanyClick(c.name)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition ${
                    selectedCompany === c.name
                      ? 'bg-navy text-ivory border-navy'
                      : 'bg-white text-navy border-border hover:border-gold hover:bg-cream'
                  }`}>
                  <Building2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                  {c.name}
                  <span className="ml-2 text-[10px] opacity-60">{c.feedCount} feeds</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 fade-in">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        {loading && (
          <div className="bg-white border border-border rounded-xl p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gold" />
            <div className="font-serif text-xl text-navy mb-2">Agent is working…</div>
            <div className="text-sm text-muted">{loadingStep}</div>
            <div className="text-xs text-muted mt-3 italic">
              The agent may take 30-90 seconds — it's making real LLM calls and reaching multiple data sources in parallel.
            </div>
          </div>
        )}

        {result && !loading && (
          <section className="fade-in">
            {/* Executive summary */}
            {result.executiveSummary && (
              <div className="bg-white border border-border rounded-xl p-6 mb-6 shadow-soft">
                <div className="text-[10px] uppercase tracking-[0.2em] text-goldDark font-semibold mb-2 flex items-center gap-2">
                  <Brain className="w-3 h-3" /> Agent's Executive Summary
                </div>
                <div className="font-serif text-lg text-navy leading-relaxed">{result.executiveSummary}</div>
              </div>
            )}

            {/* Meta header + actions */}
            <div className="bg-white border border-border rounded-xl p-6 mb-6 shadow-soft">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-goldDark font-semibold mb-1">Briefing</div>
                  <h2 className="font-serif text-3xl text-navy">{selectedCompany}</h2>
                  <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted">
                    <span className="flex items-center gap-1.5"><FileText className="w-4 h-4" />
                      <strong className="text-navy">{result.articles.length}</strong> articles</span>
                    <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4" />
                      <strong className="text-navy">{result.stats.afterDedupe}</strong> deduped candidates</span>
                    <span className="flex items-center gap-1.5"><Tag className="w-4 h-4" />
                      <strong className="text-navy">{result.keywordsUsed.length}</strong> keywords</span>
                    <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4" />
                      <strong className="text-navy">{result.stats.sourcesUsed.length}</strong> sources used</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {!editingKeywords && (
                    <button onClick={startEditKeywords}
                      className="px-4 py-2 bg-cream hover:bg-border text-navy text-sm font-medium rounded-lg flex items-center gap-2">
                      <Edit3 className="w-4 h-4" />Edit Keywords
                    </button>
                  )}
                  <button onClick={() => setShowTrace(!showTrace)}
                    className="px-4 py-2 bg-cream hover:bg-border text-navy text-sm font-medium rounded-lg flex items-center gap-2">
                    <Terminal className="w-4 h-4" />{showTrace ? 'Hide' : 'Show'} Agent Trace
                  </button>
                  <button onClick={() => setEmailModalOpen(true)} disabled={!result.articles.length}
                    className="px-4 py-2 bg-navy hover:bg-navyLight disabled:opacity-40 text-ivory text-sm font-medium rounded-lg flex items-center gap-2">
                    <Mail className="w-4 h-4" />Email to Client
                  </button>
                </div>
              </div>

              {!editingKeywords ? (
                <div className="flex flex-wrap gap-1.5">
                  {result.keywordsUsed.map(k => (
                    <span key={k} className="px-2.5 py-1 bg-cream text-navy text-xs rounded-md font-medium border border-border">{k}</span>
                  ))}
                </div>
              ) : (
                <div className="border-t border-border pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold text-navy">Editing keywords</div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingKeywords(false)} className="px-3 py-1.5 text-sm text-muted hover:text-navy">Cancel</button>
                      <button onClick={saveKeywords}
                        className="px-3 py-1.5 bg-success text-white text-sm font-medium rounded-md flex items-center gap-1.5">
                        <Save className="w-3.5 h-3.5" />Save & Re-run Agent
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {draftKeywords.map(k => (
                      <span key={k} className="group px-2.5 py-1 bg-navy text-ivory text-xs rounded-md font-medium flex items-center gap-1.5">
                        {k}<button onClick={() => removeKeyword(k)}><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addKeyword()}
                      placeholder="Add keyword and press Enter"
                      className="flex-1 px-3 py-2 bg-ivory border border-border rounded-md text-sm outline-none focus:border-gold" />
                    <button onClick={addKeyword}
                      className="px-4 py-2 bg-cream hover:bg-border text-navy text-sm font-medium rounded-md flex items-center gap-1.5">
                      <Plus className="w-4 h-4" />Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Agent trace viewer */}
            {showTrace && (
              <div className="bg-white border border-border rounded-xl p-6 mb-6 shadow-soft fade-in">
                <div className="text-[10px] uppercase tracking-[0.2em] text-goldDark font-semibold mb-3 flex items-center gap-2">
                  <Terminal className="w-3 h-3" />Agent Reasoning Trace
                </div>
                <div className="agent-trace">
                  {result.trace.map((line, i) => (<div key={i}>{line}</div>))}
                  <div className="text-muted/70 mt-3 pt-3 border-t border-gold/30">
                    Sources used: {result.stats.sourcesUsed.join(', ')} · Total gathered: {result.stats.totalGathered} · After dedupe: {result.stats.afterDedupe} · After LLM ranking: {result.stats.afterRanking}
                  </div>
                </div>
              </div>
            )}

            {/* Articles */}
            {result.articles.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {result.articles.map((a, i) => {
                  const srcMeta = SOURCE_LABELS[a.sourceType] || { label: a.sourceType, color: 'bg-gray-100 text-gray-700' };
                  return (
                    <article key={`${a.link}-${i}`}
                      className="article-card bg-white border border-border rounded-xl p-6 shadow-soft fade-in"
                      style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] uppercase tracking-wider text-goldDark font-semibold">{a.source}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${srcMeta.color}`}>{srcMeta.label}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted">
                          <span className="font-mono text-goldDark">{(a.relevanceScore * 100).toFixed(0)}%</span>
                          <span>{formatDate(a.publishedAt)}</span>
                        </div>
                      </div>
                      <h3 className="font-serif text-xl text-navy leading-snug mb-3">
                        <a href={a.link} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition">
                          {highlightInText(a.title, a.matchedKeywords)}
                        </a>
                      </h3>
                      <p className="text-sm text-ink/80 leading-relaxed mb-4 line-clamp-4">
                        {highlightInText(a.snippet, a.matchedKeywords)}
                      </p>
                      <div className="bg-cream/60 border-l-2 border-gold px-3 py-2.5 mb-4 rounded-r-md">
                        <div className="text-[10px] uppercase tracking-wider text-goldDark font-semibold mb-1">
                          Agent reasoning · why this was picked
                        </div>
                        <div className="text-xs text-navy/80 leading-relaxed">{a.whyPicked}</div>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-4">
                        {a.matchedKeywords.map(k => (
                          <span key={k} className="px-2 py-0.5 bg-gold/15 text-goldDark text-[11px] rounded-full font-semibold">{k}</span>
                        ))}
                      </div>
                      <a href={a.link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-navy transition">
                        Read full article<ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-border rounded-xl p-12 text-center">
                <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
                <h3 className="font-serif text-xl text-navy mb-2">No relevant articles found</h3>
                <p className="text-sm text-muted">
                  The agent gathered {result.stats.totalGathered} candidates but none scored high enough on relevance.
                  Try editing keywords or check back later.
                </p>
              </div>
            )}
          </section>
        )}

        {!selectedCompany && !loading && !error && (
          <div className="text-center py-16">
            <div className="inline-block bg-white border border-border rounded-2xl p-10 shadow-soft max-w-xl">
              <div className="w-14 h-14 rounded-xl bg-cream flex items-center justify-center mx-auto mb-4">
                <Brain className="w-7 h-7 text-goldDark" />
              </div>
              <h3 className="font-serif text-2xl text-navy mb-3">Ready when you are.</h3>
              <p className="text-sm text-muted leading-relaxed">
                Pick a company above, or type one. Claude will plan a research strategy,
                hit multiple data sources, rank each article by relevance, and explain its reasoning.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Email modal */}
      {emailModalOpen && (
        <div className="fixed inset-0 bg-navy/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div className="bg-ivory rounded-2xl shadow-strong max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif text-2xl text-navy">Email to Client</h3>
              <button onClick={() => setEmailModalOpen(false)} className="p-1 hover:bg-cream rounded text-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-navy uppercase tracking-wider block mb-1.5">Recipient (To)</label>
                <input type="text" value={emailTo} onChange={e => setEmailTo(e.target.value)}
                  placeholder="client@example.com, another@example.com"
                  className="w-full px-3 py-2.5 bg-white border border-border rounded-md text-sm outline-none focus:border-gold" />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy uppercase tracking-wider block mb-1.5">CC (optional)</label>
                <input type="text" value={emailCc} onChange={e => setEmailCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="w-full px-3 py-2.5 bg-white border border-border rounded-md text-sm outline-none focus:border-gold" />
              </div>
              <div className="bg-cream rounded-md p-3 text-xs text-navy/70">
                <strong className="text-navy">{result?.articles.length}</strong> articles plus the agent's executive summary
                will be sent via AWS SES SMTP, formatted with highlighted keywords and reasoning.
              </div>
              {emailStatus.type === 'success' && (
                <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800 flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />{emailStatus.message}
                </div>
              )}
              {emailStatus.type === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{emailStatus.message}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEmailModalOpen(false)}
                  className="flex-1 py-2.5 bg-white border border-border text-navy text-sm font-medium rounded-md hover:bg-cream">Cancel</button>
                <button onClick={sendEmail} disabled={!emailTo.trim() || emailStatus.type === 'sending'}
                  className="flex-1 py-2.5 bg-navy hover:bg-navyLight disabled:opacity-50 text-ivory text-sm font-medium rounded-md flex items-center justify-center gap-2">
                  {emailStatus.type === 'sending' ? (<><Loader2 className="w-4 h-4 animate-spin" />Sending…</>)
                    : (<><Mail className="w-4 h-4" />Send</>)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-border bg-cream mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted">
          <div>PR Monitor Agent · Powered by Claude · RSS + Google News + NewsAPI + Bing News + Scraping · AWS SES email</div>
          <div className="flex items-center gap-2"><Brain className="w-3 h-3 text-gold" />Actually agentic.</div>
        </div>
      </footer>
    </div>
  );
}
