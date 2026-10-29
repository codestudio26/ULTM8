import { ApiProperty } from '@nestjs/swagger';

/** The new student (Decision 371). `emailSent` is false when the temporary
 * passcode email could not be sent: the account and enrolment still exist. */
export class CreateStudentManuallyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  emailSent!: boolean;

  /** The temporary passcode, shown to the owner once so they can give it to
   * the student in person (Decision 403). It is stored only as a hash, and the
   * student must change it on first sign-in. */
  @ApiProperty()
  temporaryPasscode!: string;

  @ApiProperty({ description: 'When the temporary passcode stops working if it has not been used (7 days).' })
  temporaryPasscodeExpiresAt!: string;
}
