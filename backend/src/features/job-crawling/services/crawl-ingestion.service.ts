import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { classifyJobCategories } from '../domain/job-category-classifier.js';
import { parseCareerPage } from '../domain/career-page.parser.js';
import { createJobHash, normalizeLocation, normalizeTitle } from '../domain/normalize.js';
import type { CareerPage } from '../domain/types.js';

/** Persists a parsed career page atomically; fetching and scheduling belong to the caller. */
@Injectable()
export class CrawlIngestionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parse before opening the transaction. Upsert at most 150 jobs using legacy hashes,
   * then commit the company check timestamp and success log with the same writes.
   * An empty/no-openings result never closes existing jobs after one missing crawl.
   */
  async ingest(companyId: string, page: CareerPage) {
    const result = parseCareerPage(companyId, page);
    const checkedAt = new Date();
    let jobsCreated = 0;
    let jobsUpdated = 0;
    let jobsClosed = 0;
    await this.prisma.$transaction(
      async (transaction) => {
        // Query company first to capture prior crawl timestamp for reconciliation
        const existingCompany = await transaction.company.findUnique({
          where: { id: companyId },
          select: { id: true, active: true, recommended_action: true, last_checked_at: true },
        });
        if (
          !existingCompany ||
          !existingCompany.active ||
          existingCompany.recommended_action !== 'MONITOR_READY'
        ) {
          throw new NotFoundException('Company is not available for monitoring.');
        }
        const prevCheckedAt = existingCompany.last_checked_at;

        await transaction.company.update({
          where: { id: companyId },
          data: { last_checked_at: checkedAt },
        });
        const jobHashes = result.jobs.map((job) => createJobHash(job));
        const existingJobRows = jobHashes.length
          ? await transaction.job.findMany({
              where: { jobHash: { in: jobHashes } },
              select: { jobHash: true },
            })
          : [];
        const existingSet = new Set(existingJobRows.map((r) => r.jobHash));
        jobsCreated = 0;
        jobsUpdated = 0;

        const allCategories = transaction.category
          ? await transaction.category.findMany({ select: { id: true, name: true } })
          : [];
        const categoryLookup = new Map<string, bigint>(
          allCategories.map((c: { id: bigint; name: string }) => [c.name.toLowerCase(), c.id]),
        );

        for (const job of result.jobs) {
          const isExpiredDeadline =
            job.deadline !== undefined &&
            job.deadline !== null &&
            job.deadline.getTime() < checkedAt.getTime();
          const status = isExpiredDeadline ? 'CLOSED' : 'OPEN';
          const values = {
            title: normalizeTitle(job.title),
            location: normalizeLocation(job.location) ?? null,
            application_url: job.applicationUrl,
            application_deadline: job.deadline ?? null,
            status,
            last_seen_at: checkedAt,
          };
          const jobHash = createJobHash(job);
          if (existingSet.has(jobHash)) {
            jobsUpdated += 1;
          } else {
            jobsCreated += 1;
            existingSet.add(jobHash);
          }

          const classification = classifyJobCategories({
            title: job.title,
            description: job.description,
          });

          const createdOrUpdated = await transaction.job.upsert({
            where: { jobHash },
            create: {
              ...values,
              companyId,
              jobHash,
              description: job.description ?? null,
              skills: classification.skills.length ? classification.skills.join(', ') : null,
              first_seen_at: checkedAt,
            },
            // Missing descriptions or deadlines must not erase previously extracted content.
            update: {
              ...values,
              application_deadline: job.deadline ?? undefined,
              description: job.description ?? undefined,
              ...(classification.skills.length ? { skills: classification.skills.join(', ') } : {}),
            },
            select: { id: true },
          });

          if (createdOrUpdated?.id && transaction.jobCategory) {
            const categoryInserts = classification.categories
              .map((c) => {
                const categoryId = categoryLookup.get(c.name.toLowerCase());
                if (!categoryId) return null;
                return {
                  jobId: createdOrUpdated.id,
                  categoryId,
                  source: c.source,
                };
              })
              .filter(
                (
                  c,
                ): c is {
                  jobId: bigint;
                  categoryId: bigint;
                  source: 'title' | 'description' | 'skills';
                } => c !== null,
              );

            if (categoryInserts.length > 0) {
              await transaction.jobCategory.deleteMany({
                where: { jobId: createdOrUpdated.id },
              });
              await transaction.jobCategory.createMany({
                data: categoryInserts,
                skipDuplicates: true,
              });
            }
          }
        }

        jobsClosed = 0;
        // Reconciliation Sweep:
        // If this company has a prior check timestamp (prevCheckedAt), any job whose last_seen_at
        // is older than prevCheckedAt was absent in BOTH the prior crawl and today's crawl (2 consecutive strikes).
        // Automatically close it to eliminate ghost vacancies.
        if (prevCheckedAt) {
          const reconcile = await transaction.job.updateMany({
            where: {
              companyId,
              status: 'OPEN',
              last_seen_at: { lt: prevCheckedAt },
            },
            data: {
              status: 'CLOSED',
            },
          });
          jobsClosed += reconcile.count;
        }

        // If the career page explicitly declared no current openings, close any jobs not seen today
        if (result.noOpeningsSignal) {
          const reconcileNoOpenings = await transaction.job.updateMany({
            where: {
              companyId,
              status: 'OPEN',
              last_seen_at: { lt: checkedAt },
            },
            data: {
              status: 'CLOSED',
            },
          });
          jobsClosed += reconcileNoOpenings.count;
        }

        const actionTaken =
          jobsClosed > 0 ? `MONITOR_READY (${jobsClosed} closed)` : 'MONITOR_READY';

        await transaction.crawlLog.create({
          data: {
            company_id: companyId,
            checked_at: checkedAt,
            success: true,
            jobs_found: result.jobs.length,
            http_status: page.httpStatus,
            duration_ms: page.durationMs ?? null,
            crawler_type: page.crawlerType ?? 'Generic HTML',
            jobs_created: jobsCreated,
            jobs_updated: jobsUpdated + jobsClosed,
            action_taken: actionTaken,
          },
        });
      },
      { maxWait: 5000, timeout: 30000 },
    );
    return {
      companyId,
      jobsFound: result.jobs.length,
      jobsCreated,
      jobsUpdated,
      jobsClosed,
      checkedAt: checkedAt.toISOString(),
      finalUrl: result.finalUrl,
      httpStatus: result.httpStatus,
      pageHash: result.pageHash,
      noOpeningsSignal: result.noOpeningsSignal,
      durationMs: page.durationMs,
      crawlerType: page.crawlerType ?? 'Generic HTML',
    };
  }

  /** Record sanitized diagnostics and suggested follow-up; company workflow state is not changed. */
  async recordFailure(
    companyId: string,
    message: string,
    options?: {
      httpStatus?: number;
      durationMs?: number;
      crawlerType?: string;
      actionTaken?: string;
    },
  ): Promise<void> {
    const checkedAt = new Date();
    let actionTaken = options?.actionTaken;
    if (!actionTaken) {
      if (
        options?.httpStatus === 403 ||
        /challenge|captcha|cloudflare|waf|access denied/i.test(message)
      ) {
        actionTaken = 'CUSTOM_ADAPTER_REQUIRED';
      } else if (options?.httpStatus === 404 || /404|not found/i.test(message)) {
        actionTaken = 'FIND_CAREER_PAGE';
      } else {
        actionTaken = 'RETRY_LATER';
      }
    }

    await this.prisma.$transaction(async (transaction) => {
      const company = await transaction.company.updateMany({
        where: { id: companyId },
        data: {
          last_checked_at: checkedAt,
        },
      });
      if (company.count !== 1) throw new NotFoundException('Company was not found.');
      await transaction.crawlLog.create({
        data: {
          company_id: companyId,
          checked_at: checkedAt,
          success: false,
          jobs_found: 0,
          http_status: options?.httpStatus ?? null,
          duration_ms: options?.durationMs ?? null,
          crawler_type: options?.crawlerType ?? 'Generic HTML',
          jobs_created: 0,
          jobs_updated: 0,
          action_taken: actionTaken,
          error: message.trim().slice(0, 2000) || 'Career page could not be processed.',
        },
      });
    });
  }
}
