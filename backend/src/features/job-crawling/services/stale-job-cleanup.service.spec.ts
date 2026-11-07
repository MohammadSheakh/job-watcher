/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import {
  StaleJobCleanupService,
  isDisqualifiedTitle,
  isGenericHomepageUrl,
} from './stale-job-cleanup.service.js';
import { PrismaService } from '@app/database';

describe('StaleJobCleanupService', () => {
  let service: StaleJobCleanupService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      job: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StaleJobCleanupService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<StaleJobCleanupService>(StaleJobCleanupService);
  });

  describe('isDisqualifiedTitle', () => {
    it('flags conversational and sentence-like titles', () => {
      expect(isDisqualifiedTitle('Meet our team')).toBe(true);
      expect(isDisqualifiedTitle('Perks for our engineers')).toBe(true);
      expect(isDisqualifiedTitle('Who we are and what we do')).toBe(true);
      expect(isDisqualifiedTitle('We are hiring now! Join us today.')).toBe(true);
      expect(isDisqualifiedTitle('Benefits and perks')).toBe(true);
      expect(isDisqualifiedTitle('Why join us')).toBe(true);
      expect(isDisqualifiedTitle('Privacy Policy')).toBe(true);
    });

    it('accepts legitimate job titles', () => {
      expect(isDisqualifiedTitle('Senior Backend Engineer')).toBe(false);
      expect(isDisqualifiedTitle('Full Stack Developer')).toBe(false);
      expect(isDisqualifiedTitle('Staff DevOps Engineer')).toBe(false);
      expect(isDisqualifiedTitle('Product Designer (UI/UX)')).toBe(false);
      expect(isDisqualifiedTitle('QA Automation Engineer')).toBe(false);
    });
  });

  describe('isGenericHomepageUrl', () => {
    it('flags root homepage URLs with no subpath', () => {
      expect(isGenericHomepageUrl('https://example.com', 'https://example.com')).toBe(true);
      expect(isGenericHomepageUrl('https://example.com/', 'https://example.com')).toBe(true);
    });

    it('accepts specific job detail URLs', () => {
      expect(
        isGenericHomepageUrl('https://example.com/careers/senior-dev', 'https://example.com'),
      ).toBe(false);
      expect(
        isGenericHomepageUrl(
          'https://boards.greenhouse.io/example/jobs/1234',
          'https://example.com',
        ),
      ).toBe(false);
    });
  });

  describe('cleanup logic', () => {
    it('scans and identifies candidate jobs to close in dry-run mode without mutating DB', async () => {
      const now = Date.now();
      const mockJobs = [
        {
          id: 1n,
          companyId: 'C1',
          title: 'Meet our engineering team', // Disqualified title
          description: 'Team info',
          application_url: 'https://c1.com/jobs/1',
          application_deadline: null,
          last_seen_at: new Date(now),
          company: { website_url: 'https://c1.com', careerUrl: 'https://c1.com/careers' },
        },
        {
          id: 2n,
          companyId: 'C2',
          title: 'Software Engineer',
          description: null, // Generic homepage without description
          application_url: 'https://c2.com/',
          application_deadline: null,
          last_seen_at: new Date(now),
          company: { website_url: 'https://c2.com', careerUrl: 'https://c2.com' },
        },
        {
          id: 3n,
          companyId: 'C3',
          title: 'Frontend Developer',
          description: 'Valid description',
          application_url: 'https://c3.com/jobs/fe',
          application_deadline: null,
          last_seen_at: new Date(now - 45 * 24 * 60 * 60 * 1000), // 45 days stale
          company: { website_url: 'https://c3.com', careerUrl: 'https://c3.com/careers' },
        },
        {
          id: 4n,
          companyId: 'C4',
          title: 'Valid Senior Engineer', // Valid job, fresh
          description: 'Valid description',
          application_url: 'https://c4.com/jobs/senior-eng',
          application_deadline: new Date(now + 10 * 24 * 60 * 60 * 1000),
          last_seen_at: new Date(now),
          company: { website_url: 'https://c4.com', careerUrl: 'https://c4.com/careers' },
        },
      ];

      mockPrisma.job.findMany.mockResolvedValue(mockJobs);

      const result = await service.cleanup({ dryRun: true, staleDays: 30 });

      expect(result.totalOpenScanned).toBe(4);
      expect(result.disqualifiedTitleCount).toBe(1);
      expect(result.genericHomepageCount).toBe(1);
      expect(result.staleTimestampCount).toBe(1);
      expect(result.totalClosed).toBe(3);
      expect(result.dryRun).toBe(true);

      // In dry run, updateMany must not be called
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('mutates database in live mode', async () => {
      const mockJobs = [
        {
          id: 10n,
          companyId: 'C10',
          title: 'Meet our leadership',
          description: null,
          application_url: 'https://c10.com',
          application_deadline: null,
          last_seen_at: new Date(),
          company: { website_url: 'https://c10.com', careerUrl: null },
        },
      ];
      mockPrisma.job.findMany.mockResolvedValue(mockJobs);
      mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.cleanup({ dryRun: false });

      expect(result.totalClosed).toBe(1);
      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [10n] } },
        data: { status: 'CLOSED' },
      });
    });
  });
});
