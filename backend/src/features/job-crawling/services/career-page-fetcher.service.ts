import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import { createUnzip, createBrotliDecompress } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import type { CareerPage } from '../domain/types.js';

/** Diagnostics are intentionally fixed strings: remote URLs and response bodies may contain secrets. */
export class CrawlTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly durationMs?: number,
  ) {
    super(message);
    this.name = 'CrawlTransportError';
  }
}

type Hop = { status: number; location?: string; html: string };
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEADLINE_MS = 20_000;

/** Fetches bounded public HTML with pinned DNS addresses and manual redirect validation. */
@Injectable()
export class CareerPageFetcherService {
  private active = 0;

  /**
   * Limit active requests per process without accumulating an unbounded waiter queue.
   * Workers must apply their own distributed concurrency policy before scheduling calls.
   */
  async fetch(careerUrl: string): Promise<CareerPage> {
    if (this.active >= 20) throw new CrawlTransportError('CAPACITY', 'Crawler transport is busy.');
    this.active += 1;
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
    try {
      let url = this.parseUrl(careerUrl);
      const requestedUrl = url.href;
      for (let redirects = 0; ; redirects += 1) {
        const address = await this.resolve(url, controller.signal);
        controller.signal.throwIfAborted();
        const hop = await this.request(url, address, controller.signal);
        if (hop.location !== undefined) {
          if (redirects >= MAX_REDIRECTS)
            throw new CrawlTransportError(
              'REDIRECT_LIMIT',
              'Career page exceeded the redirect limit.',
              hop.status,
              Math.round(performance.now() - started),
            );
          const next = this.parseUrl(hop.location, url);
          if (url.protocol === 'https:' && next.protocol !== 'https:')
            throw new CrawlTransportError(
              'REDIRECT_DOWNGRADE',
              'HTTPS downgrade redirects are not allowed.',
              hop.status,
              Math.round(performance.now() - started),
            );
          url = next;
          continue;
        }
        return {
          requestedUrl,
          finalUrl: url.href,
          httpStatus: hop.status,
          html: hop.html,
          durationMs: Math.round(performance.now() - started),
          crawlerType: 'Generic HTML',
        };
      }
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      if (controller.signal.aborted)
        throw new CrawlTransportError(
          'TIMEOUT',
          'Career page request timed out.',
          undefined,
          durationMs,
        );
      if (error instanceof CrawlTransportError)
        throw new CrawlTransportError(error.code, error.message, error.status, durationMs);

      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'CERT_HAS_EXPIRED') {
        throw new CrawlTransportError(
          'SSL_CERT_EXPIRED',
          'Career page SSL certificate has expired.',
          undefined,
          durationMs,
        );
      }
      if (
        err?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        err?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
      ) {
        throw new CrawlTransportError(
          'SSL_CERT_INVALID',
          'Career page SSL certificate is invalid.',
          undefined,
          durationMs,
        );
      }
      if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED') {
        throw new CrawlTransportError(
          'DEAD_DOMAIN',
          'Career page domain is unreachable.',
          undefined,
          durationMs,
        );
      }
      if (err?.code === 'ECONNRESET') {
        throw new CrawlTransportError(
          'NETWORK_RESET',
          'Career page connection was reset.',
          undefined,
          durationMs,
        );
      }

      throw new CrawlTransportError(
        'NETWORK_FAILURE',
        'Career page connection failed.',
        undefined,
        durationMs,
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.active -= 1;
    }
  }

  /** Apply identical restrictions to initial URLs and every redirect target. */
  private parseUrl(value: string, base?: URL): URL {
    let url: URL;
    try {
      url = new URL(value, base);
    } catch {
      throw new CrawlTransportError('INVALID_URL', 'Career page URL is invalid.');
    }
    if (
      value.length > 4096 ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      throw new CrawlTransportError(
        'BLOCKED_URL',
        'Career pages require HTTP(S), default ports, and no URL credentials.',
      );
    url.hash = '';
    return url;
  }

  /** Reject private, loopback, link-local, multicast, reserved, and IPv4-mapped private addresses. */
  private isPublic(address: string): boolean {
    try {
      const parsed = ipaddr.process(address);
      return (
        parsed.range() === 'unicast' &&
        (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parseCIDR('2000::/3')))
      );
    } catch {
      return false;
    }
  }

  /** Resolve once per hop; the socket connects to this exact address rather than resolving again. */
  private async resolve(url: URL, signal: AbortSignal): Promise<string> {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname)) {
      if (!this.isPublic(hostname))
        throw new CrawlTransportError('BLOCKED_ADDRESS', 'Career page address is not public.');
      return hostname;
    }
    // OS DNS cannot be cancelled, but its result is ignored after the overall deadline.
    const addresses = await new Promise<Awaited<ReturnType<typeof this.lookupAll>>>(
      (resolve, reject) => {
        const abort = () =>
          reject(new CrawlTransportError('TIMEOUT', 'Career page request timed out.'));
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        void this.lookupAll(hostname)
          .then(resolve, () =>
            reject(new CrawlTransportError('DNS_FAILURE', 'Career page DNS lookup failed.')),
          )
          .finally(() => signal.removeEventListener('abort', abort));
      },
    );
    if (!addresses.length || addresses.some(({ address }) => !this.isPublic(address)))
      throw new CrawlTransportError(
        'BLOCKED_ADDRESS',
        'Career page DNS includes a non-public address.',
      );
    return addresses[0].address;
  }

  private lookupAll(hostname: string) {
    return lookup(hostname, { all: true, verbatim: true });
  }

  /** Read at most 2 MiB, with one deadline spanning DNS, redirects, headers, and the body. */
  private request(url: URL, address: string, signal: AbortSignal): Promise<Hop> {
    return new Promise((resolve, reject) => {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(
        {
          protocol: url.protocol,
          hostname: address,
          port: url.protocol === 'https:' ? 443 : 80,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          signal,
          agent: false,
          maxHeaderSize: 16 * 1024,
          servername: isIP(hostname) ? undefined : hostname,
          checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert),
          headers: {
            host: url.host,
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'en-US,en;q=0.9',
            'accept-encoding': 'gzip, deflate, br, identity',
            'cache-control': 'max-age=0',
            'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
          },
        },
        (response) => {
          response.once('error', reject);
          response.once('close', () => {
            if (!response.complete)
              reject(
                new CrawlTransportError('INCOMPLETE_BODY', 'Career page response was interrupted.'),
              );
          });
          const status = response.statusCode ?? 0;
          const stop = (error: CrawlTransportError) => {
            response.destroy();
            reject(error);
          };
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location;
            response.destroy();
            if (!location)
              reject(
                new CrawlTransportError(
                  'INVALID_REDIRECT',
                  'Career page redirect has no destination.',
                  status,
                ),
              );
            else resolve({ status, location, html: '' });
            return;
          }
          if (status === 403 || status === 503) {
            const cfRay = response.headers['cf-ray'];
            const server = String(response.headers['server'] || '').toLowerCase();
            if (cfRay || server.includes('cloudflare')) {
              stop(
                new CrawlTransportError(
                  'WAF_CHALLENGE',
                  'Career page protected by Cloudflare bot defense.',
                  status,
                ),
              );
              return;
            }
          }
          if (status < 200 || status >= 300) {
            stop(
              new CrawlTransportError(
                'HTTP_FAILURE',
                `Career page returned HTTP ${status}.`,
                status,
              ),
            );
            return;
          }
          const type = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
          if (!type || !['text/html', 'application/xhtml+xml'].includes(type)) {
            stop(
              new CrawlTransportError('CONTENT_TYPE', 'Career page did not return HTML.', status),
            );
            return;
          }

          const rawEncoding = response.headers['content-encoding'];
          const encoding = rawEncoding?.trim().toLowerCase();
          let stream: NodeJS.ReadableStream = response;

          if (encoding && encoding !== 'identity') {
            if (encoding === 'gzip' || encoding === 'deflate') {
              const decompressor = createUnzip();
              decompressor.once('error', (err) => {
                stop(
                  new CrawlTransportError(
                    'DECOMPRESSION_FAILED',
                    `Failed to decompress ${encoding} payload: ${(err as Error).message}`,
                    status,
                  ),
                );
              });
              response.pipe(decompressor);
              stream = decompressor;
            } else if (encoding === 'br') {
              const decompressor = createBrotliDecompress();
              decompressor.once('error', (err) => {
                stop(
                  new CrawlTransportError(
                    'DECOMPRESSION_FAILED',
                    `Failed to decompress brotli payload: ${(err as Error).message}`,
                    status,
                  ),
                );
              });
              response.pipe(decompressor);
              stream = decompressor;
            } else {
              stop(
                new CrawlTransportError(
                  'CONTENT_ENCODING',
                  `Unsupported career response encoding: ${encoding}`,
                  status,
                ),
              );
              return;
            }
          }

          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              stop(
                new CrawlTransportError(
                  'BODY_LIMIT',
                  'Career page exceeds the 2 MiB limit.',
                  status,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          stream.once('error', reject);
          stream.once('end', () =>
            resolve({ status, html: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.once('error', reject);
      req.end();
    });
  }
}
