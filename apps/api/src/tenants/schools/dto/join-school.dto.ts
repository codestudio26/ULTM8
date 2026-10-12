import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /schools/{id}/join body (Phase 38 — this route had no body at all
 * before now). `studentId` is the same on-behalf-of shape SignWaiverDto
 * (WaiversModule, Phase 37) already established: omitted/equal-to-caller
 * means an ordinary self-service join; naming a different id means someone
 * else is enrolling them instead. SchoolsService.join() works out WHICH
 * someone-else case this is (Guardian enrolling a linked minor, or — v1.2
 * backend backlog, "Invite a Student" — School Owner/Manager enrolling an
 * already-registered-but-unenrolled person at their own School) by trying
 * each caller relationship in turn; see that method's own header comment.
 *
 * Decision 96's own "What this does NOT resolve" section named the Guardian
 * gap explicitly ("how a Guardian enrolls a linked minor at a School...
 * a genuinely separate cross-user-write question... not solved here") —
 * Phase 38 closed it, following the same engineering-judgment reasoning
 * Phase 37 already used for Guardian-on-behalf-of waiver signing: SKILL.md
 * §14 ([CONFIRMED]) already states a Guardian has "full access to...
 * bookings, and memberships for each linked minor" — enrollment is the
 * load-bearing precondition those confirmed capabilities need to mean
 * anything, not a new business rule being invented here. The Staff case
 * reuses this exact field rather than adding a second one, since the two
 * are mutually exclusive by construction (a caller is never both the named
 * Student's Guardian and School Staff enrolling them) and the backend can
 * tell them apart itself without the frontend declaring which it means.
 */
export class JoinSchoolDto {
  @ApiPropertyOptional({
    description:
      'Enroll this person at the School instead of the caller — a Guardian enrolling a linked minor, or School Owner/Manager staff enrolling an already-registered person who found via the invite-candidate lookup (schools/:id/role-grants/invite-candidate).',
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
