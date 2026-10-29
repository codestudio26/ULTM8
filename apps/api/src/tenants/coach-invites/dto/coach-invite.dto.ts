import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';

/** Invite one person, by email, to coach (Decision 183). */
export class CreateCoachInviteDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ description: 'Required when the School has branches; the branch they will coach at.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    enum: ['INSTRUCTOR', 'BRANCH_STAFF'],
    description: 'Decision 396: BRANCH_STAFF invites are the School owner\'s only and need branchId. Defaults to INSTRUCTOR.',
  })
  @IsOptional()
  @IsIn(['INSTRUCTOR', 'BRANCH_STAFF'])
  role?: InviteRole;
}

export const INVITE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

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

  @ApiProperty({ enum: INVITE_ROLES, description: 'The role accepting gives (Decision 396).' })
  role!: InviteRole;

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

  @ApiProperty({ enum: INVITE_ROLES, description: 'The role accepting gives (Decision 396).' })
  role!: InviteRole;

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

  @ApiProperty({ enum: INVITE_ROLES, description: 'The role this gave (Decision 396).' })
  role!: InviteRole;

  @ApiProperty({ description: 'A new access token that includes the new role.' })
  accessToken!: string;
}

/** Either switch, or both; one left out keeps its value (Decision 383). */
export class SetStaffPermissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canInviteCoaches?: boolean;

  @ApiPropertyOptional({ description: 'May edit the School\'s styles, belts and skills (Decision 383).' })
  @IsOptional()
  @IsBoolean()
  canManageDisciplines?: boolean;
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

  @ApiProperty()
  canManageDisciplines!: boolean;
}

/** The caller's own "Can invite coaches" at a School (Decision 184): the
 * owner may invite to any branch; Branch Staff with the permission to their
 * own branches. */
export class MyStaffPermissionResponseDto {
  @ApiProperty()
  isOwner!: boolean;

  @ApiProperty()
  canInviteCoaches!: boolean;

  @ApiProperty({ description: 'May edit the School\'s styles, belts and skills: the owner, or Branch Staff with the switch (Decision 383).' })
  canManageDisciplines!: boolean;

  @ApiProperty({ type: [String], description: 'Branches they may invite to; empty for the owner (any branch) or when they can\'t invite.' })
  branchIds!: string[];
}

export class StaffPermissionListResponseDto {
  @ApiProperty({ type: [StaffPermissionResponseDto] })
  items!: StaffPermissionResponseDto[];
}
