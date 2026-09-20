import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';

/**
 * The read-only degraded-portal gate Spec 55 §10.2 confirms, quoted: "On the core
 * platform SubscriptionPlan being cancelled, the subscribing tenant's portal access
 * degrades to read-only — full view of existing data..., no new Classes/Bookings/
 * payments — rather than deletion or forced logout." Scoped to exactly those three
 * confirmed write actions — ClassesService.create(), BookingsService.bookClass(), and
 * MembershipsService.purchase() are the only three call sites this phase wires it
 * into (see each of their own updated header comments).
 *
 * Only fires on `CANCELED`, never on `PAST_DUE` or `null` (never subscribed):
 * - `PAST_DUE` — same "stays Active through Stripe's own retry window" grace period
 *   Membership's own Subscription-renewal-failure handling already gives (Spec 55
 *   §6.1) — a School shouldn't lose write access on the FIRST missed payment,
 *   only once Stripe exhausts retries and the platform Subscription is genuinely
 *   Canceled.
 * - `null` (`platformSubscriptionStatus` unset) — this is the ordinary, current
 *   state of EVERY School in this codebase today: platform SubscriptionPlan billing
 *   is new, optional monetization layered on top of an already-functioning
 *   platform (Phase 0-53 built and shipped an entire product with no such
 *   subscription requirement anywhere), not a precondition to operate it. Spec 55
 *   confirms the CANCELLATION consequence, never a "must have an Active platform
 *   plan to use the product at all" requirement — gating on anything other than a
 *   genuine `CANCELED` would silently lock out every School that simply never
 *   opted into this new billing relationship, a regression this phase's own scope
 *   was never asked to introduce. Flagged explicitly here since it's the one
 *   correctness-critical judgment call this whole gate rests on.
 *
 * Only School-scoped — Spec 55 §10.2 also confirms a Franchise's own cancellation
 * "degrades only the Franchise Owner's own actions (profile/branding/feeModel
 * edits), never cascading to member Schools' own, separately-paid... access."
 * Building that separate Franchise-side gate (on Franchise profile/feeModel edit
 * endpoints, not this one) is deliberately out of this phase's own scope — flagged
 * as a real, confirmed, but not-yet-built follow-up, not silently folded in here.
 */
@Injectable()
export class SubscriptionGateService {
  constructor(private readonly prismaApp: PrismaAppService) {}

  /**
   * `viewerId` MUST be a user id guaranteed RLS-visible into `schoolId` — the
   * actual caller in the ordinary case, but the TARGET Student's own id for any
   * Guardian-on-behalf-of flow (a Guardian caller holds zero RoleGrant anywhere,
   * Decision 92, so `withTenantContext` under the raw caller's own id would see
   * nothing and silently no-op this check rather than genuinely evaluate it — see
   * each call site's own comment for why it passes what it passes).
   */
  async assertNotDegraded(viewerId: string, schoolId: string): Promise<void> {
    const school = await this.prismaApp.withTenantContext(viewerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { platformSubscriptionStatus: true } }),
    );
    if (school?.platformSubscriptionStatus === 'CANCELED') {
      throw new ForbiddenException(
        'This School\'s platform subscription is canceled — portal access is read-only until it is reactivated. No new Classes, Bookings, or payments can be created.',
      );
    }
  }
}
