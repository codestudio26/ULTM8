import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /platform-admin/translations body. `(screen, labelKey, locale)` together are
 * the natural key (enforced as a unique index in the migration, not just here) — a
 * duplicate triple is a 409, not a silent overwrite (see TranslationsService.create()'s
 * own comment).
 *
 * `locale` is free text, not validated against `settings/constants/languages.ts`'s
 * `LANGUAGES` list — same reasoning `UpdateFranchiseDto.defaultLanguage`'s own comment
 * already gives: no canonical language code list is confirmed anywhere yet
 * (domain-rules §1), so this doesn't invent a stricter constraint than the spec
 * itself confirms. */
export class CreateTranslationDto {
  @ApiProperty({ description: 'The app screen this label belongs to (e.g. "login", "academyDetail").' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  screen!: string;

  @ApiProperty({ description: 'The label key within that screen (e.g. "welcomeMessage").' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  labelKey!: string;

  @ApiProperty({ description: 'Free text — no canonical language code list is confirmed yet (domain-rules §1).' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  locale!: string;

  @ApiProperty({ description: 'The translated text for this screen/labelKey/locale.' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;
}
