import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@app/database';
import { CandidateJobsQueryDto } from '../dto/candidate-jobs-query.dto.js';
import { deterministicMatch } from '../../matching/domain/matcher.js';
import type { CandidateForMatch, JobForMatch } from '../../matching/domain/types.js';

export interface CandidateJobRow {
  id: string;
  companyId: string;
  companyName: string;
  companyWebsiteUrl: string | null;
  title: string;
  location: string | null;
  workMode: string | null;
  skills: string | null;
  experience: string | null;
  applicationUrl: string | null;
  applicationDeadline: string | null;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  jobCategories: string[];
  companyCategories: string[];
  trackingStatus: string | null;
  score: number;
  reasons: string[];
  isMatch: boolean;
}

export interface CandidateCategoryJobCount {
  id: string;
  name: string;
  type: string;
  jobCount: number;
}

@Injectable()
export class CandidateJobsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return candidate-aware crawled jobs catalog with preference matching and pipeline tracking.
   */
  async list(candidateId: bigint, query: CandidateJobsQueryDto) {
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

    const andConditions: Prisma.JobWhereInput[] = [];

    // Filter by job status (default OPEN)
    andConditions.push({ status: query.status ?? 'OPEN' });

    // Exclude candidate-blacklisted companies
    andConditions.push({
      company: {
        candidate_company_state: {
          none: { candidate_id: candidateId, status: 'EXCLUDED' },
        },
      },
    });

    if (query.search?.trim()) {
      const search = query.search.trim();
      andConditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          { company: { name: { contains: search, mode: 'insensitive' } } },
          { skills: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.workMode?.trim()) {
      andConditions.push({
        work_mode: { contains: query.workMode.trim(), mode: 'insensitive' },
      });
    }

    const scope = query.categoryScope ?? 'all';

    const buildCategoryFilter = (filter: {
      name?: string;
      type?: string;
    }): Prisma.JobWhereInput => {
      const categoryCriteria: Prisma.CategoryWhereInput = {};
      if (filter.name) {
        categoryCriteria.name = { equals: filter.name, mode: 'insensitive' };
      }
      if (filter.type) {
        categoryCriteria.type = { equals: filter.type, mode: 'insensitive' };
      }

      const jobCondition = {
        categories: {
          some: {
            category: categoryCriteria,
          },
        },
      };

      const companyCondition = {
        company: {
          categories: {
            some: {
              category: categoryCriteria,
            },
          },
        },
      };

      if (scope === 'job') return jobCondition;
      if (scope === 'company') return companyCondition;
      return { OR: [jobCondition, companyCondition] };
    };

    if (query.category?.trim()) {
      andConditions.push(buildCategoryFilter({ name: query.category.trim() }));
    }
    if (query.technology?.trim()) {
      andConditions.push(
        buildCategoryFilter({ name: query.technology.trim(), type: 'technology' }),
      );
    }
    if (query.domain?.trim()) {
      andConditions.push(buildCategoryFilter({ name: query.domain.trim(), type: 'domain' }));
    }
    if (query.sector?.trim()) {
      andConditions.push(buildCategoryFilter({ name: query.sector.trim(), type: 'sector' }));
    }

    const where: Prisma.JobWhereInput = { AND: andConditions };

    const jobs = await this.prisma.job.findMany({
      where,
      orderBy: [{ first_seen_at: 'desc' }, { id: 'desc' }],
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
        first_seen_at: true,
        last_seen_at: true,
        status: true,
        categories: {
          include: {
            category: {
              select: { name: true, type: true },
            },
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            website_url: true,
            careerUrl: true,
            location: true,
            tech_stack: true,
            categories: {
              include: {
                category: {
                  select: { name: true, type: true },
                },
              },
            },
            candidate_company_state: {
              where: { candidate_id: candidateId },
              select: { status: true },
            },
          },
        },
      },
    });

    const mapped: CandidateJobRow[] = [];
    for (const job of jobs) {
      const company = job.company;
      const trackingStatus: string | null = company.candidate_company_state[0]?.status ?? null;
      if (trackingStatus === 'EXCLUDED') continue;

      const companyCats = company.categories.map((c) => c.category);
      const companyCatNames = companyCats.filter((c) => c.name !== 'Other').map((c) => c.name);

      const jobCats = (job.categories ?? []).map((c) => c.category);
      const jobCatNames = jobCats.filter((c) => c.name !== 'Other').map((c) => c.name);

      const jobForMatch: JobForMatch = {
        companyLocation: company.location,
        companyTechStack: company.tech_stack,
        companyCategories: companyCatNames,
        companySectorCategories: companyCats.filter((c) => c.type === 'sector').map((c) => c.name),
        title: job.title,
        description: job.description,
        location: job.location,
        workMode: job.work_mode,
        skills: job.skills,
        experience: job.experience,
      };

      const result = deterministicMatch(profile, jobForMatch);
      const isMatch = result.eligible && result.finalScore >= candidate.minimum_match_score;

      mapped.push({
        id: job.id.toString(),
        companyId: company.id,
        companyName: company.name,
        companyWebsiteUrl: company.website_url,
        title: job.title,
        location: job.location ?? company.location,
        workMode: job.work_mode,
        skills: job.skills,
        experience: job.experience,
        applicationUrl: job.application_url ?? company.careerUrl ?? company.website_url,
        applicationDeadline: job.application_deadline
          ? job.application_deadline.toISOString()
          : null,
        status: job.status,
        firstSeenAt: job.first_seen_at.toISOString(),
        lastSeenAt: job.last_seen_at.toISOString(),
        jobCategories: jobCatNames,
        companyCategories: companyCatNames,
        trackingStatus,
        score: result.eligible ? result.finalScore : 0,
        reasons: isMatch ? result.reasons.slice(0, 3) : [],
        isMatch,
      });
    }

    const matchedCount = mapped.filter((j) => j.isMatch).length;
    const filtered = query.matchedOnly ? mapped.filter((j) => j.isMatch) : mapped;

    // Sorting
    if (query.sortBy === 'recent') {
      filtered.sort(
        (a, b) =>
          new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime() ||
          (BigInt(b.id) > BigInt(a.id) ? 1 : -1),
      );
    } else {
      // Default: Profile matches first, then score descending, then recency
      filtered.sort((a, b) => {
        if (a.isMatch && !b.isMatch) return -1;
        if (!a.isMatch && b.isMatch) return 1;
        if (a.isMatch && b.isMatch) {
          if (b.score !== a.score) return b.score - a.score;
        }
        return (
          new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime() ||
          (BigInt(b.id) > BigInt(a.id) ? 1 : -1)
        );
      });
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const total = filtered.length;
    const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      total,
      page,
      pageSize,
      matchedCount,
      rows,
    };
  }

  /**
   * Return category intelligence: which category has how many open jobs found in crawling.
   */
  async getCategoryJobCounts(): Promise<CandidateCategoryJobCount[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: bigint; name: string; type: string; job_count: bigint | number }>
    >`
      SELECT 
        c.id, 
        c.name, 
        c.type, 
        COUNT(DISTINCT j.id)::int AS job_count
      FROM categories c
      LEFT JOIN (
        SELECT jc.category_id, jc.job_id AS id
        FROM job_categories jc
        JOIN jobs j ON j.id = jc.job_id AND j.status = 'OPEN'
        UNION
        SELECT cc.category_id, j.id
        FROM company_categories cc
        JOIN jobs j ON j.company_id = cc.company_id AND j.status = 'OPEN'
      ) j ON j.category_id = c.id
      WHERE c.name != 'Other'
      GROUP BY c.id, c.name, c.type
      ORDER BY c.type ASC, job_count DESC, c.name ASC;
    `;

    return rows.map((r) => ({
      id: r.id.toString(),
      name: r.name,
      type: r.type,
      jobCount: Number(r.job_count),
    }));
  }
}
