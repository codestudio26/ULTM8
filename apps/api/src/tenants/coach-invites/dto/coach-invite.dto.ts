import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsUUID, MaxLength } from 'class-validator';

/** Invite one person, by email, to coach (Decision 183). */
export class CreateCoachInviteDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ description: 'Required when the School has branches; the branch they will coach at.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export const COACH_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'] as const;
export type CoachInviteStatus = (typeof COACH_INVITE_STATUSES)[number];

export class CoachInviteResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: COACH_INVITE_STATUSES })
  status!: CoachInviteStatus;

  @ApiProperty({ type: String, nullable: true })
  invitedById!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'First name and surname of who sent it.' })
  invitedByName!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  acceptedAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  cancelledAt!: Date | null;
}

export class CreatedCoachInviteResponseDto extends CoachInviteResponseDto {
  @ApiProperty({ description: 'False when the email could not be sent; cancel and invite again.' })
  emailSent!: boolean;
}

export class CoachInviteListResponseDto {
  @ApiProperty({ type: [CoachInviteResponseDto] })
  items!: CoachInviteResponseDto[];
}

/** What the invite page shows before the person signs in (token holder only). */
export class CoachInvitePreviewDto {
  @ApiProperty()
  schoolName!: string;

  @ApiProperty({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty({ description: 'The email the invite was sent to; sign in or sign up with it.' })
  email!: string;

  @ApiProperty({ enum: COACH_INVITE_STATUSES })
  status!: CoachInviteStatus;

  @ApiProperty()
  expiresAt!: Date;
}

export class AcceptCoachInviteResponseDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty({ description: 'A new access token that includes the coach role.' })
  accessToken!: string;
}

export class SetStaffPermissionDto {
  @ApiProperty()
  @IsBoolean()
  canInviteCoaches!: boolean;
}

export class StaffPermissionResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty({ type: [String], description: 'Branches where they are Branch Staff.' })
  branchIds!: string[];

  @ApiProperty()
  canInviteCoaches!: boolean;
}

export class StaffPermissionListResponseDto {
  @ApiProperty({ type: [StaffPermissionResponseDto] })
  items!: StaffPermissionResponseDto[];
}
