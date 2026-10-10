import { PartialType } from '@nestjs/swagger';
import { CreateTranslationDto } from './create-translation.dto';

/** PATCH /platform-admin/translations/:id body — every field optional, same
 * partial-update shape every other Update DTO in this codebase uses. Unlike
 * UpdateFranchiseDto, no field here needs an explicit-null "clear" case — `content`
 * is required (a Translation row with empty content is meaningless, see
 * CreateTranslationDto's own `@MinLength(1)`), and `screen`/`labelKey`/`locale`
 * together are the row's own identity, not an optional descriptive field a caller
 * would ever want to blank out. A caller changing any of the three still goes
 * through the same unique-index check as create() (see TranslationsService.update()'s
 * own comment). */
export class UpdateTranslationDto extends PartialType(CreateTranslationDto) {}
