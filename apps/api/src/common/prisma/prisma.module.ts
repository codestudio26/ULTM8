import { Global, Module } from '@nestjs/common';
import { PrismaAppService } from './prisma-app.service';
import { PrismaAuthService } from './prisma-auth.service';
import { PrismaJobsService } from './prisma-jobs.service';

@Global()
@Module({
  providers: [PrismaAppService, PrismaAuthService, PrismaJobsService],
  exports: [PrismaAppService, PrismaAuthService, PrismaJobsService],
})
export class PrismaModule {}
