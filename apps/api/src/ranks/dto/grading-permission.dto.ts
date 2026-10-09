import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** PUT /schools/{schoolId}/grading-permissions/{userId}: the full list of
 * disciplines this staff member may grade in. Replaces their current list;
 * an empty list removes all of it (Decision 138). */
export class SetGradingPermissionsDto {
  @ApiProperty({ type: [String], description: 'Disciplines (styles) this staff member may grade in. Replaces the current list.' })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  disciplineIds!: string[];
}

export class GradingPermissionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty({ type: String, nullable: true })
  grantedById!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class GradingPermissionListResponseDto {
  @ApiProperty({ type: [GradingPermissionResponseDto] })
  items!: GradingPermissionResponseDto[];
}
