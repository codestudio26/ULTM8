import { ApiProperty } from '@nestjs/swagger';
import { RoleGrantResponseDto } from '../../role-grants/dto/role-grant-response.dto';

/**
 * Response for `POST /schools/:id/join` — the new STUDENT RoleGrant, plus a
 * freshly-minted access token reflecting it. Same "narrow, approved
 * exception" to "JWTs only rebuild at login" that SchoolResponseDto's own
 * `accessToken` field already uses for self-service School creation
 * (ultm8-nestjs-module §7) — this is the second, equally narrow case: the
 * caller's own action just changed their own grants, so there's a genuine
 * response to hand a fresh token back through, unlike the RoleGrantsService
 * invite-flow case (Decision 80/81), which grants someone ELSE and has no
 * such response to piggyback on.
 *
 * `accessToken` is REQUIRED here, not optional like SchoolResponseDto's own
 * copy of this field — found on review to be a real (if minor) inaccuracy:
 * SchoolResponseDto is shared across GET/PATCH/POST, most of which never set
 * it, so optional is correct there; this DTO is used only by `join()`, whose
 * only success path always awaits `issueAccessToken()` and includes it.
 */
export class JoinSchoolResponseDto extends RoleGrantResponseDto {
  @ApiProperty({ type: String })
  accessToken!: string;
}
