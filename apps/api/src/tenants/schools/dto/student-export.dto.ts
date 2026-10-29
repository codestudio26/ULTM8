import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { StudentStatusDto } from './student-roster-query.dto';

/** Backlog 3.9: which students an export holds (Decision 399). */
export enum StudentExportFilterDto {
  /** Current and former students. */
  ALL = 'ALL',
  /** Current students. */
  ACTIVE = 'ACTIVE',
  /** Current students who are members, not Visitors. */
  MEMBERS = 'MEMBERS',
  /** Current students who are Visitors. */
  VISITORS = 'VISITORS',
}

export class StudentExportQueryDto {
  @ApiPropertyOptional({ enum: StudentExportFilterDto, enumName: 'StudentExportFilter', description: 'Defaults to ACTIVE.' })
  @IsOptional()
  @IsEnum(StudentExportFilterDto)
  filter?: StudentExportFilterDto;
}

export class StudentExportBeltDto {
  @ApiProperty()
  style!: string;

  @ApiProperty({ description: 'The belt or stripe the student holds in that style.' })
  rank!: string;
}

export class StudentExportGuardianDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;
}

export class StudentExportRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty({ description: 'Empty for a child whose Guardian manages the account.' })
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'YYYY-MM-DD.' })
  dateOfBirth!: string | null;

  @ApiProperty({ enum: StudentStatusDto, enumName: 'StudentStatus' })
  status!: StudentStatusDto;

  @ApiProperty()
  enrolledAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  homeBranchName!: string | null;

  @ApiProperty()
  visitor!: boolean;

  @ApiProperty({ type: [String], description: "Memberships in effect now, by plan name." })
  memberships!: string[];

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'NONE'], description: 'ACTIVE with a membership in effect, EXPIRED when they only had earlier ones, NONE when they never had one.' })
  billingStatus!: 'ACTIVE' | 'EXPIRED' | 'NONE';

  @ApiProperty({ type: [StudentExportBeltDto] })
  belts!: StudentExportBeltDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Start of the last class they were checked in to.' })
  lastVisitAt!: string | null;

  @ApiProperty({ type: [StudentExportGuardianDto], description: "A child's Guardians." })
  guardians!: StudentExportGuardianDto[];
}

export class StudentExportResponseDto {
  @ApiProperty({ type: [StudentExportRowDto] })
  items!: StudentExportRowDto[];
}
