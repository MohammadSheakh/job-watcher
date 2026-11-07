import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { deterministicMatch } from '../domain/matcher.js';
import type { CandidateForMatch, JobForMatch, MatchResult } from '../domain/types.js';

export interface CandidateRecommendation {
  jobId: string;
  companyId: string;
  companyName: string;
  companyWebsiteUrl: string | null;
  title: string;
  location: string | null;
  workMode: string | null;
  applicationUrl: string | null;
  applicationDeadline?: string | null;
  score: number;
  reasons: string[];
  categories: string[];
  trackingStatus: string | null;
  aiUsed?: boolean;
  isMatch?: boolean;
}

/** Rank existing OPEN jobs with deterministic scoring and optional AI match enhancement. */
@Injectable()
export class CandidateRecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scan by descending bigint ID in bounded batches, retaining only the best results.
   * Excludes explicitly expired vacancies and stale unverified jobs.
   */
  async list(
    candidateId: bigint,
    limit: number,
    enhancer?: (
      candidate: CandidateForMatch,
      job: JobForMatch,
      base: MatchResult,
    ) => Promise<MatchResult>,
  ): Promise<CandidateRecommendation[]> {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, active: true },
      select: {
        expertise: true,
        skills: true,
        experience_level: true,
        experience_years: true,
        preferred_locations: true,
        excluded_locations: true,
        preferred_work_modes: true,
        preferred_categories: true,
        excluded_categories: true,
        minimum_match_score: true,
      },
    });
    if (!candidate) throw new NotFoundException('Candidate profile was not found.');
    const profile: CandidateForMatch = {
      expertise: candidate.expertise,
      skills: candidate.skills,
      experienceLevel: candidate.experience_level,
      experienceYears: candidate.experience_years,
      preferredLocations: candidate.preferred_locations,
      excludedLocations: candidate.excluded_locations,
      preferredWorkModes: candidate.preferred_work_modes,
      preferredCategories: candidate.preferred_categories,
      excludedCategories: candidate.excluded_categories,
    };
    const best: CandidateRecommendation[] = [];
    const batchSize = 200;
    let beforeId: bigint | undefined;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const maxScan = parseInt(process.env.MAX_MATCH_SCAN_JOBS || '1000', 10);
    let totalScanned = 0;

    for (;;) {
      const jobs = await this.prisma.job.findMany({
        where: {
          status: 'OPEN',
          OR: [{ application_deadline: null }, { application_deadline: { gte: now } }],
          last_seen_at: { gte: thirtyDaysAgo },
          ...(beforeId === undefined ? {} : { id: { lt: beforeId } }),
          company: {
            candidate_company_state: {
              none: { candidate_id: candidateId, status: 'EXCLUDED' },
            },
          },
        },
        orderBy: { id: 'desc' },
        take: batchSize,
        select: {
          id: true,
          companyId: true,
          title: true,
          description: true,
          location: true,
          work_mode: true,
          skills: true,
          experience: true,
          application_url: true,
          application_deadline: true,
          company: {
            select: {
              name: true,
              website_url: true,
              careerUrl: true,
              location: true,
              tech_stack: true,
              categories: {
                select: { category: { select: { name: true, type: true } } },
                orderBy: { category: { name: 'asc' } },
              },
              candidate_company_state: {
                where: { candidate_id: candidateId },
                select: { status: true },
              },
            },
          },
        },
      });
      totalScanned += jobs.length;
      for (const job of jobs) {
        const company = job.company;
        const trackingStatus = company.candidate_company_state[0]?.status ?? null;
        // Recheck the projected state in case a blacklist changed between relation reads.
        if (trackingStatus === 'EXCLUDED') continue;
        const categories = company.categories.map(({ category }) => category);
        const names = categories.filter(({ name }) => name !== 'Other').map(({ name }) => name);
        const jobForMatch: JobForMatch = {
          companyLocation: company.location,
          companyTechStack: company.tech_stack,
          companyCategories: names,
          companySectorCategories: categories
            .filter(({ type }) => type === 'sector')
            .map(({ name }) => name),
          title: job.title,
          description: job.description,
          location: job.location,
          workMode: job.work_mode,
          skills: job.skills,
          experience: job.experience,
        };
        let result = deterministicMatch(profile, jobForMatch);
        if (enhancer && result.eligible) {
          result = await enhancer(profile, jobForMatch, result);
        }
        const isMatch = result.eligible && result.finalScore >= candidate.minimum_match_score;
        best.push({
          jobId: job.id.toString(),
          companyId: job.companyId,
          companyName: company.name,
          companyWebsiteUrl: company.website_url,
          title: job.title,
          location: job.location ?? company.location,
          workMode: job.work_mode,
          applicationUrl: job.application_url ?? company.careerUrl ?? company.website_url,
          applicationDeadline: job.application_deadline?.toISOString() ?? null,
          score: result.eligible ? result.finalScore : 0,
          reasons: isMatch ? result.reasons.slice(0, 3) : [],
          categories: names.slice(0, 5),
          trackingStatus,
          aiUsed: result.aiUsed,
          isMatch,
        });
        // Sort matches to the top by score, followed by other crawled jobs by recency.
        best.sort((a, b) => {
          if (a.isMatch && !b.isMatch) return -1;
          if (!a.isMatch && b.isMatch) return 1;
          if (a.isMatch && b.isMatch) {
            return b.score - a.score || (BigInt(a.jobId) > BigInt(b.jobId) ? -1 : 1);
          }
          return BigInt(a.jobId) > BigInt(b.jobId) ? -1 : 1;
        });
        if (best.length > limit) best.pop();
      }
      if (jobs.length < batchSize || totalScanned >= maxScan) break;
      beforeId = jobs[jobs.length - 1].id;
    }
    return best;
  }
}
