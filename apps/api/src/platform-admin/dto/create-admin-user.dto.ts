import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { AdminSubRole } from '@prisma/client';

/**
 * Request body for POST /platform-admin/admin-users. Mirrors
 * scripts/bootstrap-admin-user.ts's own shape exactly — this endpoint is that
 * script's real, authenticated, FULL_ADMIN-only successor for every admin AFTER
 * the very first one (see that script's own header comment on why it stays a
 * one-time bootstrap exception, not the standing way new admins get added).
 *
 * `ssoSubject` — Cognito's own `sub` claim for the account being invited. Same
 * limitation the bootstrap script already has, not a new one introduced here:
 * this does NOT verify the value against a real Cognito user (that would need
 * the AWS SDK's Cognito Identity Provider admin API, a new dependency this slice
 * doesn't add) — identity (creating the Cognito user) and authorization
 * (this record) are two separate steps a FULL_ADMIN performs in order, the same
 * design the bootstrap script's own header comment already documents.
 */
export class CreateAdminUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1) // matches RegisterDto's own convention for this kind of field
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: AdminSubRole })
  @IsEnum(AdminSubRole)
  subRole!: AdminSubRole;

  @ApiProperty({ description: "Cognito's own `sub` claim for the account being invited — see this DTO's own header comment." })
  @IsString()
  @MinLength(1)
  @MaxLength(255) // generous bound for an external IdP subject identifier; not itself spec-confirmed
  ssoSubject!: string;
}
