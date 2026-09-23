import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /schools/{id}/join body (Phase 38 — this route had no body at all
 * before now). `studentId` is the same on-behalf-of shape SignWaiverDto
 * (WaiversModule, Phase 37) already established: omitted/equal-to-caller
 * means an ordinary self-service join; naming a different id means a
 * Guardian enrolling a linked minor instead. SchoolsService.join() asserts
 * an active GuardianLink before honoring it.
 *
 * Decision 96's own "What this does NOT resolve" section named this exact
 * gap explicitly ("how a Guardian enrolls a linked minor at a School...
 * a genuinely separate cross-user-write question... not solved here") —
 * this closes it, following the same engineering-judgment reasoning Phase
 * 37 already used for Guardian-on-behalf-of waiver signing: SKILL.md §14
 * ([CONFIRMED]) already states a Guardian has "full access to... bookings,
 * and memberships for each linked minor" — enrollment is the load-bearing
 * precondition those confirmed capabilities need to mean anything, not a
 * new business rule being invented here.
 */
export class JoinSchoolDto {
  @ApiPropertyOptional({ description: 'Guardian-only: enroll this linked minor Student at the School instead of the caller.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
