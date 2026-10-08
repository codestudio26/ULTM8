import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Additive filters on top of the platform-wide cursor/limit shape (Decision 22) —
 * added for the Instructor Check-in flow (Track B Phase 5), which needs "Classes I
 * teach, happening today" rather than the full, randomly `id`-ordered School history
 * `findAllForSchool` otherwise returns. All three fields are optional and change
 * nothing for an existing caller that omits them: `findAllForSchool`'s own query
 * param binding is unaffected when `instructorId`/`startDateFrom`/`startDateTo` are
 * absent from the request.
 *
 * Filtering on `startDate`/`endDate` overlap (not the nullable `occurrenceDate`)
 * deliberately covers both TimetableSlot-materialized occurrences and independent
 * one-off Classes uniformly (Classes §9 — `occurrenceDate` is null for the latter).
 */
export class FindClassesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only Classes taught by this Instructor (a User holding an active INSTRUCTOR RoleGrant at this School).' })
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time — only Classes whose endDate is at or after this instant.' })
  @IsOptional()
  @IsDateString()
  startDateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time — only Classes whose startDate is at or before this instant.' })
  @IsOptional()
  @IsDateString()
  startDateTo?: string;
}
