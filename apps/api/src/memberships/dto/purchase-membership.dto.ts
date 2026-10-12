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
 *
 * Track B Slice 4b (Decision 241, `docs/TRACK-B-ROADMAP.md`) — `useHostedCheckout`
 * replaces the plain, unusable `requires_payment`/`clientSecret` fresh-card path
 * (apps/student has no Stripe Elements/PaymentSheet SDK, Decision 113) with a
 * hosted Stripe Checkout Session, the same `mode: 'setup'` pattern Decision
 * 238's saved-card-setup flow already established, extended to `mode: 'payment'`
 * for an actual one-time charge. Scoped identically to `payWithSavedCard` above
 * (CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP only, SUBSCRIPTION rejected — see
 * that same `subscribe()` limitation) — but, unlike `payWithSavedCard`, IS
 * available to a Guardian-driven purchase: the hosted Checkout page is opened
 * in whoever is CALLING this endpoint's own browser session (the Guardian's,
 * in practice, since a linked minor never logs in), the identical "whoever
 * completes it does so in their own app session" shape the SUBSCRIPTION/
 * fresh-card branches below already rely on for a Guardian purchase — no
 * saved-payment-method lookup involved, so none of `payWithSavedCard`'s
 * self-only restriction applies here. Mutually exclusive with
 * `payWithSavedCard` — set at most one.
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

  @ApiPropertyOptional({
    description:
      'Collect a fresh card via a hosted Stripe Checkout Session (Decision 241) instead of returning a bare PaymentIntent clientSecret — the outcome apps/student can actually act on, having no Stripe Elements/PaymentSheet SDK. Mutually exclusive with payWithSavedCard.',
  })
  @IsOptional()
  @IsBoolean()
  useHostedCheckout?: boolean;
}
