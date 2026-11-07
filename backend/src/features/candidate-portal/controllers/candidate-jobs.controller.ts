import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { CandidatePasswordChangedGuard } from '../../authentication/guards/candidate-password-changed.guard.js';
import {
  CandidateSessionGuard,
  type CandidateRequest,
} from '../../authentication/guards/candidate-session.guard.js';
import { CandidateJobsQueryDto } from '../dto/candidate-jobs-query.dto.js';
import { CandidateJobsService } from '../services/candidate-jobs.service.js';

/** Authenticated jobs catalog for candidates with preference matching and category breakdown. */
@Controller('candidate/jobs')
@UseGuards(CandidateSessionGuard, CandidatePasswordChangedGuard)
export class CandidateJobsController {
  constructor(private readonly candidateJobs: CandidateJobsService) {}

  /** Return all categories and their open job counts for category breakdown. */
  @Get('categories')
  @Header('Cache-Control', 'private, no-store')
  getCategories() {
    return this.candidateJobs.getCategoryJobCounts();
  }

  /** Return filtered, candidate-matched crawled jobs catalog. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req()
    request: CandidateRequest,
    @Query()
    query: CandidateJobsQueryDto,
  ) {
    return this.candidateJobs.list(request.candidate.id, query);
  }
}
