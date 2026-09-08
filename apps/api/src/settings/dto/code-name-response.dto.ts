import { ApiProperty } from '@nestjs/swagger';

/**
 * Shared response shape for both `GET /settings/languages` and
 * `GET /settings/currencies` — consolidated on code review from two DTO classes
 * with an identical `{code, name}` shape defined separately (only their
 * `@ApiProperty` description text differed). Each endpoint's own doc comment in
 * `SettingsController` carries the type-specific note (BCP-47 vs. ISO 4217)
 * instead of a per-field description here.
 */
export class CodeNameResponseDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}
