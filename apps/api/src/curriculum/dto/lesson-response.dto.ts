import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LessonFormat, CaptionStatus } from '@prisma/client';

export class LessonResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  instructorId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  category!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  durationSeconds!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: LessonFormat })
  format!: LessonFormat;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Vendor-agnostic pointer (Decision 101: Cloudflare Stream) — null until the video-hosting pipeline exists.' })
  videoRef!: string | null;

  @ApiProperty({ enum: CaptionStatus })
  captionStatus!: CaptionStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  captionTrackRef!: string | null;

  @ApiProperty({ type: [String] })
  skillIds!: string[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class LessonListResponseDto {
  @ApiProperty({ type: [LessonResponseDto] })
  items!: LessonResponseDto[];
}
