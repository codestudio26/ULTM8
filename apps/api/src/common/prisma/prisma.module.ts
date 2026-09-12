import { Global, Module } from '@nestjs/common';
import { PrismaAppService } from './prisma-app.service';
import { PrismaAuthService } from './prisma-auth.service';
import { PrismaJobsService } from './prisma-jobs.service';
import { PrismaDiscoveryService } from './prisma-discovery.service';
import { PrismaPlatformAdminService } from './prisma-platform-admin.service';

@Global()
@Module({
  providers: [PrismaAppService, PrismaAuthService, PrismaJobsService, PrismaDiscoveryService, PrismaPlatformAdminService],
  exports: [PrismaAppService, PrismaAuthService, PrismaJobsService, PrismaDiscoveryService, PrismaPlatformAdminService],
})
export class PrismaModule {}
