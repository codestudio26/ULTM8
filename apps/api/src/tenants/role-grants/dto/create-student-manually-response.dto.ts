import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The new student (Decision 366). `emailSent` is false when the temporary
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

  /** Only when the email could not be sent: the temporary passcode, shown to
   * the owner once so they can give it to the student in person. Nobody else
   * knows it, and the student must change it on first sign-in. Null otherwise. */
  @ApiPropertyOptional({ type: String, nullable: true })
  temporaryPasscode!: string | null;
}
