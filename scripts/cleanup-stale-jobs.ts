import 'dotenv/config';
import { db, closeDb } from '../src/db.js';
import {
  isDisqualifiedTitle,
  isGenericHomepageUrl,
} from '../backend/src/features/job-crawling/services/stale-job-cleanup.service.js';

async function main() {
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
  const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  console.log(
    `[Cleanup] Scanning OPEN jobs (Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE EXECUTION'}, Stale cutoff: ${staleDays} days)...`,
  );

  const query = `
    SELECT 
      j.id,
      j.company_id,
      j.title,
      j.description,
      j.application_url,
      j.application_deadline,
      j.last_seen_at,
      c.website_url,
      c.career_url
    FROM jobs j
    LEFT JOIN companies c ON j.company_id = c.id
    WHERE j.status = 'OPEN'
    ORDER BY j.id ASC
  `;

  const result = await db.query<{
    id: string;
    company_id: string;
    title: string;
    description: string | null;
    application_url: string | null;
    application_deadline: Date | null;
    last_seen_at: Date | null;
    website_url: string | null;
    career_url: string | null;
  }>(query);

  const openJobs = result.rows;
  console.log(`Found ${openJobs.length} OPEN jobs to evaluate.`);

  const toClose: Array<{
    id: string;
    companyId: string;
    title: string;
    reasons: string[];
  }> = [];

  let disqualifiedTitleCount = 0;
  let genericHomepageCount = 0;
  let staleTimestampCount = 0;

  for (const job of openJobs) {
    const reasons: string[] = [];

    // 1. Disqualified title pattern
    if (isDisqualifiedTitle(job.title)) {
      reasons.push('DISQUALIFIED_TITLE');
      disqualifiedTitleCount += 1;
    }

    // 2. Generic homepage URL with zero description and zero deadline
    const isHomepage = isGenericHomepageUrl(job.application_url, job.website_url);
    const hasNoContent = !job.description || !job.description.trim();
    const hasNoDeadline = !job.application_deadline;
    if (isHomepage && hasNoContent && hasNoDeadline) {
      reasons.push('GENERIC_HOMEPAGE_WITHOUT_CONTENT');
      genericHomepageCount += 1;
    }

    // 3. Stale last_seen_at (> 30 days old)
    if (job.last_seen_at && new Date(job.last_seen_at).getTime() < staleCutoff.getTime()) {
      reasons.push(`STALE_TIMESTAMP_>${staleDays}D`);
      staleTimestampCount += 1;
    }

    if (reasons.length > 0) {
      toClose.push({
        id: job.id,
        companyId: job.company_id,
        title: job.title,
        reasons,
      });
    }
  }

  console.log('\n=================== CLEANUP SUMMARY ===================');
  console.log(`Total OPEN Jobs Scanned:            ${openJobs.length}`);
  console.log(`Disqualified Title Matches:         ${disqualifiedTitleCount}`);
  console.log(`Generic Homepage (No-Content) Hits: ${genericHomepageCount}`);
  console.log(`Stale Timestamp (> ${staleDays}d) Hits:       ${staleTimestampCount}`);
  console.log(`-------------------------------------------------------`);
  console.log(`TOTAL JOBS ${dryRun ? 'TO BE CLOSED' : 'CLOSED'}:               ${toClose.length}`);
  console.log('=======================================================\n');

  if (toClose.length > 0) {
    console.log('Candidate Jobs (first 10):');
    for (const sample of toClose.slice(0, 10)) {
      console.log(
        ` - [ID ${sample.id}] [${sample.companyId}] "${sample.title}" => [${sample.reasons.join(', ')}]`,
      );
    }
  }

  if (!dryRun && toClose.length > 0) {
    const ids = toClose.map((item) => item.id);
    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await db.query(`UPDATE jobs SET status = 'CLOSED' WHERE id = ANY($1::bigint[])`, [chunk]);
    }
    console.log(`\n✅ Database updated. ${toClose.length} jobs marked CLOSED.`);
  } else if (dryRun) {
    console.log(
      '\n💡 Dry run completed. No rows were modified. Run without --dry-run to apply changes.',
    );
  } else {
    console.log('\n✅ Database is already clean. No ghost jobs detected.');
  }
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
