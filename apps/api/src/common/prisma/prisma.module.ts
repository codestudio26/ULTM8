import { Global, Module } from '@nestjs/common';
import { PrismaAppService } from './prisma-app.service';
import { PrismaAuthService } from './prisma-auth.service';

@Global()
@Module({
  providers: [PrismaAppService, PrismaAuthService],
  exports: [PrismaAppService, PrismaAuthService],
})
export class PrismaModule {}
