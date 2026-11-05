import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * The languages a post can be translated into: the School Portal's languages
 * other than English (packages/i18n SUPPORTED_LOCALES, checked by
 * whats-new-locales.spec.ts). English is the post itself.
 */
export const PRODUCT_UPDATE_LOCALES = ['pt-BR', 'es', 'ar', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'ja', 'ko', 'zh-CN', 'th'] as const;
/** What the portal may ask for: English or any translation language. */
export const READER_LOCALES = ['en-GB', ...PRODUCT_UPDATE_LOCALES] as const;

export const TITLE_MAX = 200;
export const BODY_MAX = 5000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ProductUpdateTranslationDto {
  @ApiProperty({ enum: PRODUCT_UPDATE_LOCALES })
  @IsIn(PRODUCT_UPDATE_LOCALES)
  locale!: string;

  @ApiProperty({ maxLength: TITLE_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  title!: string;

  @ApiProperty({ maxLength: BODY_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  body!: string;
}

/** Platform Admin writes a post: English, plus any translations. */
export class WriteProductUpdateDto {
  @ApiProperty({ maxLength: TITLE_MAX, description: 'English title.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  title!: string;

  @ApiProperty({ maxLength: BODY_MAX, description: 'English text (plain text; line breaks kept).' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  body!: string;

  @ApiPropertyOptional({ type: [ProductUpdateTranslationDto], description: 'Translations, at most one per language. On an edit, the list replaces the old one.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_UPDATE_LOCALES.length)
  @ValidateNested({ each: true })
  @Type(() => ProductUpdateTranslationDto)
  translations?: ProductUpdateTranslationDto[];
}

/** A post as Platform Admin sees it: English and every translation. */
export class ProductUpdateAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: [ProductUpdateTranslationDto] })
  translations!: ProductUpdateTranslationDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class ProductUpdateAdminListDto {
  @ApiProperty({ type: [ProductUpdateAdminDto] })
  items!: ProductUpdateAdminDto[];
}

/** A post as an owner or staff member reads it, in one language. */
export class WhatsNewItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ description: 'The language shown: the one asked for, or en-GB when the post has no translation in it.' })
  locale!: string;

  @ApiProperty({ format: 'date-time', description: 'When HQ posted it.' })
  createdAt!: Date;
}

export class WhatsNewListDto {
  @ApiProperty({ type: [WhatsNewItemDto] })
  items!: WhatsNewItemDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for older posts, or null.' })
  nextCursor!: string | null;
}

export class WhatsNewQueryDto {
  @ApiPropertyOptional({ enum: READER_LOCALES, description: 'The reader\'s language. English when missing or when a post has no translation in it.' })
  @IsOptional()
  @IsIn(READER_LOCALES)
  locale?: string;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
