import * as cheerio from 'cheerio';
import { normalizeWhitespace } from './normalize.js';

const EMPTY_SPA_CONTAINER_SELECTORS = [
  '#root:empty',
  '#__next:empty',
  '#app:empty',
  '#___gatsby:empty',
  'app-root:empty',
  '#application:empty',
  '#main-content:empty',
];

const SPA_BUNDLE_REGEX =
  /(?:\/static\/js\/|\/_next\/static\/|\/assets\/|main\.[a-z0-9_-]+\.js|bundle(?:\.[a-z0-9_-]+)?\.js|chunk|umi\.[a-z0-9_-]+\.js|webpack)/i;

/**
 * Detects if an HTML document is an unhydrated JavaScript Single Page Application (SPA) shell
 * whose content was not rendered in static HTML.
 */
export function isSpaShell(html: string): boolean {
  if (!html || !html.trim()) return false;

  try {
    const $ = cheerio.load(html);

    // 1. Direct empty SPA root containers
    for (const selector of EMPTY_SPA_CONTAINER_SELECTORS) {
      if ($(selector).length > 0) {
        return true;
      }
    }

    // Also check containers that only contain whitespace, comments, or a spinner/loader
    const rootEl = $('#root, #__next, #app, #___gatsby, app-root');
    if (rootEl.length > 0) {
      const innerText = normalizeWhitespace(rootEl.text());
      const childCount = rootEl.children().not('script, style, noscript').length;
      if (childCount === 0 || innerText.length < 50) {
        // Likely an unhydrated root
        return true;
      }
    }

    // 2. Noscript tag indicating JavaScript requirement
    const noscriptText = $('noscript').text().toLowerCase();
    if (noscriptText.includes('javascript') || noscriptText.includes('enable js')) {
      const bodyText = normalizeWhitespace($('body').text());
      if (bodyText.length < 500) {
        return true;
      }
    }

    // 3. Page has JS bundles but almost zero body text
    const scripts = $('script[src]')
      .map((_, el) => $(el).attr('src'))
      .get();
    const hasSpaScript = scripts.some((src) => src && SPA_BUNDLE_REGEX.test(src));
    if (hasSpaScript) {
      const bodyText = normalizeWhitespace($('body').text());
      // Less than 200 characters of visible body text with SPA bundles
      if (bodyText.length < 250) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

