import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { CompanyForCrawl, CareerPage, CrawlResult } from '../domain/types.js';
import { resolveCareerUrl } from '../domain/source-overrides.js';
import { detectAtsEndpoint, detectEmbeddedAts } from '../domain/ats-detectors.js';
import { isSpaShell } from '../domain/spa-detector.js';
import { parseCareerPage } from '../domain/career-page.parser.js';
import { CareerPageFetcherService, CrawlTransportError } from './career-page-fetcher.service.js';
import { AtsClientService } from './ats-client.service.js';
import { BrowserRendererService } from './browser-renderer.service.js';
import { CrawlIngestionService } from './crawl-ingestion.service.js';

export interface CompanyCrawlOutcome {
  companyId: string;
  success: boolean;
  jobsFound: number;
  errorCode?: string;
}

/**
 * Enterprise multi-tier company career crawl orchestrator.
 * 1. Direct ATS REST APIs (Greenhouse, Lever, Ashby, Workable) - 100% structured data
 * 2. High-speed HTTP fetch with pinned DNS and modern desktop Chrome headers
 * 3. Embedded ATS detection (iframes, scripts, widgets on custom company domains)
 * 4. High-precision DOM parser (Schema.org JSON-LD, tables, structured headings)
 * 5. Headless browser fallback (Playwright Chromium) for client-side JavaScript SPAs
 */
@Injectable()
export class CompanyCrawlService {
  private readonly logger = new Logger(CompanyCrawlService.name);

  constructor(
    private readonly fetcher: CareerPageFetcherService,
    private readonly atsClient: AtsClientService,
    private readonly browserRenderer: BrowserRendererService,
    private readonly ingestion: CrawlIngestionService,
  ) {}

  /** Fetch outside database transactions; persist sanitized failures and propagate logging failures. */
  async crawl(
    company: CompanyForCrawl,
    assertCanPersist: () => Promise<void> = async () => {},
  ): Promise<CompanyCrawlOutcome> {
    let stage = 'FETCH';
    let page: CareerPage | undefined;
    let crawlerType = 'Generic HTML';
    const started = performance.now();

    try {
      const rawUrl = resolveCareerUrl(company.id, company.careerUrl);

      // Tier 1: Direct ATS API Ingestion (Greenhouse, Lever, Ashby, Workable)
      const directAts = detectAtsEndpoint(rawUrl);
      if (directAts) {
        stage = 'ATS_FETCH';
        crawlerType = `ATS: ${directAts.type.toUpperCase()}`;
        const jobs = await this.atsClient.fetchJobs(company.id, directAts);
        await assertCanPersist();

        stage = 'INGEST';
        const durationMs = Math.round(performance.now() - started);
        const crawlResult: CrawlResult = {
          companyId: company.id,
          requestedUrl: rawUrl,
          finalUrl: directAts.apiUrl,
          httpStatus: 200,
          pageHash: crypto.createHash('sha256').update(JSON.stringify(jobs)).digest('hex'),
          noOpeningsSignal: jobs.length === 0,
          jobs,
          durationMs,
          crawlerType,
        };

        const result = await this.ingestion.ingest(company.id, crawlResult);
        return { companyId: company.id, success: true, jobsFound: result.jobsFound };
      }

      // Tier 2: Static HTML Fetch (Modern desktop Chrome headers, SSRF pinned DNS, Brotli)
      stage = 'FETCH';
      page = await this.fetcher.fetch(rawUrl);
      await assertCanPersist();

      if (page.httpStatus < 200 || page.httpStatus >= 300) {
        throw new CrawlTransportError(
          'HTTP_STATUS',
          `Career page returned HTTP ${page.httpStatus}.`,
          page.httpStatus,
        );
      }

      // Tier 3: Embedded ATS Discovery in HTML
      const embeddedAts = detectEmbeddedAts(page.html, page.finalUrl);
      if (embeddedAts) {
        try {
          stage = 'ATS_EMBED_FETCH';
          const embeddedJobs = await this.atsClient.fetchJobs(company.id, embeddedAts);
          if (embeddedJobs.length > 0) {
            await assertCanPersist();
            stage = 'INGEST';
            const durationMs = Math.round(performance.now() - started);
            crawlerType = `ATS Embedded: ${embeddedAts.type.toUpperCase()}`;
            const crawlResult: CrawlResult = {
              companyId: company.id,
              requestedUrl: rawUrl,
              finalUrl: embeddedAts.apiUrl,
              httpStatus: 200,
              pageHash: crypto
                .createHash('sha256')
                .update(JSON.stringify(embeddedJobs))
                .digest('hex'),
              noOpeningsSignal: false,
              jobs: embeddedJobs,
              durationMs,
              crawlerType,
            };
            const result = await this.ingestion.ingest(company.id, crawlResult);
            return { companyId: company.id, success: true, jobsFound: result.jobsFound };
          }
        } catch {
          // Fall back to standard HTML parsing if embedded ATS fetch fails
        }
      }

      // Tier 4: Static DOM Parsing
      let parseResult: CrawlResult = {
        ...parseCareerPage(company.id, page),
        crawlerType,
        durationMs: page.durationMs,
      };

      // Tier 5: Headless Browser Dynamic Rendering Fallback (Playwright Chromium)
      // If static HTML found 0 jobs AND the HTML indicates an unhydrated JavaScript SPA shell
      if (parseResult.jobs.length === 0 && !parseResult.noOpeningsSignal && isSpaShell(page.html)) {
        try {
          stage = 'BROWSER_RENDER';
          const rendered = await this.browserRenderer.render(page.finalUrl);
          const renderedPage: CareerPage = {
            requestedUrl: page.requestedUrl,
            finalUrl: page.finalUrl,
            httpStatus: rendered.status,
            html: rendered.html,
            durationMs: Math.round(performance.now() - started),
            crawlerType: 'Playwright Headless',
          };
          const renderedParse = parseCareerPage(company.id, renderedPage);
          if (renderedParse.jobs.length > 0 || renderedParse.noOpeningsSignal) {
            crawlerType = 'Playwright Headless';
            parseResult = {
              ...renderedParse,
              crawlerType,
              durationMs: renderedPage.durationMs,
            };
            page = renderedPage;
          }
        } catch (browserError) {
          this.logger.debug(
            `Headless rendering skipped or failed for ${company.id}: ${(browserError as Error).message}`,
          );
        }
      }

      stage = 'INGEST';
      await assertCanPersist();
      const result = await this.ingestion.ingest(company.id, parseResult);
      return { companyId: company.id, success: true, jobsFound: result.jobsFound };
    } catch (error) {
      // A lost run lock must stop the runner, rather than create another company failure record.
      await assertCanPersist();
      const code = error instanceof CrawlTransportError ? error.code : `${stage}_FAILURE`;
      const message =
        error instanceof CrawlTransportError
          ? error.message
          : 'Career page could not be processed.';

      await this.ingestion.recordFailure(company.id, `${code}: ${message}`, {
        httpStatus:
          error instanceof CrawlTransportError
            ? (error.status ?? page?.httpStatus)
            : page?.httpStatus,
        durationMs:
          page?.durationMs ??
          (error instanceof CrawlTransportError ? error.durationMs : undefined) ??
          Math.round(performance.now() - started),
        crawlerType: page?.crawlerType ?? crawlerType,
      });

      return { companyId: company.id, success: false, jobsFound: 0, errorCode: code };
    }
  }
}
