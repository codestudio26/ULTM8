import { Global, Module } from '@nestjs/common';
import { PrismaAppService } from './prisma-app.service';
import { PrismaAuthService } from './prisma-auth.service';
import { PrismaJobsService } from './prisma-jobs.service';
import { PrismaDiscoveryService } from './prisma-discovery.service';
import { PrismaPlatformAdminService } from './prisma-platform-admin.service';
import { PrismaGradingErasureService } from './prisma-grading-erasure.service';

@Global()
@Module({
  providers: [PrismaAppService, PrismaAuthService, PrismaJobsService, PrismaDiscoveryService, PrismaPlatformAdminService, PrismaGradingErasureService],
  exports: [PrismaAppService, PrismaAuthService, PrismaJobsService, PrismaDiscoveryService, PrismaPlatformAdminService, PrismaGradingErasureService],
})
export class PrismaModule {}
