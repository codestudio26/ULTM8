import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /schools/{id}/join body (Phase 38 — this route had no body at all
 * before now). `studentId` is the same on-behalf-of shape SignWaiverDto
 * (WaiversModule, Phase 37) already established: omitted/equal-to-caller
 * means an ordinary self-service join; naming a different id means an
 * on-behalf-of enroll instead. SchoolsService.join() tries a Guardian's
 * active GuardianLink first, falling back to School Owner/Manager (v1.2
 * backend backlog's "Invite a Student" enroll step) — see that method's own
 * header comment for the full authority resolution and why Instructor is
 * deliberately excluded.
 *
 * Decision 96's own "What this does NOT resolve" section named the Guardian
 * half of this gap explicitly ("how a Guardian enrolls a linked minor at a
 * School... a genuinely separate cross-user-write question... not solved
 * here") — Phase 38 closed that, following the same engineering-judgment
 * reasoning Phase 37 already used for Guardian-on-behalf-of waiver signing:
 * SKILL.md §14 ([CONFIRMED]) already states a Guardian has "full access
 * to... bookings, and memberships for each linked minor" — enrollment is the
 * load-bearing precondition those confirmed capabilities need to mean
 * anything, not a new business rule being invented here. The Staff half
 * (enrolling an existing, already-registered User the Invite flow's own
 * lookup already found) is a small, precedented extension of the same
 * on-behalf-of shape, not a second mechanism.
 */
export class JoinSchoolDto {
  @ApiPropertyOptional({
    description:
      'Enroll this existing Student at the School instead of the caller — either a Guardian enrolling a linked minor, or a School Owner/Manager enrolling an existing User (never a brand-new account).',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({
    description: 'The student\'s home branch (Decisions 139, 168). Required when the School has branches; must be one of them. Not allowed when the School has none.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
