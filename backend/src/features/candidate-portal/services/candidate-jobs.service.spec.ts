import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@app/database';
import { CandidateJobsService } from './candidate-jobs.service.js';

describe('CandidateJobsService', () => {
  let service: CandidateJobsService;
  const prismaMock = {
    candidate: { findFirst: jest.fn() },
    job: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateJobsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get(CandidateJobsService);
  });

  it('throws NotFoundException if candidate does not exist', async () => {
    prismaMock.candidate.findFirst.mockResolvedValue(null);
    await expect(service.list(999n, { page: 1, pageSize: 25 })).rejects.toThrow(NotFoundException);
  });

  it('ranks matched jobs at the top and includes all crawled jobs', async () => {
    prismaMock.candidate.findFirst.mockResolvedValue({
      id: 1n,
      expertise: 'Backend',
      skills: 'Node.js, TypeScript',
      experience_level: 'Senior',
      experience_years: 5,
      preferred_locations: 'Dhaka',
      excluded_locations: null,
      preferred_work_modes: 'Remote',
      preferred_categories: 'Node.js',
      excluded_categories: null,
      minimum_match_score: 50,
      active: true,
    });

    const now = new Date();
    prismaMock.job.findMany.mockResolvedValue([
      {
        id: 101n,
        companyId: 'comp-unmatched',
        title: 'Marketing Specialist',
        description: 'SEO and campaigns',
        location: 'Chittagong',
        work_mode: 'On-site',
        skills: 'SEO, Google Ads',
        experience: 'Junior',
        application_url: 'https://comp-unmatched.com/jobs/1',
        application_deadline: null,
        first_seen_at: new Date(now.getTime() - 1000),
        last_seen_at: now,
        status: 'OPEN',
        categories: [],
        company: {
          id: 'comp-unmatched',
          name: 'Marketing Corp',
          website_url: 'https://comp-unmatched.com',
          careerUrl: null,
          location: 'Chittagong',
          tech_stack: null,
          categories: [],
          candidate_company_state: [],
        },
      },
      {
        id: 102n,
        companyId: 'comp-matched',
        title: 'Senior Backend Engineer',
        description: 'Build microservices with Node.js and TypeScript',
        location: 'Dhaka',
        work_mode: 'Remote',
        skills: 'Node.js, TypeScript, PostgreSQL',
        experience: 'Senior',
        application_url: 'https://comp-matched.com/careers/backend',
        application_deadline: null,
        first_seen_at: now,
        last_seen_at: now,
        status: 'OPEN',
        categories: [{ category: { name: 'Node.js', type: 'technology' } }],
        company: {
          id: 'comp-matched',
          name: 'Tech Labs',
          website_url: 'https://techlabs.io',
          careerUrl: 'https://techlabs.io/careers',
          location: 'Dhaka',
          tech_stack: 'Node.js, TypeScript',
          categories: [{ category: { name: 'Node.js', type: 'technology' } }],
          candidate_company_state: [{ status: 'PLANNING' }],
        },
      },
    ]);

    const result = await service.list(1n, { page: 1, pageSize: 25 });

    expect(result.total).toBe(2);
    expect(result.matchedCount).toBe(1);
    // Matched job must be placed at index 0 (top)
    expect(result.rows[0].id).toBe('102');
    expect(result.rows[0].isMatch).toBe(true);
    expect(result.rows[0].score).toBeGreaterThanOrEqual(50);
    expect(result.rows[0].trackingStatus).toBe('PLANNING');

    // Unmatched job must be below it
    expect(result.rows[1].id).toBe('101');
    expect(result.rows[1].isMatch).toBe(false);
  });

  it('filters out jobs when matchedOnly is true', async () => {
    prismaMock.candidate.findFirst.mockResolvedValue({
      id: 1n,
      expertise: 'Backend',
      skills: 'Node.js',
      experience_level: 'Mid',
      minimum_match_score: 50,
      active: true,
    });

    const now = new Date();
    prismaMock.job.findMany.mockResolvedValue([
      {
        id: 201n,
        companyId: 'comp-sales',
        title: 'Sales Representative',
        description: 'B2B sales',
        location: 'Dhaka',
        work_mode: 'On-site',
        skills: 'Sales',
        experience: null,
        application_url: null,
        application_deadline: null,
        first_seen_at: now,
        last_seen_at: now,
        status: 'OPEN',
        categories: [],
        company: {
          id: 'comp-sales',
          name: 'Sales Inc',
          website_url: null,
          careerUrl: null,
          location: 'Dhaka',
          tech_stack: null,
          categories: [],
          candidate_company_state: [],
        },
      },
      {
        id: 202n,
        companyId: 'comp-node',
        title: 'Backend Node.js Developer',
        description: 'APIs with Node.js',
        location: 'Dhaka',
        work_mode: 'Hybrid',
        skills: 'Node.js',
        experience: 'Mid',
        application_url: 'https://node.dev/apply',
        application_deadline: null,
        first_seen_at: now,
        last_seen_at: now,
        status: 'OPEN',
        categories: [{ category: { name: 'Node.js', type: 'technology' } }],
        company: {
          id: 'comp-node',
          name: 'Node Dev',
          website_url: 'https://node.dev',
          careerUrl: null,
          location: 'Dhaka',
          tech_stack: 'Node.js',
          categories: [{ category: { name: 'Node.js', type: 'technology' } }],
          candidate_company_state: [],
        },
      },
    ]);

    const result = await service.list(1n, { page: 1, pageSize: 25, matchedOnly: true });

    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe('202');
    expect(result.rows[0].isMatch).toBe(true);
  });

  it('returns category job counts from raw SQL aggregation', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 10n, name: 'Node.js', type: 'technology', job_count: 15 },
      { id: 11n, name: 'React', type: 'technology', job_count: 12 },
      { id: 20n, name: 'Fintech', type: 'domain', job_count: 8 },
    ]);

    const counts = await service.getCategoryJobCounts();

    expect(counts).toEqual([
      { id: '10', name: 'Node.js', type: 'technology', jobCount: 15 },
      { id: '11', name: 'React', type: 'technology', jobCount: 12 },
      { id: '20', name: 'Fintech', type: 'domain', jobCount: 8 },
    ]);
  });
});
