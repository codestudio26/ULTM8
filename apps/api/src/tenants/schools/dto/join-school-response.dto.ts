import { ApiPropertyOptional } from '@nestjs/swagger';
import { RoleGrantResponseDto } from '../../role-grants/dto/role-grant-response.dto';

/**
 * Response for `POST /schools/:id/join` — the new STUDENT RoleGrant, plus
 * (for the ordinary self-service path) a freshly-minted access token
 * reflecting it. Same "narrow, approved exception" to "JWTs only rebuild at
 * login" that SchoolResponseDto's own `accessToken` field already uses for
 * self-service School creation (ultm8-nestjs-module §7) — the caller's own
 * action just changed their own grants, so there's a genuine response to
 * hand a fresh token back through, unlike the RoleGrantsService invite-flow
 * case (Decision 80/81), which grants someone ELSE and has no such response
 * to piggyback on.
 *
 * `accessToken` was made REQUIRED here (not optional like SchoolResponseDto's
 * own copy of this field) when join() had exactly one code path, which always
 * awaited `issueAccessToken()`. Phase 38 added a genuinely second path —
 * Guardian-on-behalf-of enrollment (JoinSchoolDto's own comment) — with no
 * token to return: a Guardian-managed minor's account is permanently blocked
 * from independent login (GuardiansService.createMinor()'s own comment), so
 * there is nothing such a token would ever be used for. Reverted back to
 * optional here to model that honestly, rather than returning a token that
 * would be actively misleading (e.g. the Guardian's own, unchanged one).
 * v1.2 backend backlog's Staff-on-behalf-of case (SchoolsService.join()'s own
 * comment) is the same shape: the caller is Staff, not the person who just
 * got enrolled, so there's equally nothing of the caller's own to refresh.
 */
export class JoinSchoolResponseDto extends RoleGrantResponseDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Present for an ordinary self-service join; absent when someone else is doing the enrolling — a Guardian enrolling a linked minor, or Staff enrolling an existing person (see this DTO\'s own header comment).',
  })
  accessToken?: string;
}
