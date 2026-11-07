'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, candidateAuthRedirect } from '../../../lib/api';

interface Recommendation {
  jobId: string;
  companyId: string;
  companyName: string;
  companyWebsiteUrl: string | null;
  title: string;
  location: string | null;
  workMode: string | null;
  applicationUrl: string | null;
  applicationDeadline?: string | null;
  score: number;
  reasons: string[];
  categories: string[];
  trackingStatus: string | null;
  isMatch?: boolean;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** Research URLs are untrusted data; only web links may become clickable actions. */
function webUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Load all crawled jobs with preference matches placed at top. */
export function Recommendations() {
  const router = useRouter();
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'matches'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<Recommendation[]>('/candidate/recommendations?limit=50', { signal: controller.signal })
      .then((results) => {
        if (!controller.signal.aborted) setRows(results);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        const destination = candidateAuthRedirect(reason);
        if (destination) router.replace(destination);
        else
          setError(
            reason instanceof Error ? reason.message : 'Recommendations could not be loaded.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, router]);

  /** Company state applies to every recommendation from that company, not just this job. */
  async function track(companyId: string, status: 'PLANNING' | 'APPLIED' | 'EXCLUDED') {
    setSaving(true);
    setError('');
    try {
      await api('/candidate/pipeline/company-state', {
        method: 'POST',
        body: JSON.stringify({ companyId, status }),
      });
      setRows((current) =>
        status === 'EXCLUDED'
          ? current.filter((row) => row.companyId !== companyId)
          : current.map((row) =>
              row.companyId === companyId ? { ...row, trackingStatus: status } : row,
            ),
      );
      if (status === 'EXCLUDED') setRevision((value) => value + 1);
    } catch (reason) {
      const destination = candidateAuthRedirect(reason);
      if (destination) router.replace(destination);
      else
        setError(reason instanceof Error ? reason.message : 'Company status could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const matchCount = rows.filter((r) => r.isMatch || r.score > 0).length;
  const displayedRows =
    filterMode === 'matches' ? rows.filter((r) => r.isMatch || r.score > 0) : rows;

  return (
    <section aria-labelledby="recommendations-heading" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-0.5">
            Discovered Openings
          </p>
          <h2
            id="recommendations-heading"
            className="text-xl font-bold tracking-tight text-neutral-950"
          >
            Crawled Jobs & Matches
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Showing all openings found in crawling · Preference matches prioritized at the top
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Filter toggle */}
          <div className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-50 text-xs">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-black text-white shadow-none'
                  : 'text-neutral-600 hover:text-black'
              }`}
            >
              All Openings ({rows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('matches')}
              className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
                filterMode === 'matches'
                  ? 'bg-black text-white shadow-none'
                  : 'text-neutral-600 hover:text-black'
              }`}
            >
              Matches ({matchCount})
            </button>
          </div>

          <Link href="/candidate/jobs" className="btn-pill-primary text-xs px-3.5 py-1.5">
            Explore All in Jobs ↗
          </Link>
          <button
            type="button"
            className="btn-pill-secondary text-xs px-3 py-1.5"
            disabled={loading || saving}
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-neutral-400">Loading discovered jobs…</div>
      ) : displayedRows.length === 0 ? (
        <div className="py-12 text-center text-sm text-neutral-400 border border-neutral-100 rounded-2xl">
          {filterMode === 'matches'
            ? 'No current jobs meet your match threshold. Click "All Openings" to view all discovered jobs, or explore the Jobs catalog.'
            : 'No jobs found in crawling yet. Run a Quick Search or wait for the next scheduled crawler run.'}
        </div>
      ) : (
        <div className="grid gap-4">
          {displayedRows.map((row) => {
            const website = webUrl(row.companyWebsiteUrl);
            const application = webUrl(row.applicationUrl);
            const isMatch = Boolean(row.isMatch || row.score > 0);

            return (
              <article
                className={`p-5 rounded-2xl border transition space-y-3 bg-white ${
                  isMatch
                    ? 'border-neutral-200 hover:border-neutral-300'
                    : 'border-neutral-100 hover:border-neutral-200'
                }`}
                key={row.jobId}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-neutral-900 leading-snug">
                        {row.title}
                      </h3>
                      {isMatch && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          Profile Match
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-500 mt-0.5">
                      {website ? (
                        <a
                          href={website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-neutral-800 hover:underline"
                        >
                          {row.companyName} ↗
                        </a>
                      ) : (
                        <span className="font-medium text-neutral-800">{row.companyName}</span>
                      )}
                      <span>·</span>
                      <span>{row.location ?? 'Location not listed'}</span>
                      {row.workMode && (
                        <>
                          <span>·</span>
                          <span>{row.workMode}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isMatch ? (
                      <span className="badge-success text-xs font-semibold">
                        Match: {row.score}%
                      </span>
                    ) : (
                      <span className="badge-neutral text-xs font-medium text-neutral-500">
                        Crawled Opening
                      </span>
                    )}
                    {row.trackingStatus && (
                      <span
                        className={
                          row.trackingStatus === 'APPLIED'
                            ? 'badge-success text-xs font-semibold'
                            : 'badge-warning text-xs font-semibold'
                        }
                      >
                        {row.trackingStatus === 'APPLIED' ? 'Applied' : 'Planning'}
                      </span>
                    )}
                  </div>
                </div>

                {row.applicationDeadline && (
                  <p className="text-xs text-neutral-400">
                    Application deadline: {formatDate(row.applicationDeadline)}
                  </p>
                )}

                {row.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.categories.map((cat) => (
                      <span key={cat} className="tag-pill text-[11px]">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                {row.reasons.length > 0 && (
                  <ul className="text-xs text-neutral-500 space-y-0.5 pl-4 list-disc">
                    {row.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-50">
                  <div>
                    {application && (
                      <a
                        href={application}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-neutral-900 hover:underline"
                      >
                        Apply on company site ↗
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || row.trackingStatus === 'PLANNING'}
                      onClick={() => void track(row.companyId, 'PLANNING')}
                      className={`btn-pill-secondary text-xs px-3.5 py-1 ${row.trackingStatus === 'PLANNING' ? 'bg-amber-50 border-amber-200 text-amber-800' : ''}`}
                    >
                      Plan
                    </button>
                    <button
                      type="button"
                      disabled={saving || row.trackingStatus === 'APPLIED'}
                      onClick={() => void track(row.companyId, 'APPLIED')}
                      className={`btn-pill-primary text-xs px-3.5 py-1 ${row.trackingStatus === 'APPLIED' ? 'bg-emerald-700' : ''}`}
                    >
                      Applied
                    </button>
                    <button
                      type="button"
                      className="btn-pill-danger text-xs px-3.5 py-1"
                      disabled={saving}
                      onClick={() => void track(row.companyId, 'EXCLUDED')}
                    >
                      Blacklist
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
