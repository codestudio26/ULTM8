import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Curriculum learner-facing redesign (Decision 227/254) — a Comment on a
 * Lesson. No edit DTO — Comment has no UPDATE grant at all (see Comment's
 * own schema.prisma/migration comment): it can only be created or deleted.
 */
export class CreateCommentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  body!: string;
}

/** `authorName` is resolved via PrismaAuthService/resolveUserNames (same
 * pattern InstructorsService already established), not an RLS-scoped join —
 * see resolveUserNames's own header comment for why. */
export class CommentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  lessonId!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty()
  authorName!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  createdAt!: string;
}

export class CommentListResponseDto {
  @ApiProperty({ type: [CommentResponseDto] })
  items!: CommentResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Opaque cursor for the next page, ordered (createdAt, id) ASC (oldest first); null when there is no more.' })
  nextCursor!: string | null;
}
