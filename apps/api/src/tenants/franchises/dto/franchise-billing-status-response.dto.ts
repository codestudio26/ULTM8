import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /franchises/{id}/billing-status (Decision 99's own follow-up) — lets
 * FranchiseFormModal know, BEFORE the Franchise Owner submits a rate change,
 * whether `feeRateChangeStrategy` will be required (same "query, don't guess"
 * precedent `MembershipPlanActiveCountResponseDto`'s own
 * GET /membership-plans/{id}/active-count already establishes). Mirrors
 * FranchisesService.update()'s own `schoolsAlreadyBilling` count exactly.
 */
export class FranchiseBillingStatusResponseDto {
  @ApiProperty()
  schoolsAlreadyBillingCount!: number;
}
