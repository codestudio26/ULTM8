import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { jwtSubTracker } from './common/throttle/identity-trackers';
import { defaultIpLimit, defaultIpTracker } from './common/throttle/ip-limit';
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
import { FrontDeskModule } from './front-desk/front-desk.module';
import { StudentNotesModule } from './student-notes/student-notes.module';
import { StudentTagsModule } from './student-tags/student-tags.module';
import { CustomMemberFieldsModule } from './custom-member-fields/custom-member-fields.module';
import { MemberFilesModule } from './member-files/member-files.module';
import { StudentAccessModule } from './student-access/student-access.module';
import { OpenMatsModule } from './open-mats/open-mats.module';
import { ChargesModule } from './charges/charges.module';
import { CardSurchargeModule } from './card-surcharge/card-surcharge.module';
import { LateFeesModule } from './late-fees/late-fees.module';
import { AcademiesModule } from './academies/academies.module';
import { NotificationsModule } from './notifications/notifications.module';
import { NotificationBroadcastModule } from './notifications/broadcast/notification-broadcast.module';
import { FranchiseFeesModule } from './franchise-fees/franchise-fees.module';
import { JobsModule } from './jobs/jobs.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { CurriculumModule } from './curriculum/curriculum.module';
import { TranslationsModule } from './translations/translations.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UploadsModule } from './uploads/uploads.module';
import { StaffRemovalModule } from './tenants/staff-removal/staff-removal.module';
import { HealthModule } from './health/health.module';
import { validateEnv } from './common/config/validate-env';

@Module({
  imports: [
    // A deployed (NODE_ENV=production) API refuses to start without its scoped
    // DB roles and signing secrets — see validate-env.ts.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot({
      throttlers: [
        // Per IP for callers who aren't signed in (see defaultIpLimit); auth and
        // other public endpoints override tighter.
        { ttl: 60_000, limit: defaultIpLimit, getTracker: defaultIpTracker },
        // Per-user/per-IP throttling (Decision 17) — the "per-user" dimension. Generous
        // here so every other route is unaffected; auth (Decision 12, decoupled from IP)
        // and booking/waitlist/credit-restore (Decision 17) override this tighter via
        // apps/api/src/common/throttle/identity-trackers.ts's trackers.
        // Keyed by the signed-in user (JWT sub), falling back to the IP for anonymous
        // requests. Keyed by IP, every student and coach on one School's WiFi (or,
        // without TRUST_PROXY, every user behind the load balancer) shared one
        // 1000/min budget: the booking/schedule stress test of 26 Oct 2026 hit it.
        { name: 'identity', ttl: 60_000, limit: 1000, getTracker: jwtSubTracker },
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
    UploadsModule,
    DashboardModule,
    StaffRemovalModule,
    HealthModule,
    FrontDeskModule,
    StudentNotesModule,
    StudentTagsModule,
    CustomMemberFieldsModule,
    MemberFilesModule,
    StudentAccessModule,
    OpenMatsModule,
    CardSurchargeModule,
    ChargesModule,
    LateFeesModule,
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
