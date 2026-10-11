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
import { NotificationBroadcastModule } from './notifications/notification-broadcast.module';
import { FranchiseFeesModule } from './franchise-fees/franchise-fees.module';
import { JobsModule } from './jobs/jobs.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { CurriculumModule } from './curriculum/curriculum.module';
import { TranslationsModule } from './translations/translations.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';

/** Requests per minute per IP on every route (THROTTLE_IP_LIMIT_PER_MINUTE,
 * default 60). Only the browser tests raise it: they drive the whole portal
 * from one address. A missing or invalid value keeps the default. */
function ipLimitPerMinute(): number {
  const n = Number(process.env.THROTTLE_IP_LIMIT_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : 60;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        { ttl: 60_000, limit: ipLimitPerMinute() }, // generous IP-keyed default; auth endpoints override tighter
        // Per-user/per-IP throttling (Decision 17) — the "per-user" dimension. Generous
        // here so every other route is unaffected; auth (Decision 12, decoupled from IP)
        // and booking/waitlist/credit-restore (Decision 17) override this tighter via
        // apps/api/src/common/throttle/identity-trackers.ts's trackers.
        { name: 'identity', ttl: 60_000, limit: 1000 },
      ],
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
    NotificationBroadcastModule,
    FranchiseFeesModule,
    JobsModule,
    PlatformAdminModule,
    CurriculumModule,
    TranslationsModule,
    SubscriptionPlansModule,
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
