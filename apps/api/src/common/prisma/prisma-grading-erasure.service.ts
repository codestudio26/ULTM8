import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_grading_erasure` Postgres role (see
 * 20261115000000_grading_erasure_jobs_grant) — a dedicated, narrowly-scoped
 * LOGIN role for GradingErasureService's Decision 134 erasure, exactly the
 * same shape as PrismaDiscoveryService/PrismaJobsService (own connection
 * string, own additive RLS policies, own GRANTs granting exactly what it
 * needs and nothing else).
 *
 * Deliberately does NOT reuse `ultm8_jobs`: that role is shared by every
 * background job in this codebase, and a first draft of this migration
 * granted DELETE on StudentRank/PromotionEvent/StudentRankSkillStatus to
 * ultm8_jobs directly — which broke a real, already-shipped security
 * invariant (grading-ready-notification.e2e-spec.ts's "the jobs role may
 * only mark a student as notified, nothing else in grading," Decision
 * 178.5), since widening ultm8_jobs for this not-yet-built feature would
 * also widen it for every other job already running under that same role.
 * See the migration's own header comment for the full story.
 *
 * ONLY GradingErasureService may inject this.
 *
 * Plain `console.warn`, not a `Logger` field, before `super()` — same reason
 * every other Prisma*Service in this directory does this: TypeScript doesn't
 * allow `this` to be touched before `super()` runs in a derived class.
 */
@Injectable()
export class PrismaGradingErasureService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL_GRADING_ERASURE;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaGradingErasureService] DATABASE_URL_GRADING_ERASURE is not set — GradingErasureService will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
