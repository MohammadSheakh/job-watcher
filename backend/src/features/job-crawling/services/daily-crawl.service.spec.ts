/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DailyCrawlService } from './daily-crawl.service.js';
import { DailyCrawlRepository } from '../repositories/daily-crawl.repository.js';
import { CompanyCrawlService } from './company-crawl.service.js';

describe('DailyCrawlService (Concurrent Architecture)', () => {
  let service: DailyCrawlService;
  let mockRepo: any;
  let mockCompanies: any;

  beforeEach(async () => {
    mockRepo = {
      acquireRunLock: jest.fn().mockResolvedValue(true),
      releaseRunLock: jest.fn().mockResolvedValue(undefined),
      assertRunLock: jest.fn().mockResolvedValue(undefined),
      getUpperId: jest.fn().mockResolvedValue('C10'),
      findBatch: jest.fn(),
    };
    mockCompanies = {
      crawl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyCrawlService,
        { provide: DailyCrawlRepository, useValue: mockRepo },
        { provide: CompanyCrawlService, useValue: mockCompanies },
      ],
    }).compile();

    service = module.get<DailyCrawlService>(DailyCrawlService);
  });

  it('runs concurrent batch sweep and aggregates outcomes', async () => {
    const batch = [
      { id: 'C1', name: 'Alpha', careerUrl: 'https://alpha.com/careers' },
      { id: 'C2', name: 'Beta', careerUrl: 'https://beta.com/careers' },
      { id: 'C3', name: 'Gamma', careerUrl: 'https://gamma.com/careers' },
    ];
    mockRepo.findBatch.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    mockCompanies.crawl.mockImplementation(async (company: any) => ({
      companyId: company.id,
      success: true,
      jobsFound: 2,
    }));

    const controller = new AbortController();
    const summary = await service.run(controller.signal);

    expect(summary.status).toBe('completed');
    expect(summary.checked).toBe(3);
    expect(summary.jobsFound).toBe(6);
    expect(summary.failed).toBe(0);
    expect(mockRepo.acquireRunLock).toHaveBeenCalled();
    expect(mockRepo.releaseRunLock).toHaveBeenCalled();
    expect(mockCompanies.crawl).toHaveBeenCalledTimes(3);
  });

  it('skips companies with empty career URLs', async () => {
    const batch = [
      { id: 'C1', name: 'Alpha', careerUrl: '' },
      { id: 'C2', name: 'Beta', careerUrl: '   ' },
    ];
    mockRepo.findBatch.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const controller = new AbortController();
    const summary = await service.run(controller.signal);

    expect(summary.skipped).toBe(2);
    expect(summary.checked).toBe(0);
    expect(mockCompanies.crawl).not.toHaveBeenCalled();
  });
});
