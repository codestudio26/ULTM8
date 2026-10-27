import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { LessonFormat } from '@prisma/client';

/**
 * All fields optional (undefined = unchanged). `durationSeconds`,
 * `description` and `instructorId` also take null to clear them — the edit
 * form needs that, or emptying one of them silently kept the old value (C1).
 *
 * `skillIds`, when provided, REPLACES the full set (same REPLACE semantics as
 * UpdateRankDto's own requiredSkillIds) — still requires at least one, same
 * reasoning as CreateLessonDto.
 *
 * Same caption/video exclusion as CreateLessonDto — those fields aren't
 * client-writable until a real captioning/video pipeline exists.
 */
export class UpdateLessonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Move it to another of this School\'s categories (to the end), or null for none.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null clears it.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ enum: LessonFormat })
  @IsOptional()
  @IsEnum(LessonFormat)
  format?: LessonFormat;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null: no instructor.' })
  @IsOptional()
  @IsUUID('4')
  instructorId?: string | null;

  @ApiPropertyOptional({ type: [String], minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  skillIds?: string[];

  @ApiPropertyOptional({ description: 'Watchable by every student and guardian at the School, membership or not (Decision 190). School owner only.' })
  @IsOptional()
  @IsBoolean()
  free?: boolean;
}
