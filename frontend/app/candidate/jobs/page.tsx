'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, candidateAuthRedirect } from '../../../lib/api';
import { safeExternalUrl } from '../../../lib/external-url';
import { CandidateNav } from '../components/candidate-nav';

interface JobRow {
  id: string;
  companyId: string;
  companyName: string;
  companyWebsiteUrl: string | null;
  title: string;
  location: string | null;
  workMode: string | null;
  skills: string | null;
  experience: string | null;
  applicationUrl: string | null;
  applicationDeadline: string | null;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  jobCategories: string[];
  companyCategories: string[];
  trackingStatus: string | null;
  score: number;
  reasons: string[];
  isMatch: boolean;
}

interface JobPage {
  total: number;
  page: number;
  pageSize: number;
  matchedCount: number;
  rows: JobRow[];
}

interface CategoryCount {
  id: string;
  name: string;
  type: string;
  jobCount: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function isPastDeadline(iso: string | null): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

export default function CandidateJobsPage() {
  const router = useRouter();

  // Filter state
  const [filters, setFilters] = useState({
    search: '',
    technology: '',
    domain: '',
    sector: '',
    categoryScope: 'all' as 'all' | 'job' | 'company',
    workMode: '',
    status: 'OPEN',
    matchedOnly: false,
    sortBy: 'match' as 'match' | 'recent',
  });

  const [searchInput, setSearchInput] = useState('');
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [categoryTab, setCategoryTab] = useState<'all' | 'technology' | 'domain' | 'sector'>('all');
  const [showCategoryTable, setShowCategoryTable] = useState(false);

  // Accumulated rows and pagination state for infinite scroll / lazy loading
  const [rows, setRows] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [savingCompanyId, setSavingCompanyId] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const pageSize = 25;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = page < totalPages && rows.length < total;

  // 1. Fetch category intelligence once on mount
  useEffect(() => {
    const controller = new AbortController();
    api<CategoryCount[]>('/candidate/jobs/categories', { signal: controller.signal })
      .then((data) => setCategories(data))
      .catch((err) => {
        if (!controller.signal.aborted) {
          const dest = candidateAuthRedirect(err);
          if (dest) router.replace(dest);
        }
      });
    return () => controller.abort();
  }, [router]);

  // 2. Fetch initial batch (Page 1) when filters change
  const loadInitial = useCallback(
    async (signal?: AbortSignal) => {
      const id = ++requestId.current;
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({
          page: '1',
          pageSize: String(pageSize),
          sortBy: filters.sortBy,
        });

        if (filters.search) params.set('search', filters.search);
        if (filters.status) params.set('status', filters.status);
        if (filters.technology) params.set('technology', filters.technology);
        if (filters.domain) params.set('domain', filters.domain);
        if (filters.sector) params.set('sector', filters.sector);
        if (filters.categoryScope !== 'all') params.set('categoryScope', filters.categoryScope);
        if (filters.workMode) params.set('workMode', filters.workMode);
        if (filters.matchedOnly) params.set('matchedOnly', 'true');

        const data = await api<JobPage>(`/candidate/jobs?${params.toString()}`, { signal });
        if (signal?.aborted || id !== requestId.current) return;

        setRows(data.rows);
        setTotal(data.total);
        setMatchedCount(data.matchedCount);
        setPage(1);
      } catch (err) {
        if (signal?.aborted || id !== requestId.current) return;
        const dest = candidateAuthRedirect(err);
        if (dest) {
          router.replace(dest);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load jobs.');
      } finally {
        if (!signal?.aborted && id === requestId.current) {
          setLoading(false);
        }
      }
    },
    [filters, router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadInitial(controller.signal);
    return () => {
      controller.abort();
      requestId.current += 1;
    };
  }, [loadInitial]);

  // 3. Lazy Load Next Page (Infinite Scroll)
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const nextPage = page + 1;
    const id = requestId.current;
    setLoadingMore(true);

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(pageSize),
        sortBy: filters.sortBy,
      });

      if (filters.search) params.set('search', filters.search);
      if (filters.status) params.set('status', filters.status);
      if (filters.technology) params.set('technology', filters.technology);
      if (filters.domain) params.set('domain', filters.domain);
      if (filters.sector) params.set('sector', filters.sector);
      if (filters.categoryScope !== 'all') params.set('categoryScope', filters.categoryScope);
      if (filters.workMode) params.set('workMode', filters.workMode);
      if (filters.matchedOnly) params.set('matchedOnly', 'true');

      const data = await api<JobPage>(`/candidate/jobs?${params.toString()}`);
      if (id !== requestId.current) return;

      setRows((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const novel = data.rows.filter((r) => !existingIds.has(r.id));
        return [...prev, ...novel];
      });
      setTotal(data.total);
      setMatchedCount(data.matchedCount);
      setPage(nextPage);
    } catch (err) {
      if (id !== requestId.current) return;
      const dest = candidateAuthRedirect(err);
      if (dest) {
        router.replace(dest);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load more jobs.');
    } finally {
      if (id === requestId.current) {
        setLoadingMore(false);
      }
    }
  }, [filters, hasMore, loading, loadingMore, page, router]);

  // 4. Setup Intersection Observer for scrolling sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          void loadMore();
        }
      },
      { rootMargin: '300px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMore]);

  // 5. Track company pipeline status
  async function track(companyId: string, status: 'PLANNING' | 'APPLIED' | 'EXCLUDED') {
    setSavingCompanyId(companyId);
    setError('');
    try {
      await api('/candidate/pipeline/company-state', {
        method: 'POST',
        body: JSON.stringify({ companyId, status }),
      });

      if (status === 'EXCLUDED') {
        setRows((prev) => prev.filter((r) => r.companyId !== companyId));
        setTotal((prev) => Math.max(0, prev - 1));
      } else {
        setRows((prev) =>
          prev.map((r) => (r.companyId === companyId ? { ...r, trackingStatus: status } : r)),
        );
      }
    } catch (err) {
      const dest = candidateAuthRedirect(err);
      if (dest) router.replace(dest);
      else setError(err instanceof Error ? err.message : 'Failed to save pipeline status.');
    } finally {
      setSavingCompanyId(null);
    }
  }

  function handleSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFilters((prev) => ({
      ...prev,
      search: searchInput.trim(),
    }));
  }

  function handleReset() {
    setSearchInput('');
    setFilters({
      search: '',
      technology: '',
      domain: '',
      sector: '',
      categoryScope: 'all',
      workMode: '',
      status: 'OPEN',
      matchedOnly: false,
      sortBy: 'match',
    });
  }

  const technologies = categories.filter((c) => c.type.toLowerCase() === 'technology');
  const domains = categories.filter((c) => c.type.toLowerCase() === 'domain');
  const sectors = categories.filter((c) => c.type.toLowerCase() === 'sector');

  const visibleCategories =
    categoryTab === 'technology'
      ? technologies
      : categoryTab === 'domain'
        ? domains
        : categoryTab === 'sector'
          ? sectors
          : categories;

  const categoriesWithJobsCount = categories.filter((c) => c.jobCount > 0).length;

  const hasActiveFilters = Boolean(
    filters.search ||
    filters.technology ||
    filters.domain ||
    filters.sector ||
    filters.categoryScope !== 'all' ||
    filters.workMode ||
    filters.matchedOnly ||
    filters.sortBy !== 'match' ||
    (filters.status && filters.status !== 'OPEN'),
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <CandidateNav />

      <main className="max-w-7xl w-full mx-auto px-6 pt-10 pb-20 space-y-10 flex-1">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-1">
              Candidate Workspace · Discovered Openings
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight text-neutral-950 mb-1">Jobs</h1>
            <p className="text-sm text-neutral-500">
              All deduplicated openings found in crawling with category intelligence and preference
              matching
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="/candidate/profile" className="btn-pill-secondary text-xs px-4 py-1.5">
              Tune profile
            </Link>
            <Link href="/candidate/pipeline" className="btn-pill-secondary text-xs px-4 py-1.5">
              Open pipeline
            </Link>
          </div>
        </div>

        {/* Unboxed KPI Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 pb-8 border-b border-neutral-100">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-1">
              Total Openings
            </p>
            <p className="text-4xl font-extrabold text-neutral-950 tracking-tight">
              {loading && rows.length === 0 ? '—' : total}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-1">
              Matched to You
            </p>
            <p className="text-4xl font-extrabold text-emerald-700 tracking-tight">
              {loading && rows.length === 0 ? '—' : matchedCount}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-1">
              Categories with Jobs
            </p>
            <p className="text-4xl font-extrabold text-neutral-950 tracking-tight">
              {categoriesWithJobsCount}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-1">
              Loaded in View
            </p>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-extrabold text-neutral-950 tracking-tight">
                {rows.length}
              </p>
              <span className="text-xs text-neutral-400 font-medium">of {total}</span>
            </div>
          </div>
        </div>

        {/* Category Intelligence Breakdown Section */}
        <section aria-labelledby="category-breakdown-heading" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 mb-0.5">
                Category Intelligence
              </p>
              <h2
                id="category-breakdown-heading"
                className="text-xl font-bold tracking-tight text-neutral-950"
              >
                Jobs by Category
              </h2>
              <p className="text-xs text-neutral-500">
                Click any category badge to filter openings directly
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Type Filter Tabs */}
              <div className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-50 text-xs">
                {(['all', 'technology', 'domain', 'sector'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setCategoryTab(tab)}
                    className={`px-3 py-1 rounded-full font-medium transition cursor-pointer capitalize ${
                      categoryTab === tab
                        ? 'bg-black text-white'
                        : 'text-neutral-600 hover:text-black'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowCategoryTable((v) => !v)}
                className="btn-pill-secondary text-xs px-3 py-1"
              >
                {showCategoryTable ? 'Hide Table' : 'Detailed Counts'}
              </button>
            </div>
          </div>

          {/* Category Chips Cloud */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {visibleCategories.map((cat) => {
              const isSelected =
                (cat.type === 'technology' && filters.technology === cat.name) ||
                (cat.type === 'domain' && filters.domain === cat.name) ||
                (cat.type === 'sector' && filters.sector === cat.name);

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setFilters((prev) => ({
                        ...prev,
                        technology: cat.type === 'technology' ? '' : prev.technology,
                        domain: cat.type === 'domain' ? '' : prev.domain,
                        sector: cat.type === 'sector' ? '' : prev.sector,
                      }));
                    } else {
                      setFilters((prev) => ({
                        ...prev,
                        technology: cat.type === 'technology' ? cat.name : prev.technology,
                        domain: cat.type === 'domain' ? cat.name : prev.domain,
                        sector: cat.type === 'sector' ? cat.name : prev.sector,
                      }));
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition cursor-pointer ${
                    isSelected
                      ? 'bg-black text-white border-black'
                      : cat.jobCount > 0
                        ? 'bg-white text-neutral-800 border-neutral-200 hover:border-black'
                        : 'bg-neutral-50 text-neutral-400 border-neutral-100 hover:text-neutral-600'
                  }`}
                  title={`${cat.name} (${cat.type}) · ${cat.jobCount} open jobs`}
                >
                  <span>{cat.name}</span>
                  <span
                    className={`text-[11px] font-mono px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? 'bg-neutral-700 text-white'
                        : cat.jobCount > 0
                          ? 'bg-neutral-100 text-neutral-700'
                          : 'bg-neutral-100 text-neutral-400'
                    }`}
                  >
                    {cat.jobCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Expandable Detailed Category Count Table */}
          {showCategoryTable && (
            <div className="mt-4 p-5 rounded-2xl border border-neutral-100 bg-neutral-50/50 space-y-4">
              <h3 className="text-sm font-bold text-neutral-900">
                Detailed Job Counts by Category Group
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                    Technologies ({technologies.length})
                  </h4>
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-2">
                    {technologies.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between text-xs py-1 border-b border-neutral-100"
                      >
                        <button
                          type="button"
                          onClick={() => setFilters((p) => ({ ...p, technology: t.name }))}
                          className="hover:underline text-neutral-800 font-medium text-left truncate"
                        >
                          {t.name}
                        </button>
                        <span className="font-mono text-neutral-500 font-semibold">
                          {t.jobCount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                    Domains ({domains.length})
                  </h4>
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-2">
                    {domains.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between text-xs py-1 border-b border-neutral-100"
                      >
                        <button
                          type="button"
                          onClick={() => setFilters((p) => ({ ...p, domain: d.name }))}
                          className="hover:underline text-neutral-800 font-medium text-left truncate"
                        >
                          {d.name}
                        </button>
                        <span className="font-mono text-neutral-500 font-semibold">
                          {d.jobCount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                    Sectors ({sectors.length})
                  </h4>
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-2">
                    {sectors.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between text-xs py-1 border-b border-neutral-100"
                      >
                        <button
                          type="button"
                          onClick={() => setFilters((p) => ({ ...p, sector: s.name }))}
                          className="hover:underline text-neutral-800 font-medium text-left truncate"
                        >
                          {s.name}
                        </button>
                        <span className="font-mono text-neutral-500 font-semibold">
                          {s.jobCount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-b border-neutral-100" />

        {/* Search & Filters Section */}
        <section aria-labelledby="filters-heading" className="space-y-4">
          <form onSubmit={handleSearchSubmit} className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              {/* Search Bar */}
              <div className="w-full sm:w-64">
                <label
                  htmlFor="search-input"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Search
                </label>
                <input
                  id="search-input"
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Title, company, skills, city"
                  className="input-clean"
                />
              </div>

              {/* Technology Dropdown */}
              <div className="w-full sm:w-44">
                <label
                  htmlFor="filter-tech"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Technology
                </label>
                <select
                  id="filter-tech"
                  value={filters.technology}
                  onChange={(e) => setFilters((prev) => ({ ...prev, technology: e.target.value }))}
                  className="select-clean"
                >
                  <option value="">All technologies</option>
                  {technologies.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} ({t.jobCount})
                    </option>
                  ))}
                </select>
              </div>

              {/* Domain Dropdown */}
              <div className="w-full sm:w-40">
                <label
                  htmlFor="filter-domain"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Domain
                </label>
                <select
                  id="filter-domain"
                  value={filters.domain}
                  onChange={(e) => setFilters((prev) => ({ ...prev, domain: e.target.value }))}
                  className="select-clean"
                >
                  <option value="">All domains</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name} ({d.jobCount})
                    </option>
                  ))}
                </select>
              </div>

              {/* Sector Dropdown */}
              <div className="w-full sm:w-40">
                <label
                  htmlFor="filter-sector"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Sector
                </label>
                <select
                  id="filter-sector"
                  value={filters.sector}
                  onChange={(e) => setFilters((prev) => ({ ...prev, sector: e.target.value }))}
                  className="select-clean"
                >
                  <option value="">All sectors</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.jobCount})
                    </option>
                  ))}
                </select>
              </div>

              {/* Category Scope */}
              <div className="w-full sm:w-40">
                <label
                  htmlFor="filter-scope"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Match Scope
                </label>
                <select
                  id="filter-scope"
                  value={filters.categoryScope}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      categoryScope: e.target.value as 'all' | 'job' | 'company',
                    }))
                  }
                  className="select-clean"
                >
                  <option value="all">Any (Job or Company)</option>
                  <option value="job">Job Role Only</option>
                  <option value="company">Company Only</option>
                </select>
              </div>

              {/* Work Mode */}
              <div className="w-full sm:w-36">
                <label
                  htmlFor="filter-mode"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Work Mode
                </label>
                <select
                  id="filter-mode"
                  value={filters.workMode}
                  onChange={(e) => setFilters((prev) => ({ ...prev, workMode: e.target.value }))}
                  className="select-clean"
                >
                  <option value="">All modes</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="On-site">On-site</option>
                </select>
              </div>

              {/* Sort By */}
              <div className="w-full sm:w-44">
                <label
                  htmlFor="filter-sort"
                  className="text-xs font-semibold text-neutral-500 mb-1"
                >
                  Ranking / Sort
                </label>
                <select
                  id="filter-sort"
                  value={filters.sortBy}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      sortBy: e.target.value as 'match' | 'recent',
                    }))
                  }
                  className="select-clean"
                >
                  <option value="match">Matches First (Top)</option>
                  <option value="recent">Most Recently Crawled</option>
                </select>
              </div>

              {/* Filter Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="btn-pill-primary text-xs px-4 py-2"
                  disabled={loading}
                >
                  Filter
                </button>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="btn-pill-secondary text-xs px-3 py-2"
                    disabled={loading}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Quick Preference Filter Checkbox & Active Chips */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-neutral-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filters.matchedOnly}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, matchedOnly: e.target.checked }))
                  }
                  className="rounded border-neutral-300 text-black focus:ring-black h-4 w-4"
                />
                <span>Only show jobs matching my profile preferences</span>
              </label>

              {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-neutral-400 font-medium">Active filters:</span>
                  {filters.search && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-neutral-100 text-neutral-800 text-xs font-medium">
                      Search: "{filters.search}"
                      <button
                        type="button"
                        onClick={() => {
                          setSearchInput('');
                          setFilters((p) => ({ ...p, search: '' }));
                        }}
                        className="hover:text-black ml-0.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  {filters.technology && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200">
                      Tech: {filters.technology}
                      <button
                        type="button"
                        onClick={() => setFilters((p) => ({ ...p, technology: '' }))}
                        className="hover:text-blue-900 ml-0.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  {filters.domain && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                      Domain: {filters.domain}
                      <button
                        type="button"
                        onClick={() => setFilters((p) => ({ ...p, domain: '' }))}
                        className="hover:text-emerald-900 ml-0.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  {filters.sector && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-200">
                      Sector: {filters.sector}
                      <button
                        type="button"
                        onClick={() => setFilters((p) => ({ ...p, sector: '' }))}
                        className="hover:text-purple-900 ml-0.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  {filters.workMode && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-medium border border-amber-200">
                      Mode: {filters.workMode}
                      <button
                        type="button"
                        onClick={() => setFilters((p) => ({ ...p, workMode: '' }))}
                        className="hover:text-amber-950 ml-0.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  {filters.matchedOnly && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                      Matches Only
                      <button
                        type="button"
                        onClick={() => setFilters((p) => ({ ...p, matchedOnly: false }))}
                        className="hover:text-emerald-900 ml-0.5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs text-neutral-400 hover:text-neutral-900 underline ml-1 cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </form>
        </section>

        {/* Error banner */}
        {error && (
          <div
            className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 text-xs text-rose-700"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Loading Initial State */}
        {loading && rows.length === 0 && (
          <p className="py-16 text-center text-sm text-neutral-400">Loading discovered jobs…</p>
        )}

        {/* Jobs List */}
        {(!loading || rows.length > 0) && (
          <>
            {rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-neutral-400 border border-neutral-100 rounded-2xl">
                No jobs found matching your criteria. Try adjusting your search or category filters.
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="table-clean w-full">
                  <thead>
                    <tr>
                      <th>Job & Company</th>
                      <th>Match</th>
                      <th>Location</th>
                      <th>Mode</th>
                      <th>First Seen</th>
                      <th>Deadline</th>
                      <th>Pipeline</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((job) => {
                      const expired = isPastDeadline(job.applicationDeadline);
                      const website = safeExternalUrl(job.companyWebsiteUrl);
                      const application = safeExternalUrl(job.applicationUrl);

                      return (
                        <tr key={job.id} className="hover:bg-neutral-50/50 transition">
                          {/* Title & Company */}
                          <td className="max-w-[340px]">
                            <div>
                              {application ? (
                                <a
                                  href={application}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-bold text-neutral-900 hover:underline block text-sm"
                                >
                                  {job.title}
                                </a>
                              ) : (
                                <span className="font-bold text-neutral-900 block text-sm">
                                  {job.title}
                                </span>
                              )}

                              <div className="text-xs text-neutral-500 mt-0.5">
                                {website ? (
                                  <a
                                    href={website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline text-neutral-600 font-medium"
                                  >
                                    {job.companyName} ↗
                                  </a>
                                ) : (
                                  <span className="font-medium text-neutral-600">
                                    {job.companyName}
                                  </span>
                                )}
                              </div>

                              {/* Categories */}
                              {(job.jobCategories.length > 0 ||
                                job.companyCategories.length > 0) && (
                                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                  {job.jobCategories.map((c) => (
                                    <button
                                      key={`job-cat-${c}`}
                                      type="button"
                                      onClick={() => {
                                        const found = categories.find(
                                          (cat) => cat.name.toLowerCase() === c.toLowerCase(),
                                        );
                                        setFilters((prev) => ({
                                          ...prev,
                                          technology:
                                            found?.type === 'technology'
                                              ? found.name
                                              : prev.technology,
                                          domain:
                                            found?.type === 'domain' ? found.name : prev.domain,
                                          sector:
                                            found?.type === 'sector' ? found.name : prev.sector,
                                        }));
                                      }}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:border-blue-400 transition cursor-pointer"
                                      title={`Job Role Category: ${c}`}
                                    >
                                      {c}
                                    </button>
                                  ))}
                                  {job.companyCategories.map((c) => (
                                    <button
                                      key={`co-cat-${c}`}
                                      type="button"
                                      onClick={() => {
                                        const found = categories.find(
                                          (cat) => cat.name.toLowerCase() === c.toLowerCase(),
                                        );
                                        setFilters((prev) => ({
                                          ...prev,
                                          technology:
                                            found?.type === 'technology'
                                              ? found.name
                                              : prev.technology,
                                          domain:
                                            found?.type === 'domain' ? found.name : prev.domain,
                                          sector:
                                            found?.type === 'sector' ? found.name : prev.sector,
                                        }));
                                      }}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-50 text-neutral-600 border border-neutral-200 hover:border-neutral-400 transition cursor-pointer"
                                      title={`Company Category: ${c}`}
                                    >
                                      {c}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Match Score */}
                          <td className="whitespace-nowrap">
                            {job.isMatch ? (
                              <div className="space-y-0.5">
                                <span className="badge-success text-xs font-semibold">
                                  Match: {job.score}%
                                </span>
                                {job.reasons.length > 0 && (
                                  <p className="text-[10px] text-neutral-400 max-w-[150px] truncate">
                                    {job.reasons[0]}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="badge-neutral text-xs font-medium text-neutral-500">
                                Opening
                              </span>
                            )}
                          </td>

                          {/* Location */}
                          <td className="text-xs text-neutral-600 whitespace-nowrap">
                            {job.location || '—'}
                          </td>

                          {/* Mode */}
                          <td className="text-xs text-neutral-600 whitespace-nowrap">
                            {job.workMode || '—'}
                          </td>

                          {/* First Seen */}
                          <td className="text-xs text-neutral-500 whitespace-nowrap">
                            {formatDate(job.firstSeenAt)}
                          </td>

                          {/* Deadline */}
                          <td className="text-xs whitespace-nowrap">
                            {job.applicationDeadline ? (
                              <span
                                className={
                                  expired ? 'text-rose-600 font-medium' : 'text-neutral-600'
                                }
                              >
                                {formatDate(job.applicationDeadline)}
                                {expired && (
                                  <span className="ml-1 text-[10px] text-rose-500">(expired)</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-neutral-400">—</span>
                            )}
                          </td>

                          {/* Pipeline Tracking Actions */}
                          <td className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={
                                  savingCompanyId === job.companyId ||
                                  job.trackingStatus === 'PLANNING'
                                }
                                onClick={() => void track(job.companyId, 'PLANNING')}
                                className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border transition cursor-pointer ${
                                  job.trackingStatus === 'PLANNING'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-black'
                                }`}
                              >
                                Plan
                              </button>
                              <button
                                type="button"
                                disabled={
                                  savingCompanyId === job.companyId ||
                                  job.trackingStatus === 'APPLIED'
                                }
                                onClick={() => void track(job.companyId, 'APPLIED')}
                                className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border transition cursor-pointer ${
                                  job.trackingStatus === 'APPLIED'
                                    ? 'bg-emerald-700 text-white border-emerald-700'
                                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-black'
                                }`}
                              >
                                Applied
                              </button>
                              <button
                                type="button"
                                disabled={savingCompanyId === job.companyId}
                                onClick={() => void track(job.companyId, 'EXCLUDED')}
                                className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                                title="Blacklist company from your recommendations"
                              >
                                Blacklist
                              </button>
                            </div>
                          </td>

                          {/* Apply Link */}
                          <td className="whitespace-nowrap text-right">
                            {application ? (
                              <a
                                href={application}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-pill-secondary text-xs px-3 py-1 inline-flex items-center gap-1"
                              >
                                Apply <span>↗</span>
                              </a>
                            ) : (
                              <span className="text-xs text-neutral-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Scrolling Sentinel for Lazy Loading / Infinite Scroll */}
            <div ref={sentinelRef} className="h-6" />

            {/* Loading More Indicator */}
            {loadingMore && (
              <div className="py-4 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                <span className="inline-block w-3.5 h-3.5 border-2 border-neutral-300 border-t-black rounded-full animate-spin" />
                Loading more openings…
              </div>
            )}

            {/* End of list message */}
            {!hasMore && rows.length > 0 && !loadingMore && (
              <div className="py-4 text-center text-xs text-neutral-400">
                All {total} openings loaded
              </div>
            )}
          </>
        )}
      </main>

      {/* Sticky Bottom Pagination & Status Bar */}
      {(!loading || rows.length > 0) && rows.length > 0 && (
        <aside
          aria-label="Pagination and scroll controls"
          className="sticky bottom-0 z-30 w-full bg-white/95 backdrop-blur-md border-t border-neutral-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
        >
          <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-neutral-600">
              <span className="font-bold text-neutral-900">
                Loaded {rows.length} of {total} openings
              </span>
              {matchedCount > 0 && (
                <span className="badge-success text-[11px] font-semibold">
                  {matchedCount} matching profile
                </span>
              )}
              <span className="text-neutral-300">·</span>
              <span className="text-neutral-500">
                Page {page} of {totalPages}
              </span>
              {!hasMore && (
                <span className="text-[11px] text-neutral-400 font-medium">(All loaded)</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="btn-pill-secondary text-xs px-3 py-1 flex items-center gap-1 cursor-pointer"
                title="Scroll back to top"
              >
                <span>↑</span> Top
              </button>

              {hasMore ? (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="btn-pill-primary text-xs px-4 py-1 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Loading…</span>
                    </>
                  ) : (
                    <>
                      <span>Load More</span>
                      <span className="text-[10px]">↓</span>
                    </>
                  )}
                </button>
              ) : (
                <span className="text-xs text-neutral-400 font-medium px-2 py-1">✓ Caught up</span>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
