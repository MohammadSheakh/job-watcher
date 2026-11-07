/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { CrawlIngestionService } from './crawl-ingestion.service.js';
import { PrismaService } from '@app/database';
import type { CareerPage } from '../domain/types.js';

describe('CrawlIngestionService (Reconciliation Sweep & Ingestion)', () => {
  let service: CrawlIngestionService;
  let mockPrisma: any;

  const companyId = 'C001';

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockTx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CrawlIngestionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CrawlIngestionService>(CrawlIngestionService);
  });

  const mockTx: any = {
    company: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    job: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    category: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    jobCategory: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    crawlLog: {
      create: jest.fn(),
    },
  };

  it('performs reconciliation sweep and closes jobs absent for 2 consecutive runs', async () => {
    const prevCheckedAt = new Date('2026-11-05T12:00:00Z');

    mockTx.company.findUnique.mockResolvedValue({
      id: companyId,
      active: true,
      recommended_action: 'MONITOR_READY',
      last_checked_at: prevCheckedAt,
    });
    mockTx.company.update.mockResolvedValue({ id: companyId });

    mockTx.job.findMany.mockResolvedValue([]);
    mockTx.job.upsert.mockResolvedValue({ id: 100n });
    mockTx.job.updateMany.mockResolvedValue({ count: 2 }); // 2 jobs reconciled and closed
    mockTx.crawlLog.create.mockResolvedValue({ id: 1n });

    const page: CareerPage = {
      requestedUrl: 'https://example.com/careers',
      finalUrl: 'https://example.com/careers',
      httpStatus: 200,
      html: `
        <html>
          <body>
            <h2>Current Openings</h2>
            <div class="job-item">
              <a href="/jobs/new-lead">Engineering Lead</a>
            </div>
          </body>
        </html>
      `,
    };

    const result = await service.ingest(companyId, page);

    expect(result.jobsFound).toBe(1);
    expect(result.jobsClosed).toBe(2);

    // Verify reconciliation query was called with lt: prevCheckedAt (2-strike condition)
    expect(mockTx.job.updateMany).toHaveBeenCalledWith({
      where: {
        companyId,
        status: 'OPEN',
        last_seen_at: { lt: prevCheckedAt },
      },
      data: {
        status: 'CLOSED',
      },
    });

    // Verify crawl log records closed jobs in action_taken
    expect(mockTx.crawlLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action_taken: 'MONITOR_READY (2 closed)',
          jobs_updated: 2,
        }),
      }),
    );
  });

  it('does not close existing jobs during the very first crawl of a company (prevCheckedAt is null)', async () => {
    mockTx.company.findUnique.mockResolvedValue({
      id: companyId,
      active: true,
      recommended_action: 'MONITOR_READY',
      last_checked_at: null, // First time crawling this company
    });
    mockTx.company.update.mockResolvedValue({ id: companyId });
    mockTx.job.findMany.mockResolvedValue([]);
    mockTx.job.upsert.mockResolvedValue({ id: 101n });
    mockTx.job.updateMany.mockClear();
    mockTx.crawlLog.create.mockResolvedValue({ id: 2n });

    const page: CareerPage = {
      requestedUrl: 'https://example.com/careers',
      finalUrl: 'https://example.com/careers',
      httpStatus: 200,
      html: `
        <html>
          <body>
            <h2>Current Openings</h2>
            <div class="job-item">
              <a href="/jobs/developer">Frontend Developer</a>
            </div>
          </body>
        </html>
      `,
    };

    const result = await service.ingest(companyId, page);

    expect(result.jobsFound).toBe(1);
    expect(result.jobsClosed).toBe(0);
    // updateMany for reconciliation should not be called when prevCheckedAt is null and noOpeningsSignal is false
    expect(mockTx.job.updateMany).not.toHaveBeenCalled();
  });

  it('immediately closes un-seen jobs when career page explicitly declares no current openings', async () => {
    mockTx.company.findUnique.mockResolvedValue({
      id: companyId,
      active: true,
      recommended_action: 'MONITOR_READY',
      last_checked_at: new Date('2026-11-05T12:00:00Z'),
    });
    mockTx.company.update.mockResolvedValue({ id: companyId });
    mockTx.job.findMany.mockResolvedValue([]);
    mockTx.job.updateMany.mockResolvedValue({ count: 3 });
    mockTx.crawlLog.create.mockResolvedValue({ id: 3n });

    const page: CareerPage = {
      requestedUrl: 'https://example.com/careers',
      finalUrl: 'https://example.com/careers',
      httpStatus: 200,
      html: `
        <html>
          <body>
            <h1>Careers</h1>
            <p>We are not hiring at this moment. Currently no openings are available.</p>
          </body>
        </html>
      `,
    };

    const result = await service.ingest(companyId, page);

    expect(result.noOpeningsSignal).toBe(true);
    expect(result.jobsFound).toBe(0);
    expect(result.jobsClosed).toBeGreaterThanOrEqual(1);
  });
});
