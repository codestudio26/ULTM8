import { ApiProperty } from '@nestjs/swagger';
import { InstructorResponseDto } from './instructor-response.dto';

/** Decision 1/230 — same `emailSent` non-blocking-failure shape
 * CoachInvitesService.create() already established: creation always
 * succeeds once validation passes; only the temp-passcode email can fail
 * independently of it. */
export class CreateInstructorManuallyResponseDto extends InstructorResponseDto {
  @ApiProperty({ description: 'False if the temp-passcode email could not be sent — the Instructor profile was still created.' })
  emailSent!: boolean;
}
