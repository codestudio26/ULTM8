import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimSearch } from '../../../common/search/name-search';

/** A roster row's own resolved status — never ALL, which is only a request-side
 * filter value (StudentRosterStatusDto below), not a row status. Kept as its own
 * enum (rather than reusing StudentRosterStatusDto for the response too) so the
 * generated OpenAPI/TS type on StudentSummaryResponseDto.status can't include ALL,
 * a value that can never actually appear there. */
export enum StudentStatusDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/**
 * GET /schools/:id/students query — the School Portal's Students page Active/
 * Inactive/All filter. `findAllStudentsForSchool` previously hard-coded
 * `revokedAt: null`, silently excluding a revoked ("inactive") enrollment from the
 * roster with no way to ever see it (v1.2 backend backlog, "Students page", Active/
 * Inactive status gap).
 *
 * Active = the User holds at least one non-revoked STUDENT RoleGrant at this School.
 * Inactive = the User holds STUDENT RoleGrant(s) at this School, but every one of
 * them is revoked. Defaults to ACTIVE when omitted — the exact pre-existing
 * behavior — so an existing caller that never sends this param sees no change
 * (additive, not a behavior change).
 */
export enum StudentRosterStatusDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ALL = 'ALL',
}

export class StudentRosterQueryDto {
  @ApiPropertyOptional({ enum: StudentRosterStatusDto, description: 'Defaults to ACTIVE (the pre-existing behavior) when omitted.' })
  @IsOptional()
  @IsEnum(StudentRosterStatusDto)
  status?: StudentRosterStatusDto;

  /** Decision 278 — the header Global Search: case-insensitive substring match against
   * the Student's first name, surname, or full name "first surname". Trimmed; blank means no filter. Same length limit as ClassesQueryDto.search. */
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against first name, surname, or full name ("first surname").' })
  @IsOptional()
  @Transform(({ value }) => trimSearch(value))
  @IsString()
  @MaxLength(200)
  search?: string;
}
