import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Curriculum learner-facing redesign (Decision 227/254) — a Student-curated,
 * named, ordered list of Lessons (Playlist's own schema.prisma comment).
 * Deliberately no schoolId anywhere here — a Playlist may mix Lessons from
 * any School the Student is enrolled at.
 */
export class CreatePlaylistDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;
}

export class RenamePlaylistDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;
}

export class AddPlaylistItemDto {
  @ApiProperty()
  @IsUUID('4')
  lessonId!: string;
}

/** Reorders PlaylistItem rows by their OWN id (not lessonId) — every item
 * currently in the Playlist must be sent exactly once, same "send the full
 * set, in the new order" validation shape as OrderCategoryLessonsDto/
 * CurriculumService.orderCategoryLessons. */
export class ReorderPlaylistItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemIds!: string[];
}

export class PlaylistResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class PlaylistListResponseDto {
  @ApiProperty({ type: [PlaylistResponseDto] })
  items!: PlaylistResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Opaque cursor for the next page, ordered (createdAt, id) DESC; null when there is no more.' })
  nextCursor!: string | null;
}

/** `lessonTitle`/`locked` are joined in from the item's own Lesson — see
 * CurriculumService.findPlaylistItems's own header comment for how `locked`
 * is computed per item across a Playlist that may span several Schools. */
export class PlaylistItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  playlistId!: string;

  @ApiProperty()
  lessonId!: string;

  @ApiProperty()
  order!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  lessonTitle!: string;

  @ApiProperty({ description: 'The caller may not watch this Lesson (Decisions 154, 190, 195).' })
  locked!: boolean;
}

/** NOT paginated — a Playlist's own item count is bounded by how many
 * Lessons a School even has, same "small bounded list, flat array" reasoning
 * as LessonListResponseDto itself. */
export class PlaylistItemListResponseDto {
  @ApiProperty({ type: [PlaylistItemResponseDto] })
  items!: PlaylistItemResponseDto[];
}
