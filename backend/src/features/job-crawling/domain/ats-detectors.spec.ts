import { detectAtsEndpoint } from './ats-detectors.js';

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

  it('detects Lever postings URLs and builds API endpoint', () => {
    const res = detectAtsEndpoint('https://jobs.lever.co/fieldnation');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('lever');
    expect(res?.boardToken).toBe('fieldnation');
    expect(res?.apiUrl).toBe('https://api.lever.co/v0/postings/fieldnation?mode=json');
  });

  it('returns null for standard non-ATS company websites', () => {
    expect(detectAtsEndpoint('https://brainstation-23.com/career')).toBeNull();
    expect(detectAtsEndpoint('https://example.com')).toBeNull();
    expect(detectAtsEndpoint('invalid-url')).toBeNull();
  });
});
