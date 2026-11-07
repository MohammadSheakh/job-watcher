import { parseCareerPage } from './career-page.parser.js';
import type { CareerPage } from './types.js';

describe('Pure domain career page parser (career-page.parser.ts)', () => {
  const companyId = '42';
  const requestedUrl = 'https://example.com/careers';
  const finalUrl = 'https://example.com/careers';

  it('extracts jobs and deadlines from standard HTML career pages', () => {
    const html = `
      <html>
        <body>
          <div class="careers-section">
            <h2>Current Openings</h2>
            <div class="job-item">
              <a href="/jobs/backend-engineer">Senior Backend Engineer</a>
              <span class="location">Dhaka, Bangladesh</span>
              <p>Deadline: 2026-12-31</p>
            </div>
            <div class="job-item">
              <a href="/jobs/frontend-developer">Frontend Developer (React)</a>
              <span class="location">Remote</span>
            </div>
          </div>
        </body>
      </html>
    `;

    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html,
    };

    const result = parseCareerPage(companyId, page);

    expect(result.companyId).toBe(companyId);
    expect(result.noOpeningsSignal).toBe(false);
    expect(result.jobs.length).toBeGreaterThanOrEqual(1);
    expect(result.pageHash).toMatch(/^[a-f0-9]{64}$/);

    const backendJob = result.jobs.find((j) => /backend/i.test(j.title));
    expect(backendJob).toBeDefined();
    expect(backendJob?.applicationUrl).toContain('https://example.com/jobs/backend-engineer');
    expect(backendJob?.deadline).toBeInstanceOf(Date);
    expect(backendJob?.deadline?.toISOString()).toContain('2026-12-31');
  });

  it('extracts Schema.org JSON-LD JobPosting metadata with high precision', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Principal Cloud Architect",
            "description": "Leading cloud migration initiatives across EMEA.",
            "validThrough": "2026-12-31T23:59:59Z",
            "jobLocation": {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Dhaka",
                "addressCountry": "Bangladesh"
              }
            },
            "url": "https://example.com/careers/cloud-architect"
          }
          </script>
        </head>
        <body>
          <h1>Careers</h1>
        </body>
      </html>
    `;

    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html,
    };

    const result = parseCareerPage(companyId, page);
    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0];
    expect(job.title).toBe('Principal Cloud Architect');
    expect(job.applicationUrl).toBe('https://example.com/careers/cloud-architect');
    expect(job.location).toContain('Dhaka');
    expect(job.description).toContain('Leading cloud migration');
    expect(job.deadline).toBeInstanceOf(Date);
  });

  it('supports single-page listings without separate pages using anchor hashes and vacancy cues', () => {
    const html = `
      <html>
        <body>
          <section>
            <h2>Current Openings</h2>
            <div id="role-fullstack" class="job-card">
              <h3>Fullstack Software Engineer</h3>
              <p>Experience: 4+ years in Node.js and React</p>
              <a href="#role-fullstack" class="btn">Apply Here</a>
            </div>
          </section>
        </body>
      </html>
    `;

    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html,
    };

    const result = parseCareerPage(companyId, page);
    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].title).toBe('Fullstack Software Engineer');
    expect(result.jobs[0].applicationUrl).toBe('https://example.com/careers#role-fullstack');
  });

  it('strictly rejects company descriptions, founder bios, and perks paragraphs from becoming fake jobs', () => {
    const html = `
      <html>
        <body>
          <div class="careers-about">
            <h2>Current Openings</h2>
            <p>Our company was founded by an experienced software engineer and lead designer. We are looking for talented people.</p>
            <div class="perks">
              <p>Perks: Continuous mentorship from senior architect colleagues.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html,
    };

    const result = parseCareerPage(companyId, page);
    expect(result.jobs).toEqual([]);
  });

  it('strictly rejects service pricing / SLA tables from becoming fake vacancies', () => {
    const html = `
      <html>
        <body>
          <table>
            <tr>
              <td>Enterprise Support Specialist</td>
              <td>24/7 dedicated support phone line</td>
            </tr>
            <tr>
              <td>Database Administrator Services</td>
              <td>High availability managed cluster</td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html,
    };

    const result = parseCareerPage(companyId, page);
    expect(result.jobs).toEqual([]);
  });

  it('detects explicit "no current openings" signal and returns empty jobs list', () => {
    const html = `
      <html>
        <body>
          <h1>Careers</h1>
          <p>Thank you for your interest. Currently no openings are available at this time.</p>
        </body>
      </html>
    `;

    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html,
    };

    const result = parseCareerPage(companyId, page);

    expect(result.noOpeningsSignal).toBe(true);
    expect(result.jobs).toEqual([]);
  });

  it('throws an error if HTTP status is not 2xx', () => {
    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 404,
      html: '<html><body>Not found</body></html>',
    };

    expect(() => parseCareerPage(companyId, page)).toThrow('HTTP 404');
  });

  it('throws an error if HTML size exceeds the 2 MiB safety limit', () => {
    const hugeHtml = 'x'.repeat(2 * 1024 * 1024 + 10);
    const page: CareerPage = {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      html: hugeHtml,
    };

    expect(() => parseCareerPage(companyId, page)).toThrow(/2 MiB parsing limit/);
  });
});
