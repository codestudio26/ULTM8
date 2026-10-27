import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /membership-plans/{id}/active-count (v1.2 backend backlog —
 * MembershipPlansPage's own "Active members" stat tile). See
 * MembershipsService.getActiveMemberCount's own header comment for the
 * "Active" definition this reuses rather than invents.
 */
export class MembershipPlanActiveCountResponseDto {
  @ApiProperty()
  activeCount!: number;

  @ApiProperty({ description: 'Active members paying by a running Stripe subscription: the ones a price change can migrate or grandfather (Decision 334).' })
  subscriberCount!: number;
}
