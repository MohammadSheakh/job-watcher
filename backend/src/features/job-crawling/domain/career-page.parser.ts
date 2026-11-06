import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { CareerPage, CrawlResult, CrawledJob } from './types.js';
import { canonicalizeUrl, normalizeTitle, normalizeWhitespace } from './normalize.js';

const ROLE_TEXT =
  /\b(engineer|developer|designer|manager|intern|trainee|executive|officer|analyst|specialist|architect|consultant|qa|quality assurance|devops|support|administrator|lead|coordinator|sales|marketing|finance|hr|business development|customer service|billing|network|android|ios|java|\.net|nlp)\b/i;
const JOB_URL_HINT =
  /\b(jobs?|careers?|vacanc(?:y|ies)|positions?|openings?|apply|awsm_job_openings)\b/i;
const JOB_CONTEXT =
  /\b(vacanc(?:y|ies)|deadline|experience|apply|full[ -]?time|part[ -]?time|remote|hybrid|on[ -]?site|employment|responsibilities|requirements)\b/i;
const LISTING_HEADING =
  /^(open positions?|current openings?|job openings?|join the team!?|we are hiring|careers?)$/i;
const NO_OPENINGS =
  /\b(no (?:current )?(?:job |career )?(?:opening|openings|vacancy|vacancies|position|positions)|currently no (?:openings|vacancies|positions)|no jobs? available|we are not hiring)\b/i;

const DISQUALIFIED_TITLE_PATTERNS = [
  /\b(we are|we're|join us|looking for|our team|about us|who we are|what we do|requirements|responsibilities|benefits|perks|founded by|meet our|our culture)\b/i,
  /[.!?]\s+[A-Za-z]/, // Multiple sentences
  /\b(privacy policy|terms of service|all rights reserved|cookie policy|contact us)\b/i,
];

function isDisqualifiedTitle(value: string): boolean {
  return DISQUALIFIED_TITLE_PATTERNS.some((pattern) => pattern.test(value));
}

function absoluteUrl(base: string, href: string): string | null {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    const url = new URL(href, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return canonicalizeUrl(url.toString());
  } catch {
    return null;
  }
}

function actionComparable(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[→›»>]+/g, '')
    .replace(/[.:\-–—|]+$/g, '')
    .trim()
    .toLowerCase();
}

function isActionOnly(value: string): boolean {
  return /^(apply|apply now|view|view details?|see job details?|job details?|details?|read more|learn more|career|careers|jobs?|vacancies|open positions?)$/.test(
    actionComparable(value),
  );
}

function roleLike(value: string): boolean {
  const text = normalizeTitle(value);
  return (
    text.length >= 3 &&
    text.length <= 80 &&
    ROLE_TEXT.test(text) &&
    !isActionOnly(text) &&
    !isDisqualifiedTitle(text)
  );
}

function nearestJobContainer($: cheerio.CheerioAPI, el: Element): cheerio.Cheerio<Element> {
  let node = $(el).parent();
  let fallback = node;

  for (let i = 0; i < 6 && node.length; i += 1) {
    const text = normalizeWhitespace(node.text());
    const heading = normalizeWhitespace(
      node.find('h1,h2,h3,h4,h5,h6,strong,.title,.job-title,.position-title').first().text(),
    );
    if (JOB_CONTEXT.test(text) || roleLike(heading)) return node;
    fallback = node;
    node = node.parent();
  }

  return fallback;
}

function bestTitle($: cheerio.CheerioAPI, anchor: Element): string {
  const direct = normalizeWhitespace($(anchor).text());
  if (direct && !isActionOnly(direct) && roleLike(direct)) return normalizeTitle(direct);

  const container = nearestJobContainer($, anchor);
  const heading = normalizeWhitespace(
    container
      .find('h1,h2,h3,h4,h5,h6,strong,.title,.job-title,.position-title')
      .filter((_, node) => roleLike($(node).text()))
      .first()
      .text(),
  );

  if (heading) return normalizeTitle(heading);
  if (direct && !isActionOnly(direct) && roleLike(direct)) return normalizeTitle(direct);
  return '';
}

function nearbyLocation($: cheerio.CheerioAPI, el: Element): string | undefined {
  const container = nearestJobContainer($, el);
  const location = normalizeWhitespace(
    container.find('[class*=location], [data-location], address').first().text(),
  );
  return location || undefined;
}

export function parseDeadlineFromText(text: string): Date | null {
  const numMatch = text.match(
    /(?:deadline|apply before|apply by|last date(?:\s+of application)?)\s*:?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
  );
  if (numMatch) {
    const raw = numMatch[1].trim();
    const timestamp = Date.parse(raw);
    if (!Number.isNaN(timestamp)) {
      const date = new Date(timestamp);
      date.setHours(23, 59, 59, 999);
      return date;
    }
  }

  const match = text.match(
    /(?:deadline|apply before|apply by|last date(?:\s+of application)?)\s*:?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s*,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2}(?:st|nd|rd|th)?\s*,?\s+[0-9]{4})/i,
  );
  if (!match) return null;

  const cleaned = match[1]
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const timestamp = Date.parse(cleaned);
  if (Number.isNaN(timestamp)) return null;

  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addJob(jobs: CrawledJob[], seen: Set<string>, job: CrawledJob): void {
  const title = normalizeTitle(job.title);
  if (!roleLike(title)) return;

  const key = `${title.toLowerCase()}|${job.applicationUrl.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  jobs.push({ ...job, title });
}

/**
 * Parses Schema.org JobPosting structured JSON-LD.
 * Provides high-precision, publisher-declared vacancy metadata.
 */
export function extractSchemaOrgJobs(
  $: cheerio.CheerioAPI,
  companyId: string,
  sourceUrl: string,
  jobs: CrawledJob[],
  seen: Set<string>,
): void {
  $('script[type="application/ld+json"]').each((_, script) => {
    const rawText = $(script).text();
    if (!rawText.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }

    const items: unknown[] = [];
    if (Array.isArray(parsed)) {
      items.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj['@graph'])) {
        items.push(...obj['@graph']);
      } else {
        items.push(obj);
      }
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const jobPosting = item as Record<string, unknown>;
      const type = jobPosting['@type'];
      const isJobPosting =
        type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
      if (!isJobPosting) continue;

      const rawTitle =
        typeof jobPosting.title === 'string'
          ? jobPosting.title
          : typeof jobPosting.name === 'string'
            ? jobPosting.name
            : '';
      const title = normalizeTitle(rawTitle);
      if (!title || !roleLike(title)) continue;

      let applicationUrl = sourceUrl;
      if (typeof jobPosting.url === 'string' && jobPosting.url.trim()) {
        const resolved = absoluteUrl(sourceUrl, jobPosting.url);
        if (resolved) applicationUrl = resolved;
      }

      let location: string | undefined;
      const jobLoc = jobPosting.jobLocation;
      if (jobLoc && typeof jobLoc === 'object') {
        const locObj = jobLoc as Record<string, unknown>;
        const address = locObj.address;
        if (typeof address === 'string') {
          location = normalizeWhitespace(address);
        } else if (address && typeof address === 'object') {
          const addrObj = address as Record<string, unknown>;
          const locality =
            typeof addrObj.addressLocality === 'string' ? addrObj.addressLocality : '';
          const region = typeof addrObj.addressRegion === 'string' ? addrObj.addressRegion : '';
          const country = typeof addrObj.addressCountry === 'string' ? addrObj.addressCountry : '';
          location = [locality, region, country].filter(Boolean).join(', ') || undefined;
        }
      }

      let deadline: Date | null = null;
      if (typeof jobPosting.validThrough === 'string') {
        const timestamp = Date.parse(jobPosting.validThrough);
        if (!Number.isNaN(timestamp)) {
          deadline = new Date(timestamp);
        }
      }

      let description: string | undefined;
      if (typeof jobPosting.description === 'string' && jobPosting.description.trim()) {
        description = normalizeWhitespace(jobPosting.description).slice(0, 5000);
      }

      addJob(jobs, seen, {
        companyId,
        title,
        location,
        applicationUrl,
        sourceUrl,
        deadline,
        description,
      });
    }
  });
}

function extractAnchorJobs(
  $: cheerio.CheerioAPI,
  companyId: string,
  sourceUrl: string,
  jobs: CrawledJob[],
  seen: Set<string>,
): void {
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const applicationUrl = absoluteUrl(sourceUrl, href);
    if (!applicationUrl) return;

    const title = bestTitle($, el);
    if (!roleLike(title)) return;

    const container = nearestJobContainer($, el);
    const context = normalizeWhitespace(container.text());
    const strongUrlSignal = JOB_URL_HINT.test(applicationUrl);
    const strongContextSignal = JOB_CONTEXT.test(context);

    if (!strongUrlSignal && !strongContextSignal) return;

    const deadline = parseDeadlineFromText(context);
    addJob(jobs, seen, {
      companyId,
      title,
      location: nearbyLocation($, el),
      applicationUrl,
      sourceUrl,
      deadline,
    });
  });
}

function extractTableJobs(
  $: cheerio.CheerioAPI,
  companyId: string,
  sourceUrl: string,
  jobs: CrawledJob[],
  seen: Set<string>,
): void {
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (!cells.length) return;

    const title = normalizeTitle($(cells[0]).text());
    if (!roleLike(title) || title.length > 80) return;

    const rowText = normalizeWhitespace($(row).text());
    const hasJobContext = JOB_CONTEXT.test(rowText);

    const href = $(row).find('a[href]').first().attr('href');
    let applicationUrl = sourceUrl;
    if (href) {
      const resolved = absoluteUrl(sourceUrl, href);
      if (resolved) {
        applicationUrl = resolved;
      } else if (href.startsWith('#')) {
        try {
          const anchorUrl = new URL(sourceUrl);
          anchorUrl.hash = href;
          applicationUrl = anchorUrl.toString();
        } catch {
          applicationUrl = sourceUrl;
        }
      }
    }

    // A table row MUST have either an explicit application link OR vacancy context (deadline, experience, apply)
    // to prevent scraping service pricing tables or feature comparison tables.
    if (applicationUrl === sourceUrl && !hasJobContext) return;

    const deadline = parseDeadlineFromText(rowText);

    addJob(jobs, seen, {
      companyId,
      title,
      applicationUrl,
      sourceUrl,
      description: rowText || undefined,
      deadline,
    });
  });
}

function extractListingSectionJobs(
  $: cheerio.CheerioAPI,
  companyId: string,
  sourceUrl: string,
  jobs: CrawledJob[],
  seen: Set<string>,
): void {
  const roots: cheerio.Cheerio<AnyNode>[] = [];

  $('h1,h2,h3,h4,h5,h6').each((_, heading) => {
    const text = normalizeWhitespace($(heading).text());
    if (!LISTING_HEADING.test(text)) return;

    const section = $(heading).closest('section');
    roots.push(section.length ? section : $(heading).parent());
  });

  for (const root of roots) {
    root.find('h2,h3,h4,h5,h6,[class*=job-title],[class*=position-title]').each((_, el) => {
      const title = normalizeTitle($(el).text());
      if (!roleLike(title) || title.length > 80) return;

      const container = nearestJobContainer($, el);
      const context = normalizeWhitespace(container.text());
      const hasPerItemCue = JOB_CONTEXT.test(context);

      const anchor = container
        .find('a[href]')
        .filter((_, a) => {
          const value = $(a).attr('href') ?? '';
          return JOB_URL_HINT.test(value) || /apply/i.test($(a).text());
        })
        .first();

      const href = anchor.attr('href');
      let applicationUrl = sourceUrl;
      if (href) {
        const resolved = absoluteUrl(sourceUrl, href);
        if (resolved) {
          applicationUrl = resolved;
        } else if (href.startsWith('#')) {
          try {
            const anchorUrl = new URL(sourceUrl);
            anchorUrl.hash = href;
            applicationUrl = anchorUrl.toString();
          } catch {
            applicationUrl = sourceUrl;
          }
        }
      } else {
        // If there's no subpage link, check if the card has an HTML id anchor (#job-123)
        const containerId = container.attr('id') || $(el).attr('id');
        if (containerId) {
          try {
            const anchorUrl = new URL(sourceUrl);
            anchorUrl.hash = `#${containerId}`;
            applicationUrl = anchorUrl.toString();
          } catch {
            applicationUrl = sourceUrl;
          }
        }
      }

      // If there is no separate URL (applicationUrl === sourceUrl),
      // we strictly require confirmed vacancy cues (apply link/button, deadline, or experience)
      // to avoid scraping generic non-job headings.
      if (applicationUrl === sourceUrl && !hasPerItemCue) {
        return;
      }

      const deadline = parseDeadlineFromText(context);
      addJob(jobs, seen, {
        companyId,
        title,
        location: nearbyLocation($, el),
        applicationUrl,
        sourceUrl,
        deadline,
      });
    });
  }
}

/** Extract vacancy signals from one already-fetched HTML page, without I/O. */
export function parseCareerPage(companyId: string, page: CareerPage): CrawlResult {
  if (page.httpStatus < 200 || page.httpStatus >= 300) throw new Error(`HTTP ${page.httpStatus}`);
  for (const value of [page.requestedUrl, page.finalUrl]) {
    if (!['http:', 'https:'].includes(new URL(value).protocol))
      throw new Error('Career pages require HTTP(S) URLs.');
  }
  const { html } = page;
  if (Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024)
    throw new Error('Career page exceeds the 2 MiB parsing limit.');
  const $ = cheerio.load(html);
  const pageText = normalizeWhitespace($('body').text()).slice(0, 100_000);
  const noOpeningsSignal = NO_OPENINGS.test(pageText);
  const jobs: CrawledJob[] = [];
  const seen = new Set<string>();

  if (!noOpeningsSignal) {
    // 1. Prioritize Schema.org JobPosting structured data
    extractSchemaOrgJobs($, companyId, page.finalUrl, jobs, seen);
    // 2. Extract standard HTML anchors
    extractAnchorJobs($, companyId, page.finalUrl, jobs, seen);
    // 3. Extract verified job tables
    extractTableJobs($, companyId, page.finalUrl, jobs, seen);
    // 4. Extract verified listing section headings
    extractListingSectionJobs($, companyId, page.finalUrl, jobs, seen);
  }

  return {
    companyId,
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    pageHash: crypto.createHash('sha256').update(html).digest('hex'),
    noOpeningsSignal,
    jobs: jobs.slice(0, 150),
  };
}
