import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /membership-plans/{id}/purchase body (Phase 39 — this route had no
 * body at all before now). `studentId` is the same on-behalf-of shape
 * SignWaiverDto (Phase 37) / JoinSchoolDto (Phase 38) already established:
 * omitted/equal-to-caller means an ordinary self-service purchase; naming a
 * different id means a Guardian purchasing a MembershipPlan for a linked
 * minor. MembershipsService.purchase() asserts an active GuardianLink before
 * honoring it.
 *
 * A Guardian-driven purchase still collects payment the exact same way a
 * self-purchase does today — fresh, client-side, via Stripe Elements against
 * the returned `clientSecret` (PaymentsService.charge()/subscribe()'s own
 * header comment: no persisted PaymentMethod/saved-card concept exists
 * anywhere in this codebase yet) — so "whose card pays" is not a design
 * question this DTO needs to answer: whoever completes the resulting Stripe
 * payment (in practice, the Guardian, since the minor cannot log in at all —
 * see GuardiansService.createMinor()'s own comment) simply does so in their
 * own app session, same as any purchase flow already works. This will need
 * revisiting once a saved-PaymentMethod feature is eventually built (flagged
 * for the Architect in this phase's own PR description, not solved here).
 */
export class PurchaseMembershipDto {
  @ApiPropertyOptional({ description: 'Guardian-only: purchase this MembershipPlan for this linked minor Student instead of the caller.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
