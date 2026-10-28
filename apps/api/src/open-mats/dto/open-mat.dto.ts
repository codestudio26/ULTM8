import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

/** POST /schools/{schoolId}/open-mats (Decision 386, handover F10). */
export class StartOpenMatDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: "One of the School's open Branches; null when it has none." })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'The style. Required when the School has styles.' })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID()
  disciplineId?: string | null;

  @ApiProperty({ format: 'date-time', description: 'From 30 minutes ago to 24 hours ahead.' })
  @IsISO8601()
  startsAt!: string;

  @ApiPropertyOptional({ default: 60, minimum: 15, maximum: 480 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  minutes?: number;
}

export class OpenMatStartedDto {
  @ApiProperty()
  classId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true, type: String })
  branchId!: string | null;

  @ApiProperty({ format: 'date-time' })
  startDate!: string;

  @ApiProperty({ format: 'date-time' })
  endDate!: string;

  @ApiProperty({ description: 'How many students were told in the app.' })
  notified!: number;
}

/** GET /schools/{schoolId}/open-mats/me. */
export class MyOpenMatPermissionDto {
  @ApiProperty()
  canStart!: boolean;

  @ApiProperty({ type: [String], nullable: true, description: 'The Branches the caller can start one at; null for any.' })
  branchIds!: string[] | null;
}

export class OpenMatPermissionDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty({ type: [String], enum: ['BRANCH_STAFF', 'INSTRUCTOR'] })
  roles!: Array<'BRANCH_STAFF' | 'INSTRUCTOR'>;

  @ApiProperty()
  canStartOpenMat!: boolean;
}

export class OpenMatPermissionListDto {
  @ApiProperty({ type: [OpenMatPermissionDto] })
  items!: OpenMatPermissionDto[];
}

export class SetOpenMatPermissionDto {
  @ApiProperty()
  @IsBoolean()
  canStartOpenMat!: boolean;
}
