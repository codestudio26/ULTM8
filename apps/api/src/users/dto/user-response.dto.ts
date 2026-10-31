import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostalAddressColumnsResponseDto } from '../../common/address/postal-address.dto';

/**
 * Response shape — see class-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`). Field-for-field
 * match of the User Prisma model, MINUS `passcodeHash` — a bcrypt hash of the login
 * credential, never serialized into any response regardless of who's asking.
 *
 * `email`/`phone`/`phoneVerifiedAt` are included as read-only status info even though
 * `UpdateUserDto` can't change the first two — GET /users/me is the caller's own full
 * profile, not just the PATCH-able subset.
 */
export class UserResponseDto extends PostalAddressColumnsResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  phone!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Set once Twilio Verify OTP confirms this phone; null if not yet verified.' })
  phoneVerifiedAt!: string | null;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  username!: string | null;

  @ApiProperty()
  dateOfBirth!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  gender!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  nationality!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  language!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  profilePhotoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Free text — no confirmed enum/unit (Decision 220/246).' })
  weightCategory!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Free text — no confirmed enum/unit (Decision 220/246).' })
  kimonoSize!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Free text — no confirmed enum/unit (Decision 220/246).' })
  beltSize!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 315 item 5. Not a login.' })
  secondaryPhone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 315 item 5. Not a login.' })
  secondaryEmail!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 315 item 5: not a Guardian, no account.' })
  emergencyContactName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  emergencyContactPhone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  emergencyContactRelationship!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
