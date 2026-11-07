import { isSpaShell } from './spa-detector.js';

describe('SPA Shell Detection (spa-detector.ts)', () => {
  it('detects empty React root div', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Careers</title></head>
        <body>
          <div id="root"></div>
          <script src="/static/js/main.123abc45.js"></script>
        </body>
      </html>
    `;
    expect(isSpaShell(html)).toBe(true);
  });

  it('detects empty Next.js container', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <div id="__next"></div>
          <script src="/_next/static/chunks/main.js"></script>
        </body>
      </html>
    `;
    expect(isSpaShell(html)).toBe(true);
  });

  it('detects noscript enable javascript warning with sparse content', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <noscript>You need to enable JavaScript to run this app.</noscript>
          <div id="app"></div>
        </body>
      </html>
    `;
    expect(isSpaShell(html)).toBe(true);
  });

  it('returns false for fully rendered static HTML with job listings', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <header><nav><a href="/">Home</a></nav></header>
          <main>
            <h1>Open Positions</h1>
            <section class="jobs">
              <div class="job-card">
                <h2>Senior Backend Engineer</h2>
                <p>Location: San Francisco, CA. Experience: 5+ years. Apply now.</p>
                <a href="/jobs/123">Apply</a>
              </div>
              <div class="job-card">
                <h2>Product Manager</h2>
                <p>Location: Remote. Experience: 3+ years. Apply now.</p>
                <a href="/jobs/124">Apply</a>
              </div>
            </section>
          </main>
        </body>
      </html>
    `;
    expect(isSpaShell(html)).toBe(false);
  });
});

