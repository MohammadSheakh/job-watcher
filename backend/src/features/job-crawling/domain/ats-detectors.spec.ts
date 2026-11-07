import { detectAtsEndpoint, detectEmbeddedAts } from './ats-detectors.js';

describe('ATS Endpoint Detection (ats-detectors.ts)', () => {
  it('detects Greenhouse board URLs and builds API endpoint', () => {
    const res = detectAtsEndpoint('https://boards.greenhouse.io/figma');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('greenhouse');
    expect(res?.boardToken).toBe('figma');
    expect(res?.apiUrl).toBe('https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true');
  });

  it('detects Greenhouse job-boards subdomain', () => {
    const res = detectAtsEndpoint('https://job-boards.greenhouse.io/stripe/jobs');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('greenhouse');
    expect(res?.boardToken).toBe('stripe');
  });

  it('detects Greenhouse embed URL with for parameter', () => {
    const res = detectAtsEndpoint('https://boards.greenhouse.io/embed/job_board?for=stripe');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('greenhouse');
    expect(res?.boardToken).toBe('stripe');
  });

  it('detects Lever postings URLs and builds API endpoint', () => {
    const res = detectAtsEndpoint('https://jobs.lever.co/fieldnation');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('lever');
    expect(res?.boardToken).toBe('fieldnation');
    expect(res?.apiUrl).toBe('https://api.lever.co/v0/postings/fieldnation?mode=json');
  });

  it('detects Ashby job-board URLs and builds API endpoint', () => {
    const res = detectAtsEndpoint('https://jobs.ashbyhq.com/openai');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('ashby');
    expect(res?.boardToken).toBe('openai');
    expect(res?.apiUrl).toBe('https://api.ashbyhq.com/posting-api/job-board/openai');
  });

  it('detects Workable widget URLs and builds API endpoint', () => {
    const res = detectAtsEndpoint('https://apply.workable.com/spotify');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('workable');
    expect(res?.boardToken).toBe('spotify');
    expect(res?.apiUrl).toBe('https://apply.workable.com/api/v1/widget/accounts/spotify');
  });

  it('returns null for standard non-ATS company websites', () => {
    expect(detectAtsEndpoint('https://brainstation-23.com/career')).toBeNull();
    expect(detectAtsEndpoint('https://example.com')).toBeNull();
    expect(detectAtsEndpoint('invalid-url')).toBeNull();
  });

  describe('detectEmbeddedAts', () => {
    it('detects greenhouse iframe in page HTML', () => {
      const html = `
        <html>
          <body>
            <div>
              <iframe src="https://boards.greenhouse.io/embed/job_board?for=airbnb"></iframe>
            </div>
          </body>
        </html>
      `;
      const res = detectEmbeddedAts(html, 'https://airbnb.com/careers');
      expect(res).not.toBeNull();
      expect(res?.type).toBe('greenhouse');
      expect(res?.boardToken).toBe('airbnb');
    });

    it('detects greenhouse script tag in page HTML', () => {
      const html = `
        <html>
          <head>
            <script src="https://boards.greenhouse.io/embed/job_board/js?for=instacart"></script>
          </head>
        </html>
      `;
      const res = detectEmbeddedAts(html);
      expect(res).not.toBeNull();
      expect(res?.type).toBe('greenhouse');
      expect(res?.boardToken).toBe('instacart');
    });

    it('detects lever iframe in page HTML', () => {
      const html = `
        <html>
          <body>
            <iframe src="https://jobs.lever.co/netflix"></iframe>
          </body>
        </html>
      `;
      const res = detectEmbeddedAts(html);
      expect(res).not.toBeNull();
      expect(res?.type).toBe('lever');
      expect(res?.boardToken).toBe('netflix');
    });

    it('detects ashby link in page HTML', () => {
      const html = `
        <html>
          <body>
            <a href="https://jobs.ashbyhq.com/ramp">View open roles on Ashby</a>
          </body>
        </html>
      `;
      const res = detectEmbeddedAts(html);
      expect(res).not.toBeNull();
      expect(res?.type).toBe('ashby');
      expect(res?.boardToken).toBe('ramp');
    });

    it('returns null when no ATS is embedded', () => {
      const html = `<html><body><h1>Careers at MyCompany</h1><p>Send email to jobs@example.com</p></body></html>`;
      expect(detectEmbeddedAts(html)).toBeNull();
    });
  });
});
