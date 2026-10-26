import { ApiProperty } from '@nestjs/swagger';

/**
 * Curriculum learner-facing redesign (Decision 227/254) — the pair
 * CloudflareStreamService.createDirectUploadUrl() returns, passed straight
 * through: `uploadUrl` is a one-time direct-creator-upload URL the caller
 * PUTs the raw video file to; `videoRef` is Cloudflare Stream's video UID,
 * already stored on LessonContent by the time this response goes out.
 */
export class VideoUploadUrlResponseDto {
  @ApiProperty()
  uploadUrl!: string;

  @ApiProperty()
  videoRef!: string;
}

/** Whether lesson videos can be uploaded on this server yet (C4). */
export class VideoUploadStatusResponseDto {
  @ApiProperty()
  enabled!: boolean;
}
