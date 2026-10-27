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
}
