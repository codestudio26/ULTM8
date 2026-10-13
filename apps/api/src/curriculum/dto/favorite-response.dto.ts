import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Curriculum learner-facing redesign (Decision 227/254) — a Student's own
 * saved Lesson, self-only RLS (Favorite's own schema.prisma/migration
 * comment). Dates are ISO strings, same convention as LessonResponseDto.
 */
export class FavoriteResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  lessonId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  createdAt!: string;
}

export class FavoriteListResponseDto {
  @ApiProperty({ type: [FavoriteResponseDto] })
  items!: FavoriteResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Opaque cursor for the next page, ordered (createdAt, id) DESC; null when there is no more.' })
  nextCursor!: string | null;
}
