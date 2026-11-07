import { AtsClientService } from './ats-client.service.js';
import type { AtsEndpoint } from '../domain/ats-detectors.js';

describe('AtsClientService', () => {
  let service: AtsClientService;

  beforeEach(() => {
    service = new AtsClientService();
  });

  it('parses Greenhouse API JSON into CrawledJob format', () => {
    const endpoint: AtsEndpoint = {
      type: 'greenhouse',
      boardToken: 'figma',
      apiUrl: 'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true',
      sourceUrl: 'https://boards.greenhouse.io/figma',
    };

    const mockData = {
      jobs: [
        {
          id: 54321,
          title: 'Senior Software Engineer, Frontend',
          absolute_url: 'https://boards.greenhouse.io/figma/jobs/54321',
          location: { name: 'San Francisco, CA' },
          content: '&lt;p&gt;We are looking for an engineer...&lt;/p&gt;',
        },
        {
          id: 54322,
          title: 'Staff Security Engineer',
          absolute_url: 'https://boards.greenhouse.io/figma/jobs/54322?utm_source=test',
          location: { name: 'Remote' },
          content: '<p>Security operations...</p>',
        },
      ],
    };

    const jobs = service.parseAtsResponse('C001', endpoint, mockData);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Senior Software Engineer, Frontend');
    expect(jobs[0].location).toBe('San Francisco, CA');
    expect(jobs[0].applicationUrl).toBe('https://boards.greenhouse.io/figma/jobs/54321');
    expect(jobs[0].description).toBeDefined();

    // Canonicalization should have stripped utm_source
    expect(jobs[1].applicationUrl).toBe('https://boards.greenhouse.io/figma/jobs/54322');
  });

  it('parses Lever API JSON into CrawledJob format', () => {
    const endpoint: AtsEndpoint = {
      type: 'lever',
      boardToken: 'fieldnation',
      apiUrl: 'https://api.lever.co/v0/postings/fieldnation?mode=json',
      sourceUrl: 'https://jobs.lever.co/fieldnation',
    };

    const mockData = [
      {
        id: 'lever-1',
        text: 'Lead DevOps Engineer',
        hostedUrl: 'https://jobs.lever.co/fieldnation/lever-1',
        descriptionPlain: 'Responsible for Kubernetes clusters.',
        categories: {
          location: 'Dhaka, Bangladesh',
          commitment: 'Full-time',
        },
      },
    ];

    const jobs = service.parseAtsResponse('C002', endpoint, mockData);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Lead DevOps Engineer');
    expect(jobs[0].location).toBe('Dhaka, Bangladesh');
    expect(jobs[0].description).toBe('Responsible for Kubernetes clusters.');
  });

  it('parses Ashby API JSON into CrawledJob format', () => {
    const endpoint: AtsEndpoint = {
      type: 'ashby',
      boardToken: 'ramp',
      apiUrl: 'https://api.ashbyhq.com/posting-api/job-board/ramp',
      sourceUrl: 'https://jobs.ashbyhq.com/ramp',
    };

    const mockData = {
      jobs: [
        {
          id: 'ashby-1',
          title: 'Infrastructure Engineer',
          location: 'New York, NY',
          jobUrl: 'https://jobs.ashbyhq.com/ramp/ashby-1',
          descriptionPlain: 'Scale Ramp infra.',
        },
      ],
    };

    const jobs = service.parseAtsResponse('C003', endpoint, mockData);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Infrastructure Engineer');
    expect(jobs[0].location).toBe('New York, NY');
    expect(jobs[0].applicationUrl).toBe('https://jobs.ashbyhq.com/ramp/ashby-1');
  });

  it('parses Workable API JSON into CrawledJob format', () => {
    const endpoint: AtsEndpoint = {
      type: 'workable',
      boardToken: 'spotify',
      apiUrl: 'https://apply.workable.com/api/v1/widget/accounts/spotify',
      sourceUrl: 'https://apply.workable.com/spotify',
    };

    const mockData = {
      results: [
        {
          id: 'workable-1',
          title: 'Product Designer',
          url: 'https://apply.workable.com/spotify/j/XYZ123/',
          location: {
            city: 'Stockholm',
            country: 'Sweden',
          },
          description: '<p>Designing music experiences.</p>',
        },
      ],
    };

    const jobs = service.parseAtsResponse('C004', endpoint, mockData);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Product Designer');
    expect(jobs[0].location).toBe('Stockholm, Sweden');
    expect(jobs[0].description).toBe('Designing music experiences.');
  });
});

