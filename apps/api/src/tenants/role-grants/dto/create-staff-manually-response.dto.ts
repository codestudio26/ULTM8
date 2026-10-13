import { ApiProperty } from '@nestjs/swagger';
import { RoleGrantResponseDto } from './role-grant-response.dto';

/**
 * Decision 251 — same `emailSent` non-blocking-failure shape
 * InstructorsService.createManually()/RoleGrantsService.create() already
 * established: creation always succeeds once validation passes; only the
 * temp-passcode email can fail independently of it.
 *
 * Extends RoleGrantResponseDto rather than mirroring
 * CreateInstructorManuallyResponseDto's Instructor-profile shape
 * (firstName/surname/status), because Staff has no profile table of its
 * own — the RoleGrant row this endpoint creates IS the Staff record. This
 * also matches what StaffPage.tsx's existing "look up a user's grants"
 * table already renders (RoleGrantResponseDto's userFirstName/userSurname,
 * joined from the User relation — see RoleGrantsService.findAllForUser).
 * `email` is added on top since the frontend's success banner needs it
 * (RoleGrantResponseDto doesn't carry it, since every other consumer of
 * that shape already knows the target's email from its own invite-candidate
 * lookup step).
 */
export class CreateStaffManuallyResponseDto extends RoleGrantResponseDto {
  @ApiProperty()
  email!: string;

  @ApiProperty({ description: 'False if the temp-passcode email could not be sent — the Staff account was still created.' })
  emailSent!: boolean;
}
