import { Module } from '@nestjs/common';
import { CareerPageFetcherService } from './services/career-page-fetcher.service.js';
import { AtsClientService } from './services/ats-client.service.js';
import { BrowserRendererService } from './services/browser-renderer.service.js';
import { CrawlIngestionService } from './services/crawl-ingestion.service.js';
import { CompanyCrawlService } from './services/company-crawl.service.js';
import { DailyCrawlService } from './services/daily-crawl.service.js';
import { DailyCrawlRepository } from './repositories/daily-crawl.repository.js';
import { StaleJobCleanupService } from './services/stale-job-cleanup.service.js';

/** Share execution providers between the API and command process without importing HTTP controllers. */
@Module({
  providers: [
    CareerPageFetcherService,
    AtsClientService,
    BrowserRendererService,
    CrawlIngestionService,
    CompanyCrawlService,
    DailyCrawlService,
    DailyCrawlRepository,
    StaleJobCleanupService,
  ],
  exports: [
    CareerPageFetcherService,
    AtsClientService,
    BrowserRendererService,
    CrawlIngestionService,
    CompanyCrawlService,
    DailyCrawlService,
    StaleJobCleanupService,
  ],
})
export class CrawlExecutionModule {}
