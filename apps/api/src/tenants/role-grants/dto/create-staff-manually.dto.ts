import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';

/**
 * Staff "Add Manually" (Decision 251) — mirrors Decision 1/230/237's
 * Instructor "Add Manually" exactly, per the product owner's own direct
 * answer when this was re-asked: "Yes — same pattern as Instructor: real
 * User+RoleGrant created immediately, temp passcode emailed, forced change
 * on first login." A real User + RoleGrant created immediately from just a
 * name, email, and branch — no invite/acceptance step.
 *
 * "Staff" is BRANCH_STAFF in the Role enum, not a separate profile table
 * the way Instructor is its own table — so there is no third profile row
 * to create here (see RoleGrantsService.createStaffManually's own header
 * comment), only User + RoleGrant.
 *
 * Unlike CreateInstructorManuallyDto, `branchId` is REQUIRED outright, not
 * conditional on whether the School has branches. StaffPage.tsx's own
 * existing `needsBranch` logic already treats BRANCH_STAFF as always
 * needing a branch, and RoleGrantsService.create()'s own
 * `dto.role === 'BRANCH_STAFF' && !dto.branchId` 400 check already applies
 * that same always-required rule for an existing-user grant — this DTO just
 * makes that requirement a validation-layer guarantee instead of a
 * service-layer check, since there is no "School has no branches" escape
 * hatch for Branch Staff the way there is for Instructor.
 *
 * Everything else about the person (phone, dateOfBirth) is deliberately
 * NOT collected here, same as CreateInstructorManuallyDto — left blank and
 * filled in by the Staff member themselves after their first login.
 */
// Names are trimmed before validation, so one made only of spaces is refused
// (Decision 361), same as CreateInstructorManuallyDto.
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateStaffManuallyDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  surname!: string;

  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiProperty({
    description:
      'Required — Branch Staff always belongs to a specific Branch (unlike Instructor, which only needs one when the School itself has branches).',
  })
  @IsUUID()
  branchId!: string;
}
