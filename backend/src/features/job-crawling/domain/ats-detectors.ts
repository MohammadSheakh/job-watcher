export interface AtsEndpoint {
  type: 'greenhouse' | 'lever';
  apiUrl: string;
  boardToken: string;
}

/**
 * Detects whether a career URL targets a known Applicant Tracking System (ATS)
 * that exposes public REST endpoints.
 */
export function detectAtsEndpoint(urlStr: string): AtsEndpoint | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, '');

    // Greenhouse: boards.greenhouse.io/<token> or job-boards.greenhouse.io/<token>
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1) {
        const boardToken = parts[0];
        return {
          type: 'greenhouse',
          apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`,
          boardToken,
        };
      }
    }

    // Lever: jobs.lever.co/<token>
    if (host === 'jobs.lever.co') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1) {
        const boardToken = parts[0];
        return {
          type: 'lever',
          apiUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json`,
          boardToken,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

