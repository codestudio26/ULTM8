import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { LessonFormat } from '@prisma/client';

/**
 * All fields optional (undefined = unchanged) — same simpler convention as
 * UpdateSkillDto/UpdateDisciplineDto, not School/Branch/Class's null-means-clear
 * convention (Lesson is closer to that catalog/content family than to a profile
 * form with genuinely clearable fields).
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
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: LessonFormat })
  @IsOptional()
  @IsEnum(LessonFormat)
  format?: LessonFormat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  instructorId?: string;

  @ApiPropertyOptional({ type: [String], minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  skillIds?: string[];
}
