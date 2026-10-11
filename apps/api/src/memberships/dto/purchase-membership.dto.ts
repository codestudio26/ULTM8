import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

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
 * the returned `clientSecret` — `payWithSavedCard` below is rejected outright
 * for a Guardian-driven purchase (MembershipsService.purchase()'s own check):
 * the saved-payment-method endpoints (PaymentsController) are self-only, so a
 * linked minor, who never logs in, can never have one to reuse.
 *
 * Decision 236's own flagged follow-up — `payWithSavedCard` (Decision 238's
 * `chargeOffSession()`, gated by step-up re-authentication) lets a
 * SELF-purchasing Student reuse their saved card instead of entering a fresh
 * one. Scoped to CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP only — SUBSCRIPTION
 * is explicitly rejected too: `PaymentsService.subscribe()`'s own header
 * comment already flags that it creates a throwaway Stripe Customer on every
 * call, never wired to `StudentPaymentMethod` — reusing a saved card for a
 * Subscription would need that fixed first, which is its own separate piece
 * of work, not bundled in here.
 */
export class PurchaseMembershipDto {
  @ApiPropertyOptional({ description: 'Guardian-only: purchase this MembershipPlan for this linked minor Student instead of the caller.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Self-purchase only: charge the saved payment method (Decision 238) instead of collecting a fresh card. Requires the X-Step-Up-Token header (Decision 236).' })
  @IsOptional()
  @IsBoolean()
  payWithSavedCard?: boolean;
}
