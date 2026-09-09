import { Global, Module } from '@nestjs/common';
import { PrismaAppService } from './prisma-app.service';
import { PrismaAuthService } from './prisma-auth.service';
import { PrismaJobsService } from './prisma-jobs.service';
import { PrismaDiscoveryService } from './prisma-discovery.service';

@Global()
@Module({
  providers: [PrismaAppService, PrismaAuthService, PrismaJobsService, PrismaDiscoveryService],
  exports: [PrismaAppService, PrismaAuthService, PrismaJobsService, PrismaDiscoveryService],
})
export class PrismaModule {}
