import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response DTO — field-for-field match of the Translation Prisma model. No field is
 * excluded (unlike AdminUserResponseDto's own ssoSubject exclusion) — every column on
 * this table is meant to be publicly readable (see TranslationsController's own
 * header comment for why the GET endpoint itself carries no guard at all). */
export class TranslationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  screen!: string;

  @ApiProperty()
  labelKey!: string;

  @ApiProperty()
  locale!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class TranslationListResponseDto {
  @ApiProperty({ type: [TranslationResponseDto] })
  items!: TranslationResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
