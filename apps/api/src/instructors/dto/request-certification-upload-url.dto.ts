import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type CertificationContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** POST /instructors/me/certification-upload-url body. A certification is
 * commonly a scanned document, not always an image — unlike the waiver
 * drawn-signature upload (always PNG), this accepts a small, explicit set of
 * real document/image types rather than hardcoding one. */
export class RequestCertificationUploadUrlDto {
  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES })
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType!: CertificationContentType;
}
