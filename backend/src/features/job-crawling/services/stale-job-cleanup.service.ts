import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';

const DISQUALIFIED_TITLE_PATTERNS = [
  /\b(we are|we're|join us|looking for|our team|about us|who we are|what we do|requirements|responsibilities|benefits|perks|founded by|meet our|our culture)\b/i,
  /[.!?]\s+[A-Za-z]/, // Multiple sentences
  /\b(privacy policy|terms of service|all rights reserved|cookie policy|contact us|learn more|read more|see details|click here|apply now|why join us|view all jobs|job details)\b/i,
];

export function isDisqualifiedTitle(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return true;
  return DISQUALIFIED_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isGenericHomepageUrl(
  applicationUrl: string | null | undefined,
  companyWebsite: string | null | undefined,
): boolean {
  if (!applicationUrl || !applicationUrl.trim()) return true;

  try {
    const appUrl = new URL(applicationUrl);
    const path = appUrl.pathname.replace(/\/+$/, '');
    // If application URL is just the root domain with no path or hash
    if ((path === '' || path === '/') && !appUrl.hash) {
      return true;
    }

    if (companyWebsite) {
      try {
        const siteUrl = new URL(companyWebsite);
        if (
          appUrl.hostname.toLowerCase() === siteUrl.hostname.toLowerCase() &&
          (path === '' || path === '/') &&
          !appUrl.hash
        ) {
          return true;
        }
      } catch {
        // Ignored
      }
    }

    return false;
  } catch {
    return false;
  }
}

export interface CleanupResult {
  totalOpenScanned: number;
  disqualifiedTitleCount: number;
  genericHomepageCount: number;
  staleTimestampCount: number;
  totalClosed: number;
  dryRun: boolean;
  sampleClosed: Array<{
    id: string;
    companyId: string;
    title: string;
    reasons: string[];
  }>;
}

@Injectable()
export class StaleJobCleanupService {
  private readonly logger = new Logger(StaleJobCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async cleanup(options: { dryRun?: boolean; staleDays?: number } = {}): Promise<CleanupResult> {
    const dryRun = options.dryRun ?? false;
    const staleDays = options.staleDays ?? 30;
    const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    const openJobs = await this.prisma.job.findMany({
      where: {
        status: 'OPEN',
      },
      select: {
        id: true,
        companyId: true,
        title: true,
        description: true,
        application_url: true,
        application_deadline: true,
        last_seen_at: true,
        company: {
          select: {
            website_url: true,
            careerUrl: true,
          },
        },
      },
    });

    const toClose: Array<{
      id: bigint;
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
      const isHomepage = isGenericHomepageUrl(job.application_url, job.company?.website_url);
      const hasNoContent = !job.description || !job.description.trim();
      const hasNoDeadline = !job.application_deadline;
      if (isHomepage && hasNoContent && hasNoDeadline) {
        reasons.push('GENERIC_HOMEPAGE_WITHOUT_CONTENT');
        genericHomepageCount += 1;
      }

      // 3. Stale last_seen_at (> 30 days old)
      if (job.last_seen_at && job.last_seen_at.getTime() < staleCutoff.getTime()) {
        reasons.push(`STALE_TIMESTAMP_>${staleDays}D`);
        staleTimestampCount += 1;
      }

      if (reasons.length > 0) {
        toClose.push({
          id: job.id,
          companyId: job.companyId,
          title: job.title,
          reasons,
        });
      }
    }

    if (!dryRun && toClose.length > 0) {
      const ids = toClose.map((item) => item.id);
      // Batch updates in chunks of 500 to stay within PostgreSQL parameter limits
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        await this.prisma.job.updateMany({
          where: {
            id: { in: chunk },
          },
          data: {
            status: 'CLOSED',
          },
        });
      }
    }

    return {
      totalOpenScanned: openJobs.length,
      disqualifiedTitleCount,
      genericHomepageCount,
      staleTimestampCount,
      totalClosed: toClose.length,
      dryRun,
      sampleClosed: toClose.slice(0, 10).map((j) => ({
        id: j.id.toString(),
        companyId: j.companyId,
        title: j.title,
        reasons: j.reasons,
      })),
    };
  }
}

