import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
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
import { RanksModule } from './ranks/ranks.module';
import { WaiversModule } from './waivers/waivers.module';
import { BookingsModule } from './bookings/bookings.module';
import { GuardiansModule } from './guardians/guardians.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AcademiesModule } from './academies/academies.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FranchiseFeesModule } from './franchise-fees/franchise-fees.module';
import { JobsModule } from './jobs/jobs.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { CurriculumModule } from './curriculum/curriculum.module';
import { TranslationsModule } from './translations/translations.module';

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
    RanksModule,
    WaiversModule,
    BookingsModule,
    GuardiansModule,
    AttendanceModule,
    AcademiesModule,
    NotificationsModule,
    FranchiseFeesModule,
    JobsModule,
    PlatformAdminModule,
    CurriculumModule,
    TranslationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Phase 47 — establishes the per-request AsyncLocalStorage store the
  // impersonation-scope RLS fix depends on (RequestContext's own header
  // comment), before Passport/JwtStrategy runs. See
  // RequestContextMiddleware's own comment for why this lives here rather
  // than in main.ts.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
