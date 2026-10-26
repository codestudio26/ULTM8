import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { UpdateUserDto } from '../../../users/dto/update-user.dto';
import { LANGUAGES } from '../../../settings/constants/languages';
import { CURRENCIES } from '../../../settings/constants/currencies';

/**
 * `PATCH /schools/{schoolId}/students/{studentId}/profile` — v1.2 backend backlog's
 * Student Detail "Edit" gap: a Staff member editing a Student's own profile on their
 * behalf (name, contact info, etc.), which `PATCH /users/me` obviously can't serve
 * since that's self-service only.
 *
 * Deliberately `extends UpdateUserDto`, not a hand-copied field list: the
 * self-service DTO already excludes `email`/`phone` as unique login/OTP
 * identifiers (see its own header comment) — the same reason Staff must not be able
 * to change either on a Student's behalf through this door, since doing so would let
 * Staff silently redirect a Student's login/OTP destination. Every other field
 * `UpdateUserDto` allows a Student to change about themselves is safe for Staff to
 * change on their behalf too. See the PR description for the full scoping call.
 *
 * Decision 324 (S8): staff pick `language` and `currency` from the lists the app
 * serves (GET /settings/languages, /settings/currencies) instead of typing them.
 * class-validator adds these checks to the inherited ones. Self-service keeps
 * accepting the stored free text for now, since its forms send the saved value
 * back on every save and older values may predate the lists.
 */
export class UpdateStudentProfileDto extends UpdateUserDto {
  @ApiPropertyOptional({ description: 'A code from GET /settings/languages. Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsIn(LANGUAGES.map((l) => l.code), { message: 'Choose a language from the list.' })
  language?: string | null;

  @ApiPropertyOptional({ description: 'A code from GET /settings/currencies. Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsIn(CURRENCIES.map((c) => c.code), { message: 'Choose a currency from the list.' })
  currency?: string | null;
}
