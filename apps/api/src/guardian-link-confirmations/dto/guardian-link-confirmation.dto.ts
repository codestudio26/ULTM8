import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/** GET /schools/{schoolId}/guardian-links query (Decision 172). */
export class GuardianLinkListQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'confirmed'], description: 'Leave out for both.' })
  @IsOptional()
  @IsIn(['pending', 'confirmed'])
  status?: 'pending' | 'confirmed';
}

/** One Guardian–minor link, as School staff see it to decide whether to confirm. */
export class SchoolGuardianLinkResponseDto {
  @ApiProperty()
  linkId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty()
  studentSurname!: string;

  @ApiProperty()
  studentDateOfBirth!: string;

  @ApiProperty()
  guardianId!: string;

  @ApiProperty()
  guardianFirstName!: string;

  @ApiProperty()
  guardianSurname!: string;

  @ApiProperty({ description: "The Guardian's verified phone, so staff can contact them." })
  guardianPhone!: string;

  @ApiProperty()
  linkedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  confirmedById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The School that confirmed it (may be another School the minor attends).' })
  confirmedSchoolId!: string | null;
}

export class SchoolGuardianLinkListResponseDto {
  @ApiProperty({ type: [SchoolGuardianLinkResponseDto] })
  items!: SchoolGuardianLinkResponseDto[];
}

/** POST .../confirm and .../unconfirm response: the GuardianLink row. */
export class GuardianLinkResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  guardianId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  revokedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  confirmedById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  confirmedSchoolId!: string | null;
}

export class GuardianLinkConfirmerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  userId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  grantedById!: string | null;

  @ApiProperty()
  createdAt!: string;
}

/** A confirmer as the owner lists them, with the staff member's name. */
export class GuardianLinkConfirmerListItemDto extends GuardianLinkConfirmerResponseDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  userFirstName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  userSurname!: string | null;
}

export class GuardianLinkConfirmerListResponseDto {
  @ApiProperty({ type: [GuardianLinkConfirmerListItemDto] })
  items!: GuardianLinkConfirmerListItemDto[];
}
