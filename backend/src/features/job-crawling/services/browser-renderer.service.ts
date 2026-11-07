import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';

export interface RenderResult {
  html: string;
  status: number;
  durationMs: number;
}

export class BrowserRenderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrowserRenderError';
  }
}

/**
 * Enterprise headless browser renderer using Playwright Chromium.
 * Hydrates client-side JavaScript Single Page Applications (React, Next.js, Vue, Angular)
 * into fully rendered HTML DOM for career scraping.
 */
@Injectable()
export class BrowserRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserRendererService.name);
  private browser: Browser | null = null;
  private initializing: Promise<Browser> | null = null;

  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = (async () => {
      try {
        const proxyUrl =
          process.env.CRAWL_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
        const launchOptions: Parameters<typeof chromium.launch>[0] = {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
          ],
          ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
        };

        const instance = await chromium.launch(launchOptions);
        this.browser = instance;
        return instance;
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  /**
   * Renders a JavaScript SPA career page and extracts hydrated HTML.
   */
  async render(
    url: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<RenderResult> {
    const started = performance.now();
    const timeoutMs = options.timeoutMs ?? 20_000;
    const browser = await this.getBrowser();

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Asia/Dhaka',
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Abort media, fonts, and tracking scripts to optimize speed and RAM
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      const reqUrl = route.request().url().toLowerCase();

      if (
        ['image', 'media', 'font'].includes(type) ||
        reqUrl.includes('google-analytics') ||
        reqUrl.includes('googletagmanager') ||
        reqUrl.includes('segment.io') ||
        reqUrl.includes('datadog') ||
        reqUrl.includes('hotjar') ||
        reqUrl.includes('facebook.net')
      ) {
        return route.abort();
      }
      return route.continue();
    });

    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      const status = response ? response.status() : 200;

      // Give client-side JS framework up to 3.5s to mount and hydrate vacancies
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => {}),
        page
          .waitForSelector(
            '[class*=job], [class*=career], [class*=position], [class*=opening], tr, #root > *',
            { timeout: 3500 },
          )
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);

      const html = await page.content();
      const durationMs = Math.round(performance.now() - started);

      return {
        html,
        status,
        durationMs,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      this.logger.warn(
        `Browser rendering failed for ${url} (${durationMs}ms): ${(error as Error).message}`,
      );
      throw new BrowserRenderError(
        `Browser rendering failed for ${url}: ${(error as Error).message}`,
        error,
      );
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignored during teardown
      }
      this.browser = null;
    }
  }
}
