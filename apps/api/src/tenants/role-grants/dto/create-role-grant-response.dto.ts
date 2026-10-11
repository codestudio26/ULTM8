import { ApiProperty } from '@nestjs/swagger';
import { RoleGrantResponseDto } from './role-grant-response.dto';

/** `create()`'s own response — adds `emailSent`, same "tell the caller whether
 * the notification actually went out, don't fail the grant over it" shape
 * CoachInvitesService's own invite response already established. The grant
 * itself always succeeds if this response exists at all; `emailSent: false`
 * means only the notification side effect failed (logged server-side), not
 * the RoleGrant. */
export class CreateRoleGrantResponseDto extends RoleGrantResponseDto {
  @ApiProperty()
  emailSent!: boolean;
}
