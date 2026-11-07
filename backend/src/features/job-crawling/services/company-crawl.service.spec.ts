/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyCrawlService } from './company-crawl.service.js';
import { CareerPageFetcherService } from './career-page-fetcher.service.js';
import { AtsClientService } from './ats-client.service.js';
import { BrowserRendererService } from './browser-renderer.service.js';
import { CrawlIngestionService } from './crawl-ingestion.service.js';
import type { CareerPage, CrawledJob } from '../domain/types.js';

describe('CompanyCrawlService (Multi-Tier Architecture)', () => {
  let service: CompanyCrawlService;
  let mockFetcher: any;
  let mockAtsClient: any;
  let mockBrowserRenderer: any;
  let mockIngestion: any;

  beforeEach(async () => {
    mockFetcher = {
      fetch: jest.fn(),
    };
    mockAtsClient = {
      fetchJobs: jest.fn(),
    };
    mockBrowserRenderer = {
      render: jest.fn(),
    };
    mockIngestion = {
      ingest: jest.fn(),
      recordFailure: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyCrawlService,
        { provide: CareerPageFetcherService, useValue: mockFetcher },
        { provide: AtsClientService, useValue: mockAtsClient },
        { provide: BrowserRendererService, useValue: mockBrowserRenderer },
        { provide: CrawlIngestionService, useValue: mockIngestion },
      ],
    }).compile();

    service = module.get<CompanyCrawlService>(CompanyCrawlService);
  });

  it('Tier 1: uses Direct ATS API when company has a Greenhouse URL', async () => {
    const mockJobs: CrawledJob[] = [
      {
        companyId: 'C100',
        title: 'Backend Engineer',
        applicationUrl: 'https://boards.greenhouse.io/figma/jobs/101',
        sourceUrl: 'https://boards.greenhouse.io/figma',
      },
    ];
    mockAtsClient.fetchJobs.mockResolvedValue(mockJobs);
    mockIngestion.ingest.mockResolvedValue({ jobsFound: 1 });

    const outcome = await service.crawl({
      id: 'C100',
      name: 'Figma',
      careerUrl: 'https://boards.greenhouse.io/figma',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.jobsFound).toBe(1);
    expect(mockAtsClient.fetchJobs).toHaveBeenCalledWith(
      'C100',
      expect.objectContaining({ type: 'greenhouse', boardToken: 'figma' }),
    );
    expect(mockFetcher.fetch).not.toHaveBeenCalled();
    expect(mockIngestion.ingest).toHaveBeenCalledWith(
      'C100',
      expect.objectContaining({
        crawlerType: 'ATS: GREENHOUSE',
        jobs: mockJobs,
      }),
    );
  });

  it('Tier 3: detects Embedded ATS in HTML and ingests from ATS API', async () => {
    const htmlWithAts = `
      <html>
        <body>
          <h1>Careers</h1>
          <iframe src="https://jobs.lever.co/netflix"></iframe>
        </body>
      </html>
    `;
    const page: CareerPage = {
      requestedUrl: 'https://netflix.com/jobs',
      finalUrl: 'https://netflix.com/jobs',
      httpStatus: 200,
      html: htmlWithAts,
      durationMs: 120,
    };
    mockFetcher.fetch.mockResolvedValue(page);

    const mockJobs: CrawledJob[] = [
      {
        companyId: 'C200',
        title: 'Senior Systems Architect',
        applicationUrl: 'https://jobs.lever.co/netflix/job-1',
        sourceUrl: 'https://jobs.lever.co/netflix',
      },
    ];
    mockAtsClient.fetchJobs.mockResolvedValue(mockJobs);
    mockIngestion.ingest.mockResolvedValue({ jobsFound: 1 });

    const outcome = await service.crawl({
      id: 'C200',
      name: 'Netflix',
      careerUrl: 'https://netflix.com/jobs',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.jobsFound).toBe(1);
    expect(mockAtsClient.fetchJobs).toHaveBeenCalledWith(
      'C200',
      expect.objectContaining({ type: 'lever', boardToken: 'netflix' }),
    );
    expect(mockIngestion.ingest).toHaveBeenCalledWith(
      'C200',
      expect.objectContaining({
        crawlerType: 'ATS Embedded: LEVER',
        jobs: mockJobs,
      }),
    );
  });

  it('Tier 5: invokes Headless Playwright when HTML has 0 jobs and is an SPA shell', async () => {
    const spaShellHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div id="root"></div>
          <script src="/static/js/bundle.js"></script>
        </body>
      </html>
    `;
    const staticPage: CareerPage = {
      requestedUrl: 'https://moderntech.io/careers',
      finalUrl: 'https://moderntech.io/careers',
      httpStatus: 200,
      html: spaShellHtml,
      durationMs: 80,
    };
    mockFetcher.fetch.mockResolvedValue(staticPage);

    const hydratedHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div id="root">
            <h1>Open Positions</h1>
            <div class="job-listing">
              <h2>Full Stack Developer</h2>
              <a href="https://moderntech.io/careers/fs-1">Apply now</a>
            </div>
          </div>
        </body>
      </html>
    `;
    mockBrowserRenderer.render.mockResolvedValue({
      html: hydratedHtml,
      status: 200,
      durationMs: 1500,
    });
    mockIngestion.ingest.mockResolvedValue({ jobsFound: 1 });

    const outcome = await service.crawl({
      id: 'C300',
      name: 'ModernTech',
      careerUrl: 'https://moderntech.io/careers',
    });

    expect(outcome.success).toBe(true);
    expect(mockBrowserRenderer.render).toHaveBeenCalledWith('https://moderntech.io/careers');
    expect(mockIngestion.ingest).toHaveBeenCalledWith(
      'C300',
      expect.objectContaining({
        crawlerType: 'Playwright Headless',
      }),
    );
  });
});
