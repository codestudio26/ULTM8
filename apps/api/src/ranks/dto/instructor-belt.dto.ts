import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** The instructor's own choice: a belt of the style and one of its stripes. */
export class DeclareInstructorBeltDto {
  @ApiProperty()
  @IsUUID()
  rankId!: string;

  @ApiProperty()
  @IsUUID()
  stripeTierId!: string;
}

/** The owner verifies the belt as chosen, or sends both ids to correct it. */
export class VerifyInstructorBeltDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rankId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stripeTierId?: string;
}

export class InstructorBeltResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  disciplineName!: string;

  @ApiProperty()
  rankId!: string;

  @ApiProperty()
  stripeTierId!: string;

  @ApiProperty({ description: 'The name of the belt and stripe, as the School typed it.' })
  beltName!: string;

  @ApiProperty({ enum: ['UNVERIFIED', 'VERIFIED'] })
  verificationStatus!: 'UNVERIFIED' | 'VERIFIED';

  @ApiProperty()
  declaredAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  verifiedAt!: Date | null;
}

export class InstructorBeltListResponseDto {
  @ApiProperty({ type: [InstructorBeltResponseDto] })
  items!: InstructorBeltResponseDto[];
}

export class SchoolInstructorDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;
}

/** The owner's view: every instructor's belts, and every active instructor. */
export class SchoolInstructorBeltsResponseDto extends InstructorBeltListResponseDto {
  @ApiProperty({ type: [SchoolInstructorDto] })
  instructors!: SchoolInstructorDto[];
}
