import { crawlConfig } from '../crawl.config.js';
import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { DailyCrawlRepository } from '../repositories/daily-crawl.repository.js';
import { CompanyCrawlService } from './company-crawl.service.js';

export interface DailyCrawlSummary {
  status: 'completed' | 'stopped' | 'already-running';
  checked: number;
  failed: number;
  skipped: number;
  jobsFound: number;
  limitReached: boolean;
}

function getDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

/** Executes bounded, paced sweeps with concurrent domain-aware workers. */
@Injectable()
export class DailyCrawlService {
  private readonly logger = new Logger(DailyCrawlService.name);
  private running = false;
  constructor(
    private readonly repository: DailyCrawlRepository,
    private readonly companies: CompanyCrawlService,
  ) {}

  /**
   * Process companies concurrently with domain-aware pacing,
   * stop at company boundaries, and release run ownership in every exit path.
   */
  async run(signal: AbortSignal): Promise<DailyCrawlSummary> {
    const summary: DailyCrawlSummary = {
      status: 'completed',
      checked: 0,
      failed: 0,
      skipped: 0,
      jobsFound: 0,
      limitReached: false,
    };
    if (this.running) return { ...summary, status: 'already-running' };
    this.running = true;
    let acquired = false;

    try {
      const config = crawlConfig();
      acquired = await this.repository.acquireRunLock();
      if (!acquired) return { ...summary, status: 'already-running' };
      const upperId = await this.repository.getUpperId();
      let afterId: string | undefined;

      const domainLastPaced = new Map<string, number>();
      const domainDelay = Math.max(config.domainDelayMs, config.delayMs);

      while (upperId && !signal.aborted && !summary.limitReached) {
        await this.repository.assertRunLock();
        const batch = await this.repository.findBatch(upperId, afterId);
        if (!batch.length) break;

        // Process batch using worker pool bounded by concurrency
        let cursor = 0;
        const workerCount = Math.min(config.concurrency, batch.length);

        const runWorker = async () => {
          while (cursor < batch.length) {
            if (signal.aborted || summary.limitReached) break;
            const companyIndex = cursor++;
            const company = batch[companyIndex];
            if (!company) break;

            if (!company.careerUrl.trim()) {
              summary.skipped += 1;
              continue;
            }

            // Domain-aware pacing: prevent hammering identical domains simultaneously
            const domain = getDomain(company.careerUrl);
            const lastTime = domainLastPaced.get(domain) ?? 0;
            const elapsed = Date.now() - lastTime;
            if (elapsed < domainDelay) {
              try {
                await delay(domainDelay - elapsed, undefined, { signal });
              } catch {
                if (signal.aborted) break;
              }
            }
            domainLastPaced.set(domain, Date.now());

            if (signal.aborted || summary.limitReached) break;

            await this.repository.assertRunLock();
            const outcome = await this.companies.crawl(company, () =>
              this.repository.assertRunLock(),
            );

            summary.checked += 1;
            summary.limitReached = config.limit !== undefined && summary.checked >= config.limit;
            summary.jobsFound += outcome.jobsFound;
            if (!outcome.success) summary.failed += 1;

            this.logger.log({
              checked: summary.checked,
              success: outcome.success,
              errorCode: outcome.errorCode,
            });
          }
        };

        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

        afterId = batch[batch.length - 1].id;
        if (batch.length < 50) break;
      }

      if (signal.aborted) summary.status = 'stopped';
      return summary;
    } finally {
      try {
        if (acquired) await this.repository.releaseRunLock();
      } finally {
        this.running = false;
      }
    }
  }
}
