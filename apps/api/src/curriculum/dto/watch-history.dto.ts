import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Curriculum learner-facing redesign (Decision 227/254) — a video player's
 * progress ping. `completed` is one-directional: sending it true sets
 * WatchHistory.completedAt; omitting it (or sending false) never clears an
 * already-set completedAt — there is no "mark incomplete" feature
 * (CurriculumService.upsertWatchProgress's own header comment).
 */
export class UpsertWatchProgressDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  lastPositionSeconds!: number;

  @ApiPropertyOptional({ description: 'Set true once playback reaches the end. Never used to clear a prior completion.' })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class WatchHistoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  lessonId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  lastPositionSeconds!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  completedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class WatchHistoryListResponseDto {
  @ApiProperty({ type: [WatchHistoryResponseDto] })
  items!: WatchHistoryResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Opaque cursor for the next page, ordered (updatedAt, id) DESC; null when there is no more.' })
  nextCursor!: string | null;
}
