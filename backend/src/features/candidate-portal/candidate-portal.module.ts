import { QuickSearchModule } from '../quick-search/quick-search.module.js';
import { CandidateSearchUsageController } from './controllers/candidate-search-usage.controller.js';
import { MatchingModule } from '../matching/matching.module.js';
import { CandidateRecommendationsController } from './controllers/candidate-recommendations.controller.js';
import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { CandidateProfileController } from './controllers/candidate-profile.controller.js';
import { CandidateProfileService } from './services/candidate-profile.service.js';
import { CandidatePipelineController } from './controllers/candidate-pipeline.controller.js';
import { CandidatePipelineService } from './services/candidate-pipeline.service.js';
import { CandidateCompanyController } from './controllers/candidate-company.controller.js';
import { CandidateCompanyService } from './services/candidate-company.service.js';
import { CandidateCategoryCatalogController } from './controllers/candidate-category-catalog.controller.js';
import { CandidateCategoryCatalogService } from './services/candidate-category-catalog.service.js';
import { CandidateJobsController } from './controllers/candidate-jobs.controller.js';
import { CandidateJobsService } from './services/candidate-jobs.service.js';

@Module({
  imports: [AuthenticationModule, MatchingModule, QuickSearchModule],
  controllers: [
    CandidateSearchUsageController,
    CandidateRecommendationsController,
    CandidateProfileController,
    CandidatePipelineController,
    CandidateCompanyController,
    CandidateCategoryCatalogController,
    CandidateJobsController,
  ],
  providers: [
    CandidateProfileService,
    CandidatePipelineService,
    CandidateCompanyService,
    CandidateCategoryCatalogService,
    CandidateJobsService,
  ],
})
export class CandidatePortalModule {}
