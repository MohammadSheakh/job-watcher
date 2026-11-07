'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, candidateAuthRedirect } from '../../../lib/api';

interface CandidateMe {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
}

export function CandidateNav({ initialName }: { initialName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [candidateName, setCandidateName] = useState(initialName ?? '');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (initialName) {
      setCandidateName(initialName);
      return;
    }
    const controller = new AbortController();
    api<CandidateMe>('/candidate-auth/me', { signal: controller.signal })
      .then((me) => {
        if (!controller.signal.aborted) {
          setCandidateName(me.name);
        }
      })
      .catch(() => {
        // Silently ignore or allow page-level auth checks to handle redirection
      });
    return () => controller.abort();
  }, [initialName]);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await api('/candidate-auth/logout', { method: 'POST' });
      router.replace('/candidate/login');
    } catch (reason) {
      const destination = candidateAuthRedirect(reason);
      if (destination) router.replace(destination);
      else router.replace('/candidate/login');
    } finally {
      setSigningOut(false);
    }
  }

  // Do not render nav on auth-only pages
  if (pathname === '/candidate/login' || pathname === '/candidate/change-password') {
    return null;
  }

  return (
    <header className="border-b border-neutral-100 bg-white sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Link
            href="/candidate"
            className="font-bold text-base tracking-tight text-neutral-950 hover:opacity-80 transition"
          >
            Job Intelligence
          </Link>
          <span className="text-[10px] tracking-wider uppercase font-semibold text-neutral-400">
            CANDIDATE
          </span>
        </div>

        <nav className="flex items-center gap-6 text-xs font-medium text-neutral-600">
          <Link
            href="/candidate"
            className={`transition hover:text-black ${pathname === '/candidate' ? 'text-black font-semibold' : ''}`}
          >
            Overview
          </Link>
          <Link
            href="/candidate/jobs"
            className={`transition hover:text-black ${pathname.startsWith('/candidate/jobs') ? 'text-black font-semibold' : ''}`}
          >
            Jobs
          </Link>
          <Link
            href="/candidate/companies"
            className={`transition hover:text-black ${pathname === '/candidate/companies' ? 'text-black font-semibold' : ''}`}
          >
            Companies
          </Link>
          <Link
            href="/candidate/pipeline"
            className={`transition hover:text-black ${pathname === '/candidate/pipeline' ? 'text-black font-semibold' : ''}`}
          >
            Pipeline
          </Link>
          <Link
            href="/candidate/profile"
            className={`transition hover:text-black ${pathname === '/candidate/profile' ? 'text-black font-semibold' : ''}`}
          >
            Profile
          </Link>

          {candidateName ? (
            <span className="text-neutral-900 font-semibold truncate max-w-[150px]">
              {candidateName}
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={signingOut}
            className="text-neutral-500 hover:text-black transition cursor-pointer font-medium disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </div>
    </header>
  );
}
