import { ApiProperty } from '@nestjs/swagger';

/** Decision 315 item 10: a student's medical information, for the owner and
 * staff the owner switched on. */
export class StudentMedicalInfoDto {
  @ApiProperty({ description: 'As the member (or their Guardian) wrote it, up to 2,000 characters.' })
  body!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Who gave consent; null once that account is gone.' })
  consentedByName!: string | null;

  @ApiProperty({ description: 'True when a Guardian consented for their child.' })
  consentedByGuardian!: boolean;

  @ApiProperty()
  consentedAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class StudentMedicalInfoResponseDto {
  @ApiProperty({ type: StudentMedicalInfoDto, nullable: true, description: 'Null when none was given.' })
  medicalInfo!: StudentMedicalInfoDto | null;
}

/** Decision 419 item 1: one School that holds medical information about the
 * member. Never the text. */
export class MedicalInfoSharedDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiProperty({ description: 'When consent was given.' })
  consentedAt!: string;

  @ApiProperty({ description: 'True when a Guardian consented for their child.' })
  consentedByGuardian!: boolean;

  @ApiProperty({ description: 'Given on a front-desk sign-up whose invite the member has not accepted yet.' })
  awaitingAcceptance!: boolean;
}

export class MedicalInfoSharedListDto {
  @ApiProperty({ type: [MedicalInfoSharedDto] })
  items!: MedicalInfoSharedDto[];
}
