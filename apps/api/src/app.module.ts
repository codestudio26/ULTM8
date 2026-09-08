import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { ClassesModule } from './classes/classes.module';
import { TimetableModule } from './timetable/timetable.module';
import { InstructorsModule } from './instructors/instructors.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { PaymentsModule } from './payments/payments.module';
import { MembershipsModule } from './memberships/memberships.module';
import { TransactionsModule } from './transactions/transactions.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }], // generous default; auth endpoints override tighter
    }),
    PrismaModule,
    AuthModule,
    TenantsModule,
    ClassesModule,
    TimetableModule,
    InstructorsModule,
    UsersModule,
    SettingsModule,
    PaymentsModule,
    MembershipsModule,
    TransactionsModule,
    JobsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
