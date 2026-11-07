import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type { CrawlResult, CrawledJob } from './types.js';
import { canonicalizeUrl, normalizeTitle, normalizeWhitespace } from '../jobs/normalize.js';

const ROLE_TEXT =
  /\b(engineer|developer|designer|manager|intern|trainee|executive|officer|analyst|specialist|architect|consultant|qa|quality assurance|devops|support|administrator|lead|coordinator|sales|marketing|finance|hr|business development|customer service|billing|network|android|ios|java|\.net|nlp)\b/i;
const JOB_URL_HINT = /\b(job|career|vacan|position|opening|apply|awsm_job_openings)\b/i;
const JOB_CONTEXT =
  /\b(vacanc(?:y|ies)|deadline|experience|apply|full[ -]?time|part[ -]?time|remote|hybrid|on[ -]?site|employment)\b/i;
const LISTING_HEADING =
  /^(open positions?|current openings?|job openings?|join the team!?|we are hiring|careers?)$/i;
const NO_OPENINGS =
  /\b(no (?:current )?(?:job |career )?(?:opening|openings|vacancy|vacancies|position|positions)|currently no (?:openings|vacancies|positions)|no jobs? available|we are not hiring)\b/i;

function absoluteUrl(base: string, href: string): string | null {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    return canonicalizeUrl(new URL(href, base).toString());
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
  return text.length >= 3 && text.length <= 180 && ROLE_TEXT.test(text) && !isActionOnly(text);
}

function nearestJobContainer(
  $: cheerio.CheerioAPI,
  el: cheerio.Element,
): cheerio.Cheerio<cheerio.Element> {
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

function bestTitle($: cheerio.CheerioAPI, anchor: cheerio.Element): string {
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
  if (direct && !isActionOnly(direct)) return normalizeTitle(direct);
  return '';
}

function nearbyLocation($: cheerio.CheerioAPI, el: cheerio.Element): string | undefined {
  const container = nearestJobContainer($, el);
  const location = normalizeWhitespace(
    container.find('[class*=location], [data-location], address').first().text(),
  );
  return location || undefined;
}

function parseDeadlineFromText(text: string): Date | null {
  const match = text.match(
    /deadline\s*:?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s*,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2}(?:st|nd|rd|th)?\s*,?\s+[0-9]{4})/i,
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

function isExpired(text: string, now = new Date()): boolean {
  const deadline = parseDeadlineFromText(text);
  return deadline ? deadline.getTime() < now.getTime() : false;
}

function addJob(jobs: CrawledJob[], seen: Set<string>, job: CrawledJob): void {
  const title = normalizeTitle(job.title);
  if (!roleLike(title)) return;

  const key = `${title.toLowerCase()}|${job.applicationUrl.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  jobs.push({ ...job, title });
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
    if (isExpired(context)) return;

    addJob(jobs, seen, {
      companyId,
      title,
      location: nearbyLocation($, el),
      applicationUrl,
      sourceUrl,
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
    if (!roleLike(title)) return;

    const rowText = normalizeWhitespace($(row).text());
    if (isExpired(rowText)) return;

    const href = $(row).find('a[href]').first().attr('href');
    const applicationUrl = href ? (absoluteUrl(sourceUrl, href) ?? sourceUrl) : sourceUrl;

    addJob(jobs, seen, {
      companyId,
      title,
      applicationUrl,
      sourceUrl,
      description: rowText || undefined,
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
  const roots: cheerio.Cheerio<cheerio.Element>[] = [];

  $('h1,h2,h3,h4,h5,h6').each((_, heading) => {
    const text = normalizeWhitespace($(heading).text());
    if (!LISTING_HEADING.test(text)) return;

    const section = $(heading).closest('section');
    roots.push(section.length ? section : $(heading).parent());
  });

  for (const root of roots) {
    root.find('h2,h3,h4,h5,h6,[class*=job-title],[class*=position-title]').each((_, el) => {
      const title = normalizeTitle($(el).text());
      if (!roleLike(title)) return;

      const container = nearestJobContainer($, el);
      const context = normalizeWhitespace(container.text());
      const hasPerItemCue = JOB_CONTEXT.test(context);
      const href = container
        .find('a[href]')
        .filter((_, a) => {
          const value = $(a).attr('href') ?? '';
          return JOB_URL_HINT.test(value) || /apply/i.test($(a).text());
        })
        .first()
        .attr('href');

      // Avoid generic career-family headings such as "Back-end Development" unless
      // the item has an apply/detail link or vacancy/experience/deadline context.
      if (!hasPerItemCue && !href) return;
      if (isExpired(context)) return;

      const applicationUrl = href ? (absoluteUrl(sourceUrl, href) ?? sourceUrl) : sourceUrl;
      addJob(jobs, seen, {
        companyId,
        title,
        applicationUrl,
        sourceUrl,
      });
    });
  }
}

function extractLongOpeningBlocks(
  $: cheerio.CheerioAPI,
  companyId: string,
  sourceUrl: string,
  jobs: CrawledJob[],
  seen: Set<string>,
): void {
  $('a,section,div').each((_, block) => {
    const direct = normalizeWhitespace($(block).clone().children().remove().end().text());
    const fullText = normalizeWhitespace($(block).text());
    if (!/current openings?|open positions?/i.test(fullText) || fullText.length < 180) return;

    $(block)
      .find('li,h2,h3,h4,h5,h6,p,span,strong')
      .each((_, child) => {
        const title = normalizeTitle($(child).text());
        if (!roleLike(title) || title.length > 120) return;
        if (/current openings?|open positions?/i.test(title)) return;

        addJob(jobs, seen, {
          companyId,
          title,
          applicationUrl: sourceUrl,
          sourceUrl,
        });
      });

    // Keep the variable read so minifiers/linters don't rewrite clone handling oddly.
    void direct;
  });
}

export async function crawlGeneric(companyId: string, careerUrl: string): Promise<CrawlResult> {
  const response = await fetch(careerUrl, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const pageText = normalizeWhitespace($('body').text()).slice(0, 100_000);
  const noOpeningsSignal = NO_OPENINGS.test(pageText);
  const jobs: CrawledJob[] = [];
  const seen = new Set<string>();

  if (!noOpeningsSignal) {
    extractAnchorJobs($, companyId, response.url, jobs, seen);
    extractTableJobs($, companyId, response.url, jobs, seen);
    extractListingSectionJobs($, companyId, response.url, jobs, seen);
  }

  return {
    companyId,
    requestedUrl: careerUrl,
    finalUrl: response.url,
    httpStatus: response.status,
    pageHash: crypto.createHash('sha256').update(html).digest('hex'),
    noOpeningsSignal,
    jobs: jobs.slice(0, 150),
  };
}
