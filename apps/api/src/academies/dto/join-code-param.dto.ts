import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Decision 266 — `GET /public/schools/by-code/:code`. FOUND ON REVIEW: the
 * route previously took `code` as a bare, unvalidated string — unlike its
 * sibling `search` route (SchoolSearchQueryDto's own `@MaxLength`), this is
 * the first genuinely unauthenticated surface in the API with no input-size
 * guard at all. Validated against the exact shape `generate_school_join_code()`
 * / SchoolsService.JOIN_CODE_ALPHABET ever produces (8 characters, that one
 * 32-character unambiguous alphabet) — a code of any other shape can never
 * be a real one, so there's nothing lost in rejecting it before it ever
 * reaches Prisma. Case-insensitive: the controller still uppercases before
 * querying (mobile keyboards default to lowercase), this only bounds length
 * and character set, not case. */
export class JoinCodeParamDto {
  @ApiProperty({ description: '8-character School join code.' })
  @IsString()
  @Matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/i, { message: 'code must be an 8-character join code' })
  code!: string;
}
