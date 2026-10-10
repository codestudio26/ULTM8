import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** A lesson category (Decisions 128.15, 191). */
export class LessonCategoryNameDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

/** Every category of the School, in the new order. */
export class OrderLessonCategoriesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  categoryIds!: string[];
}

/** Every lesson that should be in this category, in order. Lessons from other
 * categories (or none) move into it; every lesson already in it must be sent. */
export class OrderCategoryLessonsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  lessonIds!: string[];
}

export class LessonCategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  order!: number;
}

export class LessonCategoryListResponseDto {
  @ApiProperty({ type: [LessonCategoryResponseDto] })
  items!: LessonCategoryResponseDto[];
}
