import { ApiProperty } from '@nestjs/swagger';

/** A Guardian linked to a student, by name only (Decision 371, Students Q4). */
export class StudentGuardianDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;
}

export class StudentGuardiansResponseDto {
  @ApiProperty({ type: [StudentGuardianDto] })
  items!: StudentGuardianDto[];

  @ApiProperty({
    enum: ['NOT_NEEDED', 'GIVEN', 'GRANDFATHERED', 'WITHDRAWN', 'PENDING'],
    description: "Decision 429 item 9: the child's BASELINE consent. PENDING and WITHDRAWN: no booking or check-in until a parent gives it in the app.",
  })
  consent!: 'NOT_NEEDED' | 'GIVEN' | 'GRANDFATHERED' | 'WITHDRAWN' | 'PENDING';
}
