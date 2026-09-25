import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsPhoneNumber } from 'class-validator';

/** Exact match only, email or phone — never a name search (Decision 116). At least one
 * of the two is required; enforced in RoleGrantsService.lookupInviteCandidate (same
 * convention as CreateRoleGrantDto's branchId/BRANCH_STAFF cross-field check), since
 * class-validator has no direct decorator for "at least one of these two fields". */
export class LookupInviteCandidateQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'E.164 format' })
  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone?: string;
}
