import * as cheerio from 'cheerio';

export type AtsType = 'greenhouse' | 'lever' | 'ashby' | 'workable';

export interface AtsEndpoint {
  type: AtsType;
  apiUrl: string;
  boardToken: string;
  sourceUrl: string;
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

    // Greenhouse: boards.greenhouse.io/<token>, job-boards.greenhouse.io/<token>, boards.eu.greenhouse.io/<token>
    if (
      host === 'boards.greenhouse.io' ||
      host === 'job-boards.greenhouse.io' ||
      host === 'boards.eu.greenhouse.io'
    ) {
      // Check query param 'for' e.g. /embed/job_board?for=stripe or /embed/job_board/js?for=stripe
      const forParam = url.searchParams.get('for');
      if (forParam && forParam.trim()) {
        const boardToken = forParam.trim();
        return {
          type: 'greenhouse',
          apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`,
          boardToken,
          sourceUrl: urlStr,
        };
      }

      const parts = pathname.split('/').filter(Boolean);
      // Skip embed paths if no 'for' parameter
      if (parts.length >= 1 && parts[0] !== 'embed') {
        const boardToken = parts[0];
        return {
          type: 'greenhouse',
          apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`,
          boardToken,
          sourceUrl: urlStr,
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
          sourceUrl: urlStr,
        };
      }
    }

    // Ashby: jobs.ashbyhq.com/<token>
    if (host === 'jobs.ashbyhq.com') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1) {
        const boardToken = parts[0];
        return {
          type: 'ashby',
          apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken)}`,
          boardToken,
          sourceUrl: urlStr,
        };
      }
    }

    // Workable: apply.workable.com/<token>
    if (host === 'apply.workable.com') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1) {
        const boardToken = parts[0];
        return {
          type: 'workable',
          apiUrl: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(boardToken)}`,
          boardToken,
          sourceUrl: urlStr,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Inspects raw HTML to discover embedded ATS boards, widgets, or iframes.
 * Many companies embed their Greenhouse, Lever, Ashby, or Workable boards on their own domain.
 */
export function detectEmbeddedAts(html: string, baseUrl?: string): AtsEndpoint | null {
  if (!html || !html.trim()) return null;

  try {
    const $ = cheerio.load(html);

    // 1. Check iframes
    const iframes = $('iframe[src]')
      .map((_, el) => $(el).attr('src'))
      .get();
    for (const src of iframes) {
      if (!src) continue;
      const resolved = resolveUrlString(src, baseUrl);
      if (resolved) {
        const detected = detectAtsEndpoint(resolved);
        if (detected) return detected;
      }
    }

    // 2. Check script tags (e.g. Greenhouse embed scripts)
    const scripts = $('script[src]')
      .map((_, el) => $(el).attr('src'))
      .get();
    for (const src of scripts) {
      if (!src) continue;
      const resolved = resolveUrlString(src, baseUrl);
      if (resolved) {
        const detected = detectAtsEndpoint(resolved);
        if (detected) return detected;
      }
    }

    // 3. Check anchor links targeting ATS boards
    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get();
    for (const href of links) {
      if (!href) continue;
      const resolved = resolveUrlString(href, baseUrl);
      if (resolved) {
        const detected = detectAtsEndpoint(resolved);
        if (detected) return detected;
      }
    }

    // 4. Check data-board attributes or greenhouse app container
    const ghContainer = $('#grnhse_app, [data-greenhouse-board], [data-board]');
    if (ghContainer.length) {
      const token =
        ghContainer.attr('data-board') ||
        ghContainer.attr('data-greenhouse-board') ||
        ghContainer.attr('data-token');
      if (token && token.trim()) {
        const boardToken = token.trim();
        return {
          type: 'greenhouse',
          apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`,
          boardToken,
          sourceUrl: baseUrl ?? `https://boards.greenhouse.io/${boardToken}`,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function resolveUrlString(href: string, base?: string): string | null {
  try {
    if (href.startsWith('//')) {
      return `https:${href}`;
    }
    if (base) {
      return new URL(href, base).toString();
    }
    return new URL(href).toString();
  } catch {
    return null;
  }
}
