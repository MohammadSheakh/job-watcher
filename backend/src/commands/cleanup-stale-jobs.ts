import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage: pnpm jobs:cleanup-stale [options]

Scans the database and purges / closes ghost jobs matching:
  1. Disqualified title sentences ("Meet our team", "Perks for our engineers", etc.)
  2. Generic homepage URL with no description and no deadline
  3. Stale last_seen_at older than 30 days

Options:
  --dry-run       Preview matching jobs without modifying database
  --days=<N>      Number of days threshold for staleness (default: 30)
  --help          Show this help message
`);
    return;
  }

  const dryRun = args.includes('--dry-run');
  const daysArg = args.find((a) => a.startsWith('--days='));
  const staleDays = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

  const { CrawlWorkerModule } = await import('./crawl-worker.module.js');
  const { StaleJobCleanupService } =
    await import('../features/job-crawling/services/stale-job-cleanup.service.js');

  console.log(
    `[Cleanup] Starting stale job purge (Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE EXECUTION'}, Stale cutoff: ${staleDays} days)...`,
  );

  const app = await NestFactory.createApplicationContext(CrawlWorkerModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });

  try {
    const cleanupService = app.get(StaleJobCleanupService);
    const result = await cleanupService.cleanup({ dryRun, staleDays });

    console.log('\n=================== CLEANUP SUMMARY ===================');
    console.log(`Total OPEN Jobs Scanned:            ${result.totalOpenScanned}`);
    console.log(`Disqualified Title Matches:         ${result.disqualifiedTitleCount}`);
    console.log(`Generic Homepage (No-Content) Hits: ${result.genericHomepageCount}`);
    console.log(`Stale Timestamp (> ${staleDays}d) Hits:       ${result.staleTimestampCount}`);
    console.log(`-------------------------------------------------------`);
    console.log(
      `TOTAL JOBS ${dryRun ? 'TO BE CLOSED' : 'CLOSED'}:               ${result.totalClosed}`,
    );
    console.log('=======================================================\n');

    if (result.sampleClosed.length > 0) {
      console.log('Sample Candidate Jobs:');
      for (const sample of result.sampleClosed) {
        console.log(
          ` - [ID ${sample.id}] [${sample.companyId}] "${sample.title}" => [${sample.reasons.join(', ')}]`,
        );
      }
    }

    if (dryRun) {
      console.log(
        '\n💡 Dry run completed. No rows were modified. Run without --dry-run to apply changes.',
      );
    } else {
      console.log(`\n✅ Database updated. ${result.totalClosed} jobs marked CLOSED.`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
