import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** A parent acting for their child (Decision 435 item 14); omit for yourself. */
export class PlanWaitlistMemberDto {
  @ApiPropertyOptional({ description: 'A parent: the child this is for. Omit for yourself.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

/** The member's own place on a plan's waiting list. */
export class PlanWaitlistPlaceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['WAITING', 'OFFERED'], description: 'OFFERED: a place is held for them until offerExpiresAt (24 hours); they can buy the plan now.' })
  status!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Their place in line while WAITING (1 = next); null once offered.' })
  position!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Until when the place is held for them.' })
  offerExpiresAt!: string | null;
}

export class PlanAvailabilityItemDto {
  @ApiProperty()
  planId!: string;

  @ApiProperty({ description: 'The plan is full for this member: they can join its waiting list but not buy it.' })
  full!: boolean;

  @ApiPropertyOptional({ type: () => PlanWaitlistPlaceDto, nullable: true })
  waitlist!: PlanWaitlistPlaceDto | null;
}

/** GET /schools/{schoolId}/plan-availability — the School's plans with a member limit. */
export class PlanAvailabilityResponseDto {
  @ApiProperty({ type: [PlanAvailabilityItemDto] })
  items!: PlanAvailabilityItemDto[];
}

export class PlanWaitlistLeaveResponseDto {
  @ApiProperty()
  left!: boolean;
}

export class PlanWaitlistOwnerEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty({ enum: ['WAITING', 'OFFERED'] })
  status!: string;

  @ApiProperty()
  joinedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  offerExpiresAt!: string | null;
}

/** GET /membership-plans/{id}/waitlist — the owner's view of a plan's line. */
export class PlanWaitlistOwnerResponseDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  memberLimit!: number | null;

  @ApiProperty({ description: 'Places taken now: live and frozen members, waiting Cash/Bank payments and places held, each person once.' })
  placesTaken!: number;

  @ApiProperty({ type: [PlanWaitlistOwnerEntryDto], description: 'Waiting and offered, first in line first.' })
  items!: PlanWaitlistOwnerEntryDto[];
}
